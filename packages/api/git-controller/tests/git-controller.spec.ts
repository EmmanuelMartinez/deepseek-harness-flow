/**
 * Git repository reads against real git through the real local subprocess
 * provider, in a temporary repository built by the case itself.
 *
 * Only the Workspace registry is supplied by the test: it is the external
 * authority that names a directory, and this service reads nothing more of it
 * than `get`. Real git is what makes these assertions meaningful — the parsers
 * read porcelain output that no fixture can vouch for.
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { remoteErrorOf, type RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import { GitController, type Config } from '../src/index.ts'

const CONFIG: Config = {
  timeoutMs: 30_000,
  outputMaxBytes: 4 * 1024 * 1024,
  maxRefs: 100,
  maxStatusEntries: 100,
  maxLogPage: 10,
  maxCommitFiles: 100,
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const signal = (): AbortSignal => new AbortController().signal

/** Run one git command for fixture setup, outside the service under test. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

/** One temporary repository and the Host context serving it. */
interface Bench {
  readonly controller: GitController
  readonly repo: string
  readonly workspaceId: WorkspaceId
  /** Register one more directory as a Workspace. */
  add(directory: string): WorkspaceId
}

/** Build a repository with one commit and a `v1` tag on it. */
async function seeded(config: Config = CONFIG): Promise<Bench> {
  const base = await mkdtemp(join(tmpdir(), 'git-controller-'))
  const repo = join(base, 'repo')
  await mkdir(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'first commit')
  git(repo, 'tag', '-a', 'v1', '-m', 'release one')
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime).await()
  const workspaces = new Map<WorkspaceId, { readonly path: string }>()
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => workspaces.get(id) } as never)
  const controller = new GitController(ctx, config)
  const add = (directory: string): WorkspaceId => {
    const id = WorkspaceId(`ws-${String(workspaces.size)}`)
    workspaces.set(id, { path: directory })
    return id
  }
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(base, { recursive: true, force: true })
  })
  return { controller, repo, workspaceId: add(repo), add }
}

/** The Remote failure one refused call produced. */
async function refusal(operation: () => Promise<unknown>): Promise<RemoteFailure> {
  const error = await operation().then(() => undefined, (cause: unknown) => cause)
  const failure = remoteErrorOf(error)
  if (failure === undefined) throw new Error(`expected a Remote failure, received ${String(error)}`)
  return failure
}

describe('GitController repository and status', () => {
  it('reports the repository behind a workspace, its branch, and its commit', async () => {
    const bench = await seeded()
    const result = await bench.controller.repository(bench.workspaceId, signal())
    expect(result.kind).toBe('repository')
    if (result.kind !== 'repository') throw new Error('expected a repository')
    expect(result.repository.name).toBe('repo')
    expect(result.repository.head).toMatchObject({ kind: 'branch', branch: 'main' })
    if (result.repository.head.kind !== 'branch') throw new Error('expected a branch')
    expect(result.repository.head.oid).toMatch(/^[0-9a-f]{40}$/u)
    expect(result.repository.root).toBe(realPath(bench.repo))
    expect(result.repository.upstream).toBeUndefined()
  })

  it('reports a workspace outside every repository as such, and refuses repository reads there', async () => {
    const bench = await seeded()
    const outside = join(dirname(bench.repo), 'outside')
    await mkdir(outside)
    const id = bench.add(outside)
    expect(await bench.controller.repository(id, signal())).toEqual({ kind: 'not-a-repository' })
    expect((await refusal(() => bench.controller.status(id, signal()))).code).toBe('git/not-a-repository')
  })

  it('refuses a workspace no registration carries', async () => {
    const bench = await seeded()
    const failure = await refusal(() => bench.controller.repository(WorkspaceId('missing'), signal()))
    expect(failure.code).toBe('workspace/not-found')
  })

  it('reports staged, unstaged, and untracked paths independently', async () => {
    const bench = await seeded()
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\n')
    git(bench.repo, 'add', 'a.txt')
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(bench.repo, 'b.txt'), 'new\n')
    const view = await bench.controller.status(bench.workspaceId, signal())
    expect(view.truncated).toBe(false)
    expect(view.entries.find(entry => entry.path === 'a.txt')).toMatchObject({
      index: 'modified',
      worktree: 'modified',
    })
    expect(view.entries.find(entry => entry.path === 'b.txt')).toMatchObject({
      index: 'unmodified',
      worktree: 'untracked',
    })
  })
})

