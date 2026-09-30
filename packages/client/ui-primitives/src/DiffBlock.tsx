import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import { structuredPatch } from 'diff'
import { FoldToggle } from './FoldToggle.tsx'
import { writeClipboard } from './clipboard.ts'
import { CodeToolbar, type CodeToolbarLabels } from './CodeToolbar.tsx'
import { IconCheckOutlineRegular, IconCloseOutlineRegular } from './icons/index.tsx'
import { languageForPath } from './code-highlighting.ts'
import cardCss from './CodeCard.module.css'
import css from './DiffBlock.module.css'

/** Output lines shown before the height cap collapses the middle. */
export const DEFAULT_DIFF_MAX_LINES = 16

/**
 * One file change in the form {@link DiffBlock} renders. It is declared here
 * so this primitive stays independent of the tool contract.
 */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
  path: string
  /** Prior content including context, or `null` when no prior content is available. */
  oldText: string | null
  /** Content after the change, including any shared context. */
  newText: string
}

/**
 * One reviewable fragment of a change: a contiguous local patch, or the whole
 * fragment replacement when the comparison exceeds {@link MAX_DIFF_EDIT_LENGTH}.
 * It is what a review action's `fragmentIndex` addresses, so an owner can map a
 * click back to the exact lines it covers.
 */
export interface DiffFragment {
  /** The fragment's lines, each prefixed `-` (removed), `+` (added), or one space (context). */
  lines: string[]
}

/**
 * Handle one review action on a change or on one of its fragments.
 * @param changeIndex - the change's position in `diffs`.
 * @param hunk - the addressed change itself.
 * @param fragmentIndex - the addressed fragment, or `undefined` when the action covers every fragment of the change.
 */
export type DiffReviewHandler = (
  changeIndex: number,
  hunk: DiffHunk,
  fragmentIndex?: number,
) => void

export interface DiffBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: DiffHunk[]
  /** Localized chrome supplied by the owning render site. */
  labels: DiffBlockLabels
  /** Height cap in body lines before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /**
   * Accept one change, or one of its fragments when `fragmentIndex` is set.
   * Omitting it hides every accept action; a wired handler turns the block into
   * a review surface.
   */
  onAccept?: DiffReviewHandler | undefined
  /** Reject one change or one of its fragments; omitting it hides every reject action. */
  onReject?: DiffReviewHandler | undefined
}

/** Localized chrome for {@link DiffBlock}. */
export interface DiffBlockLabels extends CodeToolbarLabels {
  copy: string
  copied: string
  collapseAria: string
  expandAria: (hidden: number) => string
  collapse: string
  expand: (hidden: number) => string
  /** Review-action copy; required so every site localizes the actions it can enable. */
  review: DiffReviewLabels
}

/** Localized copy and accessible names for {@link DiffBlock}'s review actions. */
export interface DiffReviewLabels {
  /** Visible copy on an accept action. */
  accept: string
  /** Visible copy on a reject action. */
  reject: string
  /** Accessible name for the accept action of a change's own header, which covers every fragment of it. */
  acceptChange: (path: string) => string
  /** Accessible name for the reject action of a change's own header, which covers every fragment of it. */
  rejectChange: (path: string) => string
  /** Accessible name for a fragment header's accept action, naming its 1-based position and the change's fragment total. */
  acceptFragment: (path: string, fragment: number, total: number) => string
  /** Accessible name for a fragment header's reject action, naming its 1-based position and the change's fragment total. */
  rejectFragment: (path: string, fragment: number, total: number) => string
}

/** The two review actions a header can offer. */
type DiffAction = 'accept' | 'reject'

/** A header's display tone, taken from the fragment lines it opens. */
type DiffTone = 'add' | 'del' | 'mixed'

/** Displayed addition and deletion totals for a fragment or a whole change. */
interface DiffCounts {
  added: number
  removed: number
}

/**
 * The review target a header addresses. It is resolved while the rows are
 * built, so a click never has to look its own change up again.
 */
