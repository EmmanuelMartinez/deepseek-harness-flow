/**
 * Parsers for the git output this service reads.
 *
 * Every parser is pure and takes the exact bytes one command produced, so the
 * controller owns process handling and the shapes stay testable without git.
 * Records are NUL-separated wherever a path or a message can contain a newline,
 * which is what makes a path list unambiguous; the field separator inside a
 * record is the ASCII unit separator, and the free-text field is always last so
 * a separator inside it cannot shift another field.
 *
 * @module @deepseek-ai/dsh-api-git-controller/src/porcelain
 */

import type {
  GitCommitView,
  GitDiffHunk,
  GitDiffLine,
  GitFileChangeView,
  GitHead,
  GitRefView,
  GitStatusEntry,
  GitStatusKind,
  GitUpstream,
} from './types.ts'

/** Field separator inside one record of a custom `--format`. */
const FIELD = '\u001f'

/** Record separator: git's own NUL mode for the porcelain commands. */
const RECORD = '\u0000'

/** What the branch headers of `status --porcelain=v2 --branch` report. */
export interface GitBranchFacts {
  readonly head: GitHead
  readonly upstream?: GitUpstream
}

/** Map one porcelain status letter onto a side's kind. */
function statusKind(letter: string): GitStatusKind {
  switch (letter) {
    case '.': return 'unmodified'
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechange'
    case 'U': return 'unmerged'
    default: return 'unmodified'
  }
}

/**
 * Split one `status` record into its fixed fields and its trailing path, which
 * may itself contain spaces and therefore is everything after the last fixed
 * field.
 * @param record - one NUL-delimited record without its terminator.
 * @param pathIndex - how many space-separated fields precede the path.
 * @returns the leading fields and the path, or undefined for a short record.
 */
function splitPathRecord(record: string, pathIndex: number): { readonly fields: string[]; readonly path: string } | undefined {
  const fields: string[] = []
  let position = 0
  for (let index = 0; index < pathIndex; index += 1) {
    const space = record.indexOf(' ', position)
    if (space === -1) return undefined
    fields.push(record.slice(position, space))
    position = space + 1
  }
  return { fields, path: record.slice(position) }
}

/** One `# branch.<key> <value>` header of `status --porcelain=v2 --branch`. */
const BRANCH_HEADER = /^# branch\.([a-z]+)(?: (.*))?$/u

/**
 * Read the branch headers of `status --porcelain=v2 --branch -z`.
 * @param output - the command's complete stdout.
 * @returns HEAD's fact and the checked-out branch's divergence, when any.
 */
export function parseBranchFacts(output: string): GitBranchFacts {
  let oid: string | undefined
  let branch: string | undefined
  let upstreamRef: string | undefined
  let ahead = 0
  let behind = 0
  for (const record of output.split(RECORD)) {
    const parsed = BRANCH_HEADER.exec(record)
    if (parsed === null) continue
    const key = parsed[1]
    const value = parsed[2] ?? ''
    if (key === 'oid') oid = value === '(initial)' ? undefined : value
    else if (key === 'head') branch = value === '(detached)' ? undefined : value
    else if (key === 'upstream') upstreamRef = value
    else if (key === 'ab') {
      const [added, removed] = value.split(' ')
      ahead = Number.parseInt(added?.slice(1) ?? '0', 10)
      behind = Number.parseInt(removed?.slice(1) ?? '0', 10)
    }
  }
  const head: GitHead = oid === undefined
    ? { kind: 'unborn', branch: branch ?? 'HEAD' }
    : branch === undefined
      ? { kind: 'detached', oid }
      : { kind: 'branch', branch, oid }
  if (upstreamRef === undefined) return { head }
  return {
    head,
    upstream: {
      ref: upstreamRef,
      ahead: Number.isSafeInteger(ahead) ? ahead : 0,
      behind: Number.isSafeInteger(behind) ? behind : 0,
    },
  }
}

/**
 * Read the changed-path records of `status --porcelain=v2 -z`.
 * @param output - the command's complete stdout; branch headers are ignored.
 * @returns one entry per changed path, in git's order.
 */
