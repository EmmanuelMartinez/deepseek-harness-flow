/**
 * Git Remote owner: locates the repository behind a registered Workspace and
 * serves the history graph, working-tree status, refs, and file comparisons the
 * Client panel renders.
 *
 * The Workspace registration is the only path authority. A request names a
 * `WorkspaceId` and this Host resolves its canonical directory, so no caller can
 * point the service at an arbitrary directory, and every path that crosses the
 * wire is relative to the repository root and validated here. Every command runs
 * through the subprocess seam with git's non-interactive environment, a
 * per-command deadline, and a bounded stdout (see `@deepseek-ai/dsh-git-command`).
 *
 * Read-only: this service reports repository state and changes nothing in it.
 *
 * @module @deepseek-ai/dsh-api-git-controller
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { GitRunner, parseNumstat, resolveGitExecutable } from '@deepseek-ai/dsh-git-command'
import type { GitRunResult, GitUnavailableReason } from '@deepseek-ai/dsh-git-command'
import {
  parseBranchFacts,
  parseCommitDetail,
  parseLog,
  parseRawChanges,
  parseRefs,
  parseStatusEntries,
  parseUnifiedDiff,
} from './porcelain.ts'
import type {
  GitCommitDetailView,
  GitDiffRequest,
  GitFileChangeView,
  GitFileDiffView,
  GitLogPage,
  GitLogRequest,
  GitRefView,
  GitRefsView,
  GitRepositoryResult,
  GitStatusView,
} from './types.ts'

export type * from './types.ts'

/** Fields one `log` record carries, in the order `./porcelain.ts` reads them. */
const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s'

/** Fields one `show --no-patch` record carries; the body is last. */
const SHOW_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b'

/** Tab-separated fields of one `for-each-ref` line; the peeled forms are empty for a direct ref. */
const REF_FORMAT = [
  '%(refname)', '%(refname:short)', '%(HEAD)', '%(objectname)', '%(*objectname)',
  '%(subject)', '%(*subject)', '%(committerdate:iso-strict)', '%(*committerdate:iso-strict)',
].join('%09')

/** Deployment bounds on what one call reads and returns. */
export interface Config {
  /** Milliseconds one git command may run before its deadline aborts it. */
  readonly timeoutMs: number
  /** Bytes of one command's stdout retained; a larger stream is reported cut. */
  readonly outputMaxBytes: number
  /** Refs one read keeps; the rest is dropped and reported cut. */
  readonly maxRefs: number
  /** Changed paths one status response keeps. */
  readonly maxStatusEntries: number
  /** Commits one history page returns when the request names no limit. */
  readonly maxLogPage: number
  /** Files one commit detail keeps. */
  readonly maxCommitFiles: number
}

/** What the executable resolution settled on, cached for the plugin's lifetime. */
type GitResolution =
  | { readonly kind: 'runner'; readonly runner: GitRunner }
  | { readonly kind: 'unavailable'; readonly reason: GitUnavailableReason }

/** One located working tree. */
interface LocatedRepository {
  readonly root: string
}

/** Refuse a wire number a request cannot use. */
function integerAtLeast(value: number, min: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RemoteError('gateway/bad-request', `${name} must be a safe integer of at least ${min}`, {})
  }
  return value
}

/**
 * Validate one repository-relative path from the wire.
 *
 * The panel only ever sends a path git itself reported, so anything else is a
 * defect or an attack: an absolute path or a `..` segment would leave the
 * repository, and a NUL cannot travel through an argument at all.
 * @param path - the path to validate.
 * @returns the same path.
 * @throws RemoteError with `git/bad-request` when the path is not repository-relative.
 */
function requireRelativePath(path: string): string {
  const rejected = path === ''
    || path.includes('\u0000')
    || path.startsWith('/')
    || path.startsWith('\\')
    || /^[a-z]:/iu.test(path)
    || path.split('/').includes('..')
  if (rejected) {
    throw new RemoteError('git/bad-request', `"${path}" is not a repository-relative path`, { reason: 'path-outside-repository' })
  }
  return path
}