interface ReviewTarget {
  /** The change's position in `diffs`. */
  changeIndex: number
  /** The addressed change. */
  hunk: DiffHunk
  /** How many fragments the change renders, so a fragment action can name itself "N of M". */
  total: number
  /** The addressed fragment; absent when the header addresses every fragment of the change. */
  fragmentIndex?: number | undefined
}

/**
 * A change's own header, or a `⋯` header opening one of its later fragments.
 * Either one carries the review actions that address its target.
 */
interface DiffHeaderRow {
  role: 'header'
  kind: 'path' | 'gap'
  text: string
  target: ReviewTarget
  /** Header accent tone; absent for a change with nothing to show. */
  tone?: DiffTone | undefined
}

/** One diff line: it draws its text alone and carries no action. */
interface DiffLineRow {
  role: 'line'
  kind: 'del' | 'add' | 'context'
  text: string
}

/** A single rendered body line and its role, so the height cap slices a flat list. */
type DiffRow = DiffHeaderRow | DiffLineRow

/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`)
}

/** The dim class per row kind (path/gap chrome vs the diff's own +/- colors). */
const ROW_CLASS: Record<DiffRow['kind'], string | undefined> = {
  path: css.path,
  del: css.del,
  add: css.add,
  context: css.context,
  gap: css.gap,
}

/** Bound synchronous edit-graph search; one replacement consumes two edits. */
const MAX_DIFF_EDIT_LENGTH = 256

/** How long a clicked action keeps its settled flash before the header returns to idle. */
const REVIEW_SETTLE_MS = 900

/**
 * Derive the reviewable fragments of one change: its exact local patches, or a
 * single whole-fragment replacement when search exceeds {@link MAX_DIFF_EDIT_LENGTH}.
 * A review action's `fragmentIndex` indexes this list.
 * @param diff - the change to split.
 * @returns the fragments in file order; empty when both sides are identical.
 */
export function diffFragments(diff: DiffHunk): DiffFragment[] {
  const oldLines = contentLines(diff.oldText ?? '')
  const newLines = contentLines(diff.newText)
  const normalize = (lines: string[]): string => lines.map(line => `${line}\n`).join('')
  return structuredPatch('', '', normalize(oldLines), normalize(newLines),
    undefined, undefined, { context: 3, maxEditLength: MAX_DIFF_EDIT_LENGTH })?.hunks
    ?? [{ lines: [...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`)] }]
}

/**
 * Count one fragment's displayed additions and deletions.
 * @param fragment - the fragment to count.
 * @returns its `+` and `-` line totals.
 */