describe('GitController history', () => {
  it('walks the history with parents, ref decorations, and paging', async () => {
    const bench = await seeded()
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\n')
    git(bench.repo, 'commit', '-qam', 'second commit')
    const page = await bench.controller.log(bench.workspaceId, { limit: 1 }, signal())
    expect(page.commits).toHaveLength(1)
    expect(page.more).toBe(true)
    expect(page.commits[0]?.subject).toBe('second commit')
    expect(page.commits[0]?.parents).toHaveLength(1)
    expect(page.commits[0]?.refs).toContain('main')
    const older = await bench.controller.log(bench.workspaceId, { limit: 1, skip: 1 }, signal())
    expect(older.commits[0]?.subject).toBe('first commit')
    expect(older.commits[0]?.refs).toContain('v1')
    expect(older.more).toBe(false)
  })

  it('lists every branch, remote, and tag with its target commit', async () => {
    const bench = await seeded()
    git(bench.repo, 'branch', 'side')
    const { refs, truncated } = await bench.controller.refs(bench.workspaceId, signal())
    expect(truncated).toBe(false)
    expect(refs.map(ref => ref.shortName).sort()).toEqual(['main', 'side', 'v1'])
    expect(refs.find(ref => ref.shortName === 'main')?.head).toBe(true)
    const tag = refs.find(ref => ref.kind === 'tag')
    expect(tag?.subject).toBe('first commit')
    expect(tag?.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it('reports an empty history for a repository with no commits', async () => {
    const bench = await seeded()
    const fresh = join(dirname(bench.repo), 'fresh')
    await mkdir(fresh)
    git(fresh, 'init', '-q', '-b', 'main')
    const id = bench.add(fresh)
    expect(await bench.controller.log(id, {}, signal())).toEqual({ commits: [], more: false })
    const repository = await bench.controller.repository(id, signal())
    expect(repository.kind === 'repository' && repository.repository.head.kind).toBe('unborn')
  })

  it('reports a commit message body and its changed files', async () => {
    const bench = await seeded()
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\n')
    await writeFile(join(bench.repo, 'fresh.txt'), 'added\n')
    git(bench.repo, 'add', '.')
    git(bench.repo, 'commit', '-qm', 'second commit', '-m', 'The body explains it.')
    const oid = git(bench.repo, 'rev-parse', 'HEAD').trim()
    const detail = await bench.controller.commit(bench.workspaceId, oid, signal())
    expect(detail.subject).toBe('second commit')
    expect(detail.body).toBe('The body explains it.')
    expect(detail.filesTruncated).toBe(false)
    const kinds = new Map(detail.files.map(file => [file.path, file]))
    expect(kinds.get('a.txt')).toMatchObject({ kind: 'modified', insertions: 1, deletions: 0, binary: false })
    expect(kinds.get('fresh.txt')).toMatchObject({ kind: 'added', insertions: 1, deletions: 0 })
  })

  it('refuses a commit whose numstat read the output cap cut short', async () => {
    const bench = await seeded({ ...CONFIG, outputMaxBytes: 900 })
    for (let index = 0; index < 150; index += 1) {
      await writeFile(join(bench.repo, `f${String(index).padStart(3, '0')}.txt`), 'x\n')
    }
    git(bench.repo, 'add', '.')
    git(bench.repo, 'commit', '-qm', 'many files')
    const oid = git(bench.repo, 'rev-parse', 'HEAD').trim()

    expect((await refusal(() => bench.controller.commit(bench.workspaceId, oid, signal()))).code)
      .toBe('git/command-failed')
  })

  it('reports a root commit as every file added', async () => {
    const bench = await seeded()
    const oid = git(bench.repo, 'rev-parse', 'HEAD').trim()
    const detail = await bench.controller.commit(bench.workspaceId, oid, signal())
    expect(detail.files.map(file => file.path)).toEqual(['a.txt'])
    expect(detail.files[0]).toMatchObject({ kind: 'added', insertions: 1 })
    expect(detail.parents).toEqual([])
  })
})

describe('GitController comparisons', () => {
  it('compares one file across the working tree, the index, and a commit', async () => {
    const bench = await seeded()
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\n')
    git(bench.repo, 'add', 'a.txt')
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(bench.repo, 'b.txt'), 'untracked\n')
    const worktree = await bench.controller.diff(
      bench.workspaceId,
      { path: 'a.txt', side: { kind: 'worktree' } },
      signal(),
    )
    expect(worktree.untracked).toBe(false)
    expect(worktree.binary).toBe(false)
    expect(worktree.hunks.flatMap(hunk => hunk.lines).some(line => line.kind === 'add' && line.text === 'three'))
      .toBe(true)
    const staged = await bench.controller.diff(
      bench.workspaceId,
      { path: 'a.txt', side: { kind: 'index' } },
      signal(),
    )
    expect(staged.hunks.flatMap(hunk => hunk.lines).some(line => line.kind === 'add' && line.text === 'two')).toBe(true)
    expect(staged.hunks.flatMap(hunk => hunk.lines).some(line => line.text === 'three')).toBe(false)
    const untracked = await bench.controller.diff(
      bench.workspaceId,
      { path: 'b.txt', side: { kind: 'worktree' } },
      signal(),
    )
    expect(untracked).toMatchObject({ untracked: true, hunks: [], binary: false })
  })

  it('compares a file inside a commit against its parent', async () => {
    const bench = await seeded()
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\n')
    git(bench.repo, 'commit', '-qam', 'second commit')
    const oid = git(bench.repo, 'rev-parse', 'HEAD').trim()
    const diff = await bench.controller.diff(
      bench.workspaceId,
      { path: 'a.txt', side: { kind: 'commit', oid } },
      signal(),
    )
    expect(diff.hunks.flatMap(hunk => hunk.lines).some(line => line.kind === 'add' && line.text === 'two')).toBe(true)
  })

  it('follows a rename through its previous path', async () => {
    const bench = await seeded()
    await writeFile(join(bench.repo, 'a.txt'), 'one\ntwo\n')
    git(bench.repo, 'add', 'a.txt')
    git(bench.repo, 'mv', 'a.txt', 'renamed.txt')
    const status = await bench.controller.status(bench.workspaceId, signal())
    const renamed = status.entries.find(entry => entry.path === 'renamed.txt')
    expect(renamed?.from).toBe('a.txt')
    const diff = await bench.controller.diff(
      bench.workspaceId,
      { path: 'renamed.txt', from: 'a.txt', side: { kind: 'index' } },
      signal(),
    )
    expect(diff.hunks.flatMap(hunk => hunk.lines).some(line => line.kind === 'add' && line.text === 'two')).toBe(true)
  })
})

describe('GitController refusals', () => {
  it('refuses a path that leaves the repository and an option-like revision', async () => {
    const bench = await seeded()
    expect((await refusal(() => bench.controller.diff(
      bench.workspaceId,
      { path: '../outside.txt', side: { kind: 'worktree' } },
      signal(),
    ))).code).toBe('git/bad-request')
    expect((await refusal(() => bench.controller.log(bench.workspaceId, { rev: '--all' }, signal()))).code)
      .toBe('git/bad-request')
    expect((await refusal(() => bench.controller.commit(bench.workspaceId, 'not-an-oid', signal()))).code)
      .toBe('git/bad-request')
  })

  it('reports an unknown revision as such', async () => {
    const bench = await seeded()
    expect((await refusal(() => bench.controller.log(bench.workspaceId, { rev: 'nope' }, signal()))).code)
      .toBe('git/unknown-revision')
    expect((await refusal(() => bench.controller.commit(bench.workspaceId, 'deadbeef', signal()))).code)
      .toBe('git/unknown-revision')
  })

  it('reports git as unavailable when no executable resolves', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', {
      resolveExecutable: async () => { throw new SubprocessExecutableNotFoundError('git not found') },
    } as never)
    ctx.provide('workspaceRegistry', { get: () => ({ path: '/tmp' }) } as never)
    const controller = new GitController(ctx, CONFIG)
    expect((await refusal(() => controller.repository(WorkspaceId('ws'), signal()))).code).toBe('git/unavailable')
    await ctx.fiber.dispose()
  })
})

/** The canonical path of a directory, as git reports its top level. */
function realPath(path: string): string {
  return realpathSync(path)
}