/**
 * Validate one revision from the wire.
 * @param revision - revision or refname to validate.
 * @returns the same revision.
 * @throws RemoteError with `git/bad-request` when it could be read as an option.
 */
function requireRevision(revision: string): string {
  if (revision === '' || revision.includes('\u0000') || revision.startsWith('-')) {
    throw new RemoteError('git/bad-request', `"${revision}" is not a usable revision`, { reason: 'option-like-revision' })
  }
  return revision
}

/**
 * Validate one object id from the wire.
 * @param oid - object id to validate.
 * @returns the same object id.
 * @throws RemoteError with `git/bad-request` when it is not hexadecimal.
 */
function requireObjectId(oid: string): string {
  if (!/^[0-9a-f]{4,64}$/iu.test(oid)) {
    throw new RemoteError('git/bad-request', `"${oid}" is not a commit id`, { reason: 'option-like-revision' })
  }
  return oid
}

/** Host Remote owner of the `git` namespace. */
export class GitController extends TypertRemoteService {
  static inject = ['subprocess', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    timeoutMs: z.number().step(1).min(1).default(30_000),
    outputMaxBytes: z.number().step(1).min(1).default(8 * 1024 * 1024),
    maxRefs: z.number().step(1).min(1).default(2000),
    maxStatusEntries: z.number().step(1).min(1).default(5000),
    maxLogPage: z.number().step(1).min(1).default(200),
    maxCommitFiles: z.number().step(1).min(1).default(1000),
  })

  /** Cancels every command this plugin's lifetime owns. */
  private readonly lifetime = new AbortController()

  /** Resolved once per plugin lifetime; a rejected resolution is retried by the next request. */
  private resolution: Promise<GitResolution> | undefined

  /**
   * @param ctx - Host context carrying the process seam and the Workspace registry.
   * @param config - deployment bounds on one call.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'gitController', { namespace: 'git' })
    for (const [field, value] of Object.entries(config)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`git-controller requires a positive integer ${field}`)
      }
    }
    ctx.effect(() => () => { this.lifetime.abort() }, 'git-controller: command lifetime')
  }

  /**
   * Locate the repository that contains a Workspace's directory.
   * @param workspaceId - registered Workspace whose directory is searched.
   * @param signal - caller cancellation.
   * @returns the located working tree, or `not-a-repository` when the directory is outside one.
   * @throws RemoteError when no such Workspace is registered.
   */
  @Remote
  async repository(workspaceId: WorkspaceId, signal: AbortSignal): Promise<GitRepositoryResult> {
    const located = await this.locate(workspaceId, signal)
    if (located === undefined) return { kind: 'not-a-repository' }
    const runner = await this.requireRunner()
    const status = await runner.run(
      ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=no'],
      { cwd: located.root, signal },
    )
    if (status.exitCode !== 0) throw this.failure('status', status)
    const facts = parseBranchFacts(status.stdout)
    return {
      kind: 'repository',
      repository: {
        root: located.root,
        name: basename(located.root),
        head: facts.head,
        ...facts.upstream === undefined ? {} : { upstream: facts.upstream },
      },
    }
  }

  /**
   * Read the working tree's changed paths, each with its staged and unstaged sides.
   * @param workspaceId - registered Workspace whose repository is read.
   * @param signal - caller cancellation.
   * @returns the changed paths, cut to the configured cap.
   */
  @Remote
  async status(workspaceId: WorkspaceId, signal: AbortSignal): Promise<GitStatusView> {
    const located = await this.requireRepository(workspaceId, signal)
    const runner = await this.requireRunner()
    const result = await runner.run(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
      { cwd: located.root, signal },
    )
    if (result.exitCode !== 0) throw this.failure('status', result)
    const entries = parseStatusEntries(result.stdout)
    const cap = this.config.maxStatusEntries
    return { entries: entries.slice(0, cap), truncated: entries.length > cap }
  }

  /**
   * Read every branch, remote-tracking ref, and tag.
   * @param workspaceId - registered Workspace whose repository is read.
   * @param signal - caller cancellation.
   * @returns the refs, cut to the configured cap.
   */
  @Remote
  async refs(workspaceId: WorkspaceId, signal: AbortSignal): Promise<GitRefsView> {
    const located = await this.requireRepository(workspaceId, signal)
    const refs = await this.readRefs(located.root, signal)
    const cap = this.config.maxRefs
    return { refs: refs.slice(0, cap), truncated: refs.length > cap }
  }

  /**
   * Walk the history from one revision, newest first, decorating each commit with the refs that point at it.
   * @param workspaceId - registered Workspace whose repository is read.
   * @param request - revision, window, and optional path filter.
   * @param signal - caller cancellation.
   * @returns one page of commits and whether the walk continues.
   */
  @Remote
  async log(workspaceId: WorkspaceId, request: GitLogRequest, signal: AbortSignal): Promise<GitLogPage> {
    const located = await this.requireRepository(workspaceId, signal)
    const runner = await this.requireRunner()
    const cap = this.config.maxLogPage
    const requested = request.limit === undefined ? cap : integerAtLeast(request.limit, 1, 'limit')
    if (requested > cap) {
      throw new RemoteError('gateway/bad-request', `limit must be at most ${cap}`, {})
    }
    const skip = request.skip === undefined ? 0 : integerAtLeast(request.skip, 0, 'skip')
    const revision = request.rev === undefined || request.rev === '' ? 'HEAD' : requireRevision(request.rev)
    const path = request.path === undefined ? undefined : requireRelativePath(request.path)
    const args = ['log', '-z', '--date-order', `--max-count=${requested + 1}`, `--skip=${skip}`, `--format=${LOG_FORMAT}`, revision]
    if (path !== undefined) args.push('--', path)
    const result = await runner.run(args, { cwd: located.root, signal })
    if (result.exitCode !== 0) {
      // A repository with no commits has no history to walk, which is an empty
      // graph rather than a failure. Naming a default HEAD that nothing resolves
      // yet is the same fact, reported as an ambiguous argument.
      if (/does not have any commits yet/i.test(result.stderr)) return { commits: [], more: false }
      if (revision === 'HEAD' && /ambiguous argument 'HEAD'/iu.test(result.stderr)) return { commits: [], more: false }
      throw /unknown revision|bad revision|ambiguous argument/i.test(result.stderr)
        ? new RemoteError('git/unknown-revision', `no revision "${revision}"`, { revision })
        : this.failure('log', result)
    }
    const parsed = parseLog(result.stdout)
    const more = parsed.length > requested
    const decorations = await this.decorations(located.root, signal)
    return {
      commits: parsed.slice(0, requested).map(commit => ({ ...commit, refs: decorations.get(commit.oid) ?? [] })),
      more,
    }
  }

  /**
   * Read one commit's message, metadata, and complete file list.
   * @param workspaceId - registered Workspace whose repository is read.
   * @param oid - commit id to read.
   * @param signal - caller cancellation.
   * @returns the commit and its changed files, cut to the configured cap.
   */
  @Remote
  async commit(workspaceId: WorkspaceId, oid: string, signal: AbortSignal): Promise<GitCommitDetailView> {
    const located = await this.requireRepository(workspaceId, signal)
    const runner = await this.requireRunner()
    const revision = requireObjectId(oid)
    const shown = await runner.run(['show', '--no-patch', `--format=${SHOW_FORMAT}`, revision], { cwd: located.root, signal })
    if (shown.exitCode !== 0) {
      throw /unknown revision|bad object|ambiguous argument|invalid object name/i.test(shown.stderr)
        ? new RemoteError('git/unknown-revision', `no commit "${revision}"`, { revision })
        : this.failure('show', shown)
    }
    const parsed = parseCommitDetail(shown.stdout)
    if (parsed === undefined) {
      throw new RemoteError('git/unknown-revision', `no commit "${revision}"`, { revision })
    }
    const files = await this.readFileChanges(located.root, revision, signal)
    const cap = this.config.maxCommitFiles
    const decorations = await this.decorations(located.root, signal)
    return {
      ...parsed,
      parents: [...parsed.parents],
      refs: decorations.get(parsed.oid) ?? [],
      files: files.slice(0, cap),
      filesTruncated: files.length > cap,
    }
  }

  /**
   * Compare one file between two of its states.
   * @param workspaceId - registered Workspace whose repository is read.
   * @param request - the path, an optional pre-rename path, and which two states to compare.
   * @param signal - caller cancellation.
   * @returns the comparison, or an explicit untracked result when the working tree has no index entry for it.
   */
  @Remote
  async diff(workspaceId: WorkspaceId, request: GitDiffRequest, signal: AbortSignal): Promise<GitFileDiffView> {
    const located = await this.requireRepository(workspaceId, signal)
    const runner = await this.requireRunner()
    const path = requireRelativePath(request.path)
    const from = request.from === undefined ? undefined : requireRelativePath(request.from)
    const paths = from === undefined ? [path] : [from, path]
    const base = { path, ...from === undefined ? {} : { from } }
    const side = request.side
    let result: GitRunResult
    switch (side.kind) {
      case 'worktree': {
        const tracked = await runner.run(['ls-files', '--error-unmatch', '--', path], { cwd: located.root, signal })
        if (tracked.exitCode === 1) {
          return { ...base, hunks: [], binary: false, untracked: true, truncated: false }
        }
        if (tracked.exitCode !== 0) throw this.failure('ls-files', tracked)
        result = await runner.run(['diff', '--no-color', '-M', '--', ...paths], { cwd: located.root, signal })
        break
      }
      case 'index':
        result = await runner.run(['diff', '--cached', '--no-color', '-M', '--', ...paths], { cwd: located.root, signal })
        break
      case 'commit':
        result = await runner.run(
          ['show', '--no-color', '-M', '--format=', requireObjectId(side.oid), '--', ...paths],
          { cwd: located.root, signal },
        )
        break
      default:
        return assertNever(side)
    }
    if (result.exitCode !== 0) throw this.failure('diff', result)
    const parsed = parseUnifiedDiff(result.stdout)
    return { ...base, hunks: parsed.hunks, binary: parsed.binary, untracked: false, truncated: result.truncated }
  }

  /** Resolve the executable once, and cancel the resolution with the plugin. */
  private resolveRunner(): Promise<GitResolution> {
    this.resolution ??= this.resolveOnce()
    return this.resolution
  }

  private async resolveOnce(): Promise<GitResolution> {
    try {
      const resolved = await resolveGitExecutable(this.ctx.subprocess, this.lifetime.signal)
      if ('reason' in resolved) return { kind: 'unavailable', reason: resolved.reason }
      return {
        kind: 'runner',
        runner: new GitRunner(this.ctx.subprocess, resolved.executable, {
          timeoutMs: this.config.timeoutMs,
          outputMaxBytes: this.config.outputMaxBytes,
        }),
      }
    } catch (error: unknown) {
      // Nothing is cached from a resolution that failed for its own reasons; the
      // next request tries again.
      this.resolution = undefined
      throw error
    }
  }

  /** The runner, or the explicit refusal the Client renders as "git is unavailable". */
  private async requireRunner(): Promise<GitRunner> {
    const resolution = await this.resolveRunner()
    if (resolution.kind === 'unavailable') {
      throw new RemoteError('git/unavailable', `git is unavailable (${resolution.reason})`, { reason: resolution.reason })
    }
    return resolution.runner
  }

  /** Resolve one Workspace's canonical directory; the registration is the only path authority. */
  private workspacePath(workspaceId: WorkspaceId): string {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw new RemoteError('workspace/not-found', `no workspace "${workspaceId}"`, { workspaceId })
    }
    return workspace.path
  }

  /** Locate the working tree containing a Workspace, or undefined when it is outside every repository. */
  private async locate(workspaceId: WorkspaceId, signal: AbortSignal): Promise<LocatedRepository | undefined> {
    const runner = await this.requireRunner()
    const result = await runner.run(['rev-parse', '--show-toplevel'], { cwd: this.workspacePath(workspaceId), signal })
    if (result.exitCode === 0) {
      const root = result.stdout.split('\n')[0]
      if (root === undefined || root === '') throw this.failure('rev-parse', result)
      return { root }
    }
    if (result.exitCode === 128 && /not a git repository/i.test(result.stderr)) return undefined
    throw this.failure('rev-parse', result)
  }

  /** Locate the working tree, or refuse the call as one made outside a repository. */
  private async requireRepository(workspaceId: WorkspaceId, signal: AbortSignal): Promise<LocatedRepository> {
    const located = await this.locate(workspaceId, signal)
    if (located === undefined) {
      throw new RemoteError('git/not-a-repository', `workspace "${workspaceId}" is outside every git repository`, { workspaceId })
    }
    return located
  }

  /** Every ref, whether or not the caller keeps all of them. */
  private async readRefs(root: string, signal: AbortSignal): Promise<GitRefView[]> {
    const runner = await this.requireRunner()
    const result = await runner.run(['for-each-ref', `--format=${REF_FORMAT}`], { cwd: root, signal })
    if (result.exitCode !== 0) throw this.failure('for-each-ref', result)
    return parseRefs(result.stdout)
  }

  /** Short ref names by the commit they point at, for decorating a history page. */
  private async decorations(root: string, signal: AbortSignal): Promise<Map<string, string[]>> {
    const byOid = new Map<string, string[]>()
    for (const ref of await this.readRefs(root, signal)) {
      const names = byOid.get(ref.oid)
      if (names === undefined) byOid.set(ref.oid, [ref.shortName])
      else names.push(ref.shortName)
    }
    return byOid
  }

  /** One commit's changed files: line counts from `--numstat`, kinds from `--raw`. */
  private async readFileChanges(root: string, revision: string, signal: AbortSignal): Promise<GitFileChangeView[]> {
    const runner = await this.requireRunner()
    const shared = ['-r', '-M', '-z', '--no-commit-id', '--root', revision]
    const stats = await runner.run(['diff-tree', '--numstat', ...shared], { cwd: root, signal })
    if (stats.exitCode !== 0) throw this.failure('diff-tree', stats)
    if (stats.truncated) throw this.outputCut('diff-tree')
    const raw = await runner.run(['diff-tree', '--raw', ...shared], { cwd: root, signal })
    if (raw.exitCode !== 0) throw this.failure('diff-tree', raw)
    const kinds = new Map(parseRawChanges(raw.stdout).map(change => [change.path, change.kind]))
    return parseNumstat(stats.stdout).map(entry => ({
      path: entry.path,
      ...entry.oldPath === undefined ? {} : { from: entry.oldPath },
      kind: kinds.get(entry.path) ?? (entry.oldPath === undefined ? 'modified' : 'renamed'),
      insertions: entry.added,
      deletions: entry.deleted,
      binary: entry.binary,
    }))
  }

  /** The wire failure for a command that exited nonzero or was killed. */
  private failure(command: string, result: GitRunResult): RemoteError {
    const detail = result.stderr.trim() === '' ? `exit ${String(result.exitCode)}` : result.stderr.trim()
    return new RemoteError('git/command-failed', `git ${command} failed: ${detail}`, { command })
  }

  /** The wire failure for a command whose stdout the configured cap cut short, which no parser can read. */
  private outputCut(command: string): RemoteError {
    return new RemoteError(
      'git/command-failed',
      `git ${command} failed: stdout exceeded the configured output cap`,
      { command },
    )
  }
}

export default GitController