function countFragment(fragment: DiffFragment): DiffCounts {
  let added = 0
  let removed = 0
  for (const line of fragment.lines) {
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

/**
 * Sum the counts of every fragment a change renders.
 * @param fragments - the change's fragments.
 * @returns the combined `+` and `-` line totals.
 */
function sumCounts(fragments: DiffFragment[]): DiffCounts {
  let added = 0
  let removed = 0
  for (const fragment of fragments) {
    const counts = countFragment(fragment)
    added += counts.added
    removed += counts.removed
  }
  return { added, removed }
}

/**
 * Pick a header's accent from its counts.
 * @param counts - the `+` and `-` totals the header opens.
 * @returns `add`, `del`, `mixed`, or `undefined` for a change with neither.
 */
function toneOf(counts: DiffCounts): DiffTone | undefined {
  if (counts.added === 0 && counts.removed === 0) return undefined
  if (counts.added > 0 && counts.removed > 0) return 'mixed'
  return counts.added > 0 ? 'add' : 'del'
}

/**
 * Count displayed additions and deletions. Exact patches exclude shared context;
 * comparisons exceeding the edit limit count both complete fragments as replaced.
 * Text follows {@link contentLines}'s terminator rule.
 * @param diffs - the hunks to count.
 * @returns the +/- totals for tool summaries.
 */
export function diffTotals(diffs: DiffHunk[]): { added: number; removed: number } {
  return sumCounts(diffs.flatMap(diff => diffFragments(diff)))
}

/**
 * Flatten local patches into rows.
 * A path header opens each new file, and a `⋯` header separates consecutive
 * changes to the same file. A change that renders more than one fragment opens
 * each later fragment with its own `⋯` header, so that fragment can be reviewed
 * on its own; the change's own header addresses every fragment at once.
 * @param diffs - the hunks to render.
 * @returns the body rows.
 */
function buildRows(diffs: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  let prevPath: string | undefined
  for (const [changeIndex, diff] of diffs.entries()) {
    const fragments = diffFragments(diff)
    const total = fragments.length
    const sameFile = diff.path === prevPath
    rows.push({
      role: 'header',
      kind: sameFile ? 'gap' : 'path',
      text: sameFile ? '⋯' : diff.path,
      target: { changeIndex, hunk: diff, total },
      tone: toneOf(sumCounts(fragments)),
    })
    prevPath = diff.path
    for (const [fragmentIndex, fragment] of fragments.entries()) {
      if (fragmentIndex > 0) {
        rows.push({
          role: 'header',
          kind: 'gap',
          text: '⋯',
          target: { changeIndex, hunk: diff, total, fragmentIndex },
          tone: toneOf(countFragment(fragment)),
        })
      }
      for (const line of fragment.lines) {
        rows.push({
          role: 'line',
          kind: line.startsWith('-') ? 'del' : line.startsWith('+') ? 'add' : 'context',
          text: line.slice(1),
        })
      }
    }
  }
  return rows
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and a
 * single trailing newline is a line terminator rather than an extra empty line —
 * the same terminator rule TerminalBlock applies to command output. An interior
 * blank line (a genuine `\n\n`) survives.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * The clipboard prefix of one diff line.
 * @param kind - the line's row kind.
 * @returns `- `, `+ `, or two spaces of context indent.
 */
function linePrefix(kind: DiffLineRow['kind']): string {
  switch (kind) {
    case 'del': return '- '
    case 'add': return '+ '
    case 'context': return '  '
    /* v8 ignore next -- closed-union backstop; only reached if a line kind is forged */
    default: return assertNever(kind)
  }
}

/**
 * Copy the full local diff, including folded rows: removed/added lines have
 * `- `/`+ ` prefixes, context has two spaces, and paths, fragment separators,
 * and gaps stay verbatim.
 * @param rows - the flattened body rows.
 * @returns the diff as plain text.
 */
function copyText(rows: DiffRow[]): string {
  return rows.map(row => row.role === 'header' ? row.text : `${linePrefix(row.kind)}${row.text}`).join('\n')
}

/**
 * Identity of one review action, so a flash tracks its own target and a stale
 * timer can never clear a newer one.
 * @param action - the action that was invoked.
 * @param target - the change or fragment it addressed.
 * @returns the key held while that exact action shows its settled state.
 */
function reviewKey(action: DiffAction, target: ReviewTarget): string {
  return `${action}:${target.changeIndex}:${target.fragmentIndex ?? 'all'}`
}

/** Props for {@link DiffRowView}. */
interface DiffRowViewProps {
  row: DiffRow
  labels: DiffBlockLabels
  /** The review action currently showing its settled flash, or null while idle. */
  settled: string | null
  onAccept?: DiffReviewHandler | undefined
  onReject?: DiffReviewHandler | undefined
  /** Record a clicked action's settled flash. */
  onSettle: (action: DiffAction, target: ReviewTarget) => void
}

/**
 * Render one body row. A diff line draws its text alone; a header adds the
 * review actions its owner enabled, and stays a plain text row when none is wired.
 * @param props - the row, the localized copy, and the owner's review state.
 * @returns the row element.
 */
function DiffRowView({ row, labels, settled, onAccept, onReject, onSettle }: DiffRowViewProps) {
  if (row.role === 'line') {
    return <div className={clsx(css.line, ROW_CLASS[row.kind])}>{row.text}</div>
  }
  const target = row.target
  const accept = onAccept
  const reject = onReject
  const fragment = target.fragmentIndex
  return (
    <div
      className={clsx(css.line, css.header, ROW_CLASS[row.kind])}
      data-diff-header={row.kind}
      data-diff-fragment={fragment}
      data-tone={row.tone}
    >
      <span className={css.headerLabel}>{row.text}</span>
      {(accept !== undefined || reject !== undefined) && (
        <div className={css.review}>
          {accept !== undefined && (
            <button
              type="button"
              className={clsx(css.reviewAction, css.accept)}
              aria-label={fragment === undefined
                ? labels.review.acceptChange(target.hunk.path)
                : labels.review.acceptFragment(target.hunk.path, fragment + 1, target.total)}
              data-pending={settled === reviewKey('accept', target) ? 'true' : undefined}
              onClick={() => {
                accept(target.changeIndex, target.hunk, fragment)
                onSettle('accept', target)
              }}
            >
              <IconCheckOutlineRegular size={12} />
              <span>{labels.review.accept}</span>
            </button>
          )}
          {reject !== undefined && (
            <button
              type="button"
              className={clsx(css.reviewAction, css.reject)}
              aria-label={fragment === undefined
                ? labels.review.rejectChange(target.hunk.path)
                : labels.review.rejectFragment(target.hunk.path, fragment + 1, target.total)}
              data-pending={settled === reviewKey('reject', target) ? 'true' : undefined}
              onClick={() => {
                reject(target.changeIndex, target.hunk, fragment)
                onSettle('reject', target)
              }}
            >
              <IconCloseOutlineRegular size={12} />
              <span>{labels.review.reject}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Render a file mutation as an inline diff surface. Wiring `onAccept`/`onReject`
 * turns each change's header — and, for a change with several fragments, each
 * later fragment's `⋯` header — into a review row; the change's own header
 * addresses every one of its fragments.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, labels, maxLines = DEFAULT_DIFF_MAX_LINES, className, onAccept, onReject }: DiffBlockProps) {
  const rows = useMemo(() => buildRows(diffs), [diffs])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [wrapped, setWrapped] = useState(false)
  const [settled, setSettled] = useState<string | null>(null)
  const firstLanguage = diffs[0] === undefined ? undefined : languageForPath(diffs[0].path)
  const language = diffs.every(diff => languageForPath(diff.path) === firstLanguage) ? firstLanguage : undefined

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  // One action keeps its settled flash at a time; the timer only clears the key
  // it installed itself, so a newer click survives an older timer.
  const onSettle = useCallback((action: DiffAction, target: ReviewTarget) => {
    const key = reviewKey(action, target)
    setSettled(key)
    window.setTimeout(() => { setSettled(current => current === key ? null : current) }, REVIEW_SETTLE_MS)
  }, [])

  if (rows.length === 0) return null

  const reviewing = onAccept !== undefined || onReject !== undefined
  const hidden = rows.length - maxLines
  const capped = hidden > 0 && !expanded
  // Same split arithmetic as TerminalBlock and the TUI transcript's collapsed
  // card, so a body's head and tail slices agree across the front ends.
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? rows.slice(0, headLines) : rows
  const tail = capped ? rows.slice(rows.length - tailLines) : []

  return (
    <div className={clsx(cardCss.card, css.block, className)} data-diff="" data-code-wrap={wrapped}
      data-review={reviewing ? 'true' : 'false'}>
      <CodeToolbar lang={language} labels={labels} copyLabel={labels.copy} copiedLabel={labels.copied}
        copied={copied} wrapped={wrapped} onCopy={onCopy} onWrap={() => { setWrapped(value => !value) }} />
      <div className={css.body}>
        {head.map((row, index) => (
          <DiffRowView key={`head:${index}`} row={row} labels={labels} settled={settled}
            onAccept={onAccept} onReject={onReject} onSettle={onSettle} />
        ))}
        {hidden > 0 && (
          <FoldToggle
            className={css.expand}
            expanded={expanded}
            hidden={hidden}
            labels={labels}
            onToggle={onToggle}
          />
        )}
        {tail.map((row, index) => (
          <DiffRowView key={`tail:${index}`} row={row} labels={labels} settled={settled}
            onAccept={onAccept} onReject={onReject} onSettle={onSettle} />
        ))}
      </div>
    </div>
  )
}