export function parseStatusEntries(output: string): GitStatusEntry[] {
  const records = output.split(RECORD)
  const entries: GitStatusEntry[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record === '' || record.startsWith('#')) continue
    const kind = record[0]
    if (kind === '?') {
      const path = record.slice(2)
      if (path !== '') entries.push({ path, index: 'unmodified', worktree: 'untracked' })
      continue
    }
    if (kind === '1') {
      const split = splitPathRecord(record, 8)
      if (split === undefined) continue
      entries.push({
        path: split.path,
        index: statusKind(split.fields[1]?.[0] ?? '.'),
        worktree: statusKind(split.fields[1]?.[1] ?? '.'),
      })
      continue
    }
    if (kind === '2') {
      const split = splitPathRecord(record, 9)
      if (split === undefined) continue
      // With `-z` the previous path is the next NUL-separated field.
      const from = records[index + 1]
      index += 1
      entries.push({
        path: split.path,
        ...from === undefined || from === '' ? {} : { from },
        index: statusKind(split.fields[1]?.[0] ?? '.'),
        worktree: statusKind(split.fields[1]?.[1] ?? '.'),
      })
      continue
    }
    if (kind === 'u') {
      const split = splitPathRecord(record, 10)
      if (split === undefined) continue
      entries.push({ path: split.path, index: 'unmerged', worktree: 'unmerged' })
    }
  }
  return entries
}

/**
 * Read the five fields every commit record leads with, in the order
 * `./index.ts` asks git for them.
 * @param fields - one record split on the field separator.
 * @returns those fields, or undefined when the record carries no object id.
 */
function commitHead(fields: readonly string[]): Pick<
  GitCommitView,
  'oid' | 'parents' | 'authorName' | 'authorEmail' | 'authoredAt'
> | undefined {
  const oid = fields[0]
  if (oid === undefined || oid === '') return undefined
  return {
    oid,
    parents: fields[1] === undefined || fields[1] === '' ? [] : fields[1].split(' '),
    authorName: fields[2] ?? '',
    authorEmail: fields[3] ?? '',
    authoredAt: fields[4] ?? '',
  }
}

/**
 * Read the records of `log -z --format=<fields>`.
 * @param output - the command's complete stdout.
 * @returns one commit per record, with an empty decoration list.
 */
export function parseLog(output: string): GitCommitView[] {
  const commits: GitCommitView[] = []
  for (const record of output.split(RECORD)) {
    if (record === '') continue
    const fields = record.split(FIELD)
    const head = commitHead(fields)
    if (head === undefined) continue
    commits.push({
      ...head,
      // The subject is last: a separator inside it shifts nothing.
      subject: fields.slice(5).join(FIELD),
      refs: [],
    })
  }
  return commits
}

/**
 * Read the records of `for-each-ref --format=<fields>`.
 * @param output - the command's complete stdout, one ref per line.
 * @returns one ref per record, in git's order.
 */
export function parseRefs(output: string): GitRefView[] {
  const refs: GitRefView[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const fields = line.split('\t')
    const name = fields[0]
    const shortName = fields[1]
    if (name === undefined || name === '' || shortName === undefined) continue
    const kind = name.startsWith('refs/heads/')
      ? 'local' as const
      : name.startsWith('refs/remotes/') ? 'remote' as const : 'tag' as const
    const objectOid = fields[3] ?? ''
    // An annotated tag names the tag object; its peeled commit is what the graph shows.
    const peeledOid = fields[4] ?? ''
    refs.push({
      name,
      shortName,
      kind,
      oid: peeledOid === '' ? objectOid : peeledOid,
      head: fields[2] === '*',
      subject: (peeledOid === '' ? fields[5] : fields[6]) ?? '',
      committedAt: (peeledOid === '' ? fields[7] : fields[8]) ?? '',
    })
  }
  return refs
}

/** One file's parsed comparison. */
export interface ParsedDiff {
  /** Whether git reported a binary pair, in which case there are no hunks. */
  readonly binary: boolean
  readonly hunks: GitDiffHunk[]
}

