/**
 * The Editor page: a tab strip of open documents over one editable buffer, and
 * the same document's comparison against its repository when that is what the
 * user asked to see.
 *
 * Saving is explicit (⌘S or the Save control); the autosave switch makes a save
 * follow a pause in typing instead. A buffer the Host has moved past shows its
 * conflict in place, with the reload that discards the local edit and reads the
 * file as it stands.
 */
import type { KeyboardEvent, ReactNode } from 'react'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitDiffHunk } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './EditorPage.module.css'
import type { EditorDocument } from './model.ts'
import type { EditorInjected } from './slots.ts'

/** Full component props assembled by the main slot renderer. */
export type EditorPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'editor'>
  & InjectFace<EditorInjected>

/** Two spaces, the indent one Tab inserts into the buffer. */
const INDENT = '  '

/** The starting line numbers of one hunk, read from its `@@ -a,b +c,d @@` header. */
function hunkStart(header: string): { readonly old: number; readonly next: number } {
  const parsed = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(header)
  return { old: Number.parseInt(parsed?.[1] ?? '1', 10), next: Number.parseInt(parsed?.[2] ?? '1', 10) }
}

/**
 * One hunk: its header, then each line with the numbers it holds on both sides.
 * @param props - the hunk to draw.
 * @returns the hunk block.
 */
function Hunk({ hunk }: { readonly hunk: GitDiffHunk }): ReactNode {
  const start = hunkStart(hunk.header)
  let old = start.old
  let next = start.next
  return (
    <div className={css.hunk}>
      <p className={css.hunkHeader}>{hunk.header}</p>
      {hunk.lines.map((line, index) => {
        const oldNumber = line.kind === 'add' ? '' : String(old)
        const newNumber = line.kind === 'delete' ? '' : String(next)
        if (line.kind !== 'add') old += 1
        if (line.kind !== 'delete') next += 1
        return (
          <div key={index} className={css.diffLine} data-kind={line.kind}>
            <span className={css.lineNumber}>{oldNumber}</span>
            <span className={css.lineNumber}>{newNumber}</span>
            <span className={css.marker} aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '}
            </span>
            <span className={css.diffText}>{line.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * One document's comparison: its side, its hunks, or the reason there are none.
 * @param props - the document and the translator.
 * @returns the comparison view.
 */
function DiffView({ document, t }: {
  readonly document: EditorDocument
  readonly t: (key: 'loading' | 'noRepository' | 'noChanges' | 'workingTree' | 'staged' | 'untrackedFile' | 'binary' | 'truncated') => string
}): ReactNode {
  const diff = document.diff
  if (diff === undefined) return <p className={css.notice}>{t('loading')}</p>
  if (diff.kind === 'unavailable') return <p className={css.notice}>{t('noRepository')}</p>
  if (diff.kind === 'unchanged') return <p className={css.notice}>{t('noChanges')}</p>
  return (
    <div className={css.diff}>
      <p className={css.diffHead}>
        {diff.side === 'worktree' ? t('workingTree') : t('staged')}
        {diff.untracked && <span className={css.detail}>{t('untrackedFile')}</span>}
        <span className={css.detail}>{diff.path}</span>
      </p>
      {diff.binary && <p className={css.notice}>{t('binary')}</p>}
      {diff.hunks.map((hunk, index) => <Hunk key={index} hunk={hunk} />)}
      {diff.truncated && <p className={css.note}>{t('truncated')}</p>}
    </div>
  )
}

/**
 * Render the Editor panel.
 * @param props - the main slot's runtime currency, the panel's injected face, and the translator.
 * @returns the page element.
 */
export function EditorPage({
  useEditor, activate, close, edit, save, reload, toggleAutosave, showDiff, showEdit, t,
}: EditorPageProps): ReactNode {
  const state = useEditor(snapshot => snapshot)
  const active = state.documents.find(document => document.id === state.active)

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (active !== undefined) void save(active.id)
      return
    }
    if (event.key !== 'Tab' || active === undefined) return
    // Keep the caret in the buffer: the value setter owns the text, so the
    // indent is inserted here and the selection restored after the render.
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart
    const next = `${target.value.slice(0, start)}${INDENT}${target.value.slice(target.selectionEnd)}`
    edit(active.id, next)
    const caret = start + INDENT.length
    requestAnimationFrame(() => { target.setSelectionRange(caret, caret) })
  }

  return (
    <div className={css.page}>
      <div className={css.tabs} role="tablist">
        {state.documents.map(document => (
          <span key={document.id} className={css.tab} data-active={document.id === state.active}>
            <button
              type="button"
              role="tab"
              aria-selected={document.id === state.active}
              className={css.tabButton}
              onClick={() => { activate(document.id) }}
            >
              {document.dirty && <span className={css.dot} aria-hidden="true" />}
              <span className={css.tabName}>{document.name}</span>
            </button>
            <button
              type="button"
              className={css.tabClose}
              aria-label={`${t('close')} ${document.name}`}
              onClick={() => { close(document.id) }}
            >
              <IconCloseOutlineRegular size={12} />
            </button>
          </span>
        ))}
      </div>

      {active === undefined && <p className={css.notice}>{t('empty')}</p>}

      {active !== undefined && (
        <>
          <div className={css.bar}>
            <span className={css.path}>{active.path}</span>
            <span className={css.status}>
              {active.busy ? t('saving') : active.dirty ? t('unsaved') : t('saved')}
            </span>
            {state.gitAvailable && (
              <span className={css.modes}>
                <button
                  type="button"
                  className={css.toggle}
                  aria-pressed={active.mode === 'edit'}
                  onClick={() => { showEdit(active.id) }}
                >
                  {t('edit')}
                </button>
                <button
                  type="button"
                  className={css.toggle}
                  aria-pressed={active.mode === 'diff'}
                  onClick={() => { showDiff(active.id) }}
                >
                  {t('diff')}
                </button>
              </span>
            )}
            <button
              type="button"
              className={css.toggle}
              aria-pressed={state.autosave}
              onClick={() => { toggleAutosave() }}
            >
              {t('autosave')}
            </button>
            <button type="button" className={css.action} onClick={() => { void reload(active.id) }}>
              {t('reload')}
            </button>
            <button
              type="button"
              className={css.primary}
              disabled={!active.dirty}
              onClick={() => { void save(active.id) }}
            >
              {t('save')}
            </button>
          </div>
          {active.conflict !== undefined && (
            <p className={css.banner} role="alert">
              {t('conflict')}<span className={css.detail}>{t('conflictKeep')}</span>
            </p>
          )}
          {active.failure !== undefined && (
            <p className={css.banner} role="alert">
              {t('failed')}<span className={css.detail}>{active.failure.message}</span>
            </p>
          )}
          {active.mode === 'diff'
            ? <DiffView document={active} t={t} />
            : (
              <textarea
                className={css.editor}
                aria-label={active.name}
                spellCheck={false}
                value={active.text}
                onChange={(event) => { edit(active.id, event.target.value) }}
                onKeyDown={onKeyDown}
              />
            )}
        </>
      )}
    </div>
  )
}