/**
 * Read `diff --no-color` output for one file.
 *
 * File headers before the first hunk are ignored: the caller already names the
 * file it asked about. A `\ No newline at end of file` marker is dropped, since
 * the panel renders lines rather than patching them.
 * @param output - the command's complete stdout.
 * @returns whether the pair is binary, and the hunks in file order.
 */
export function parseUnifiedDiff(output: string): ParsedDiff {
  const hunks: GitDiffHunk[] = []
  let binary = false
  let current: { header: string; lines: GitDiffLine[] } | undefined
  for (const line of output.split('\n')) {
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      binary = true
      continue
    }
    if (line.startsWith('@@')) {
      if (current !== undefined) hunks.push({ header: current.header, lines: current.lines })
      current = { header: line, lines: [] }
      continue
    }
    if (current === undefined || line === '' || line.startsWith('\\')) continue
    const marker = line[0]
    const text = line.slice(1)
    if (marker === '+') current.lines.push({ kind: 'add', text })
    else if (marker === '-') current.lines.push({ kind: 'delete', text })
    else if (marker === ' ') current.lines.push({ kind: 'context', text })
  }
  if (current !== undefined) hunks.push({ header: current.header, lines: current.lines })
  return { binary, hunks }
}

/** One file `diff-tree --raw` reports, with the kind its status letter names. */
export interface RawChange {
  /** Path after the change. */
  readonly path: string
  /** Path before a rename or copy. */
  readonly from?: string
  readonly kind: GitFileChangeView['kind']
}

/**
 * Map one diff status letter onto a change's kind.
 * @param letter - the first letter of a raw status or a name-status entry.
 * @returns the matching kind; an unrecognized letter reports a modification.
 */
export function changeKind(letter: string): GitFileChangeView['kind'] {
  switch (letter) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechange'
    default: return 'modified'
  }
}

/**
 * Read the records of `diff-tree --raw -z`.
 *
 * Each record starts with the mode/object header and ends with the status, and
 * the paths that follow it are their own NUL-separated fields: one for an
 * ordinary change, previous then current for a rename or copy.
 * @param output - the command's complete stdout.
 * @returns one change per record, in git's order.
 */
export function parseRawChanges(output: string): RawChange[] {
  const records = output.split(RECORD)
  const changes: RawChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || !record.startsWith(':')) continue
    const status = record.slice(record.lastIndexOf(' ') + 1)
    const kind = changeKind(status[0] ?? 'M')
    if (kind === 'renamed' || kind === 'copied') {
      const from = records[index + 1]
      const to = records[index + 2]
      index += 2
      if (from === undefined || from === '' || to === undefined || to === '') continue
      changes.push({ path: to, from, kind })
      continue
    }
    const path = records[index + 1]
    index += 1
    if (path === undefined || path === '') continue
    changes.push({ path, kind })
  }
  return changes
}

/** One commit's metadata and message, as `show --no-patch --format=` prints it. */
export interface ParsedCommit {
  readonly oid: string
  /** Parents in order; empty for a root commit. */
  readonly parents: readonly string[]
  readonly authorName: string
  readonly authorEmail: string
  readonly authoredAt: string
  readonly subject: string
  /** Message without its subject line; empty for a one-line message. */
  readonly body: string
}

/**
 * Read one `show --no-patch --format=<fields>` record.
 * @param output - the command's complete stdout.
 * @returns the commit, or undefined when the record carries no object id.
 */
export function parseCommitDetail(output: string): ParsedCommit | undefined {
  // git terminates the formatted record with one newline.
  const record = output.endsWith('\n') ? output.slice(0, -1) : output
  const fields = record.split(FIELD)
  const head = commitHead(fields)
  if (head === undefined) return undefined
  return {
    ...head,
    subject: fields[5] ?? '',
    // The body is last: a separator inside it shifts nothing. It arrives with
    // the message's own trailing newline, which is not part of its text.
    body: fields.slice(6).join(FIELD).replace(/\n+$/u, ''),
  }
}
