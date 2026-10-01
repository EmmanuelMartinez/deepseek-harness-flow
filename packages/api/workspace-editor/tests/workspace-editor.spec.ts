/**
 * Workspace document reads and writes against the real local filesystem: the
 * version check that stops a stale buffer, the confinement to the Workspace,
 * and the write policy the user's own edit runs under.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceEditor, type Config } from '../src/index.ts'

const CONFIG: Config = { maxFileBytes: 1024 * 1024, writeMode: 'danger-full-access' }
const SIGNAL = (): AbortSignal => new AbortController().signal

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** One workspace root, its outside sibling, and the service serving them. */
interface Bench {
  readonly editor: WorkspaceEditor
  readonly workspace: string
  readonly outside: string
  readonly workspaceId: WorkspaceId
  readonly resolvePolicy: ReturnType<typeof vi.fn>
}

/**
 * Build a workspace beside a directory outside it.
 * @param caps - config overrides for the service under test.
 * @returns the harness; every test disposes it in `afterEach`.
 */
async function bench(caps: Partial<Config> = {}): Promise<Bench> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-editor-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalFileSystem, { cwd: workspace })
  const resolvePolicy = vi.fn(() => ({ mode: 'danger-full-access', workspaceRoot: workspace }))
  ctx.provide('sandboxPolicy', { workspaceRoot: workspace, resolve: resolvePolicy } as never)
  const workspaceId = WorkspaceId('ws-editor')
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspaceId ? { path: workspace } : undefined,
  } as never)
  const editor = new WorkspaceEditor(ctx, { ...CONFIG, ...caps })
  cleanups.push(async () => {
    await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { editor, workspace, outside, workspaceId, resolvePolicy }
}

/** The Remote failure one refused call produced. */
async function failureOf(operation: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  const error = await operation.then(() => undefined, (cause: unknown) => cause)
  const failure = remoteErrorOf(error)
  if (failure === undefined) throw new Error(`expected a Remote failure, received ${String(error)}`)
  return { code: failure.code, details: failure.details }
}

describe('WorkspaceEditor reads', () => {
  it('reads a document with the version a write must send back', async () => {
    const b = await bench()
    await writeFile(join(b.workspace, 'notes.txt'), 'first\n')
    const document = await b.editor.read(b.workspaceId, 'notes.txt', SIGNAL())
    expect(document.path).toBe('notes.txt')
    expect(document.text).toBe('first\n')
    expect(document.bytes).toBe(6)
    expect(document.version).not.toBe('')
    expect(document.absolutePath.endsWith('/workspace/notes.txt')).toBe(true)
    expect(await b.editor.stat(b.workspaceId, 'notes.txt', SIGNAL())).toMatchObject({
      path: 'notes.txt',
      version: document.version,
      bytes: 6,
    })
  })

  it('refuses a path outside the workspace, a missing file, and a directory', async () => {
    const b = await bench()
    await writeFile(join(b.outside, 'other.txt'), 'x\n')
    await mkdir(join(b.workspace, 'dir'))
    expect((await failureOf(b.editor.read(b.workspaceId, '../outside/other.txt', SIGNAL()))).code)
      .toBe('workspace-editor/outside-workspace')
    expect((await failureOf(b.editor.read(b.workspaceId, '/etc/hosts', SIGNAL()))).code)
      .toBe('workspace-editor/outside-workspace')
    expect((await failureOf(b.editor.read(b.workspaceId, 'missing.txt', SIGNAL()))).code)
      .toBe('workspace-editor/not-found')
    expect((await failureOf(b.editor.read(b.workspaceId, 'dir', SIGNAL()))).code)
      .toBe('workspace-editor/not-regular-file')
  })

  it('refuses binary content and a document above the cap', async () => {
    const b = await bench({ maxFileBytes: 16 })
    await writeFile(join(b.workspace, 'binary.bin'), Buffer.from([0x61, 0x00, 0x62]))
    await writeFile(join(b.workspace, 'long.txt'), 'x'.repeat(64))
    expect((await failureOf(b.editor.read(b.workspaceId, 'binary.bin', SIGNAL()))).code)
      .toBe('workspace-editor/not-text')
    expect((await failureOf(b.editor.read(b.workspaceId, 'long.txt', SIGNAL()))).code)
      .toBe('workspace-editor/too-large')
  })
})

describe('WorkspaceEditor writes', () => {
  it('replaces a document at the version it was read, and reports the new version', async () => {
    const b = await bench()
    await writeFile(join(b.workspace, 'notes.txt'), 'first\n')
    const document = await b.editor.read(b.workspaceId, 'notes.txt', SIGNAL())
    const written = await b.editor.write(
      b.workspaceId,
      'notes.txt',
      'second\n',
      { kind: 'replaceIfVersion', version: document.version },
      SIGNAL(),
    )
    expect(await readFile(join(b.workspace, 'notes.txt'), 'utf8')).toBe('second\n')
    expect(written.version).not.toBe(document.version)
    expect(written.bytes).toBe(7)
  })

  it('refuses a stale buffer and reports the version the file holds now', async () => {
    const b = await bench()
    await writeFile(join(b.workspace, 'notes.txt'), 'first\n')
    const document = await b.editor.read(b.workspaceId, 'notes.txt', SIGNAL())
    // Somebody else — the Agent, another tab — moves the file on.
    await writeFile(join(b.workspace, 'notes.txt'), 'theirs\n')
    const failure = await failureOf(b.editor.write(
      b.workspaceId,
      'notes.txt',
      'mine\n',
      { kind: 'replaceIfVersion', version: document.version },
      SIGNAL(),
    ))
    expect(failure.code).toBe('workspace-editor/stale')
    expect(failure.details).toMatchObject({ path: 'notes.txt' })
    expect((failure.details as { current?: string }).current).toBeDefined()
    expect(await readFile(join(b.workspace, 'notes.txt'), 'utf8')).toBe('theirs\n')
  })

  it('creates an absent document and refuses to overwrite an existing one', async () => {
    const b = await bench()
    const created = await b.editor.write(b.workspaceId, 'fresh.txt', 'new\n', { kind: 'createIfAbsent' }, SIGNAL())
    expect(created).toMatchObject({ path: 'fresh.txt', bytes: 4 })
    expect(await readFile(join(b.workspace, 'fresh.txt'), 'utf8')).toBe('new\n')
    expect((await failureOf(b.editor.write(
      b.workspaceId,
      'fresh.txt',
      'again\n',
      { kind: 'createIfAbsent' },
      SIGNAL(),
    ))).code).toBe('workspace-editor/not-observed')
    expect(await readFile(join(b.workspace, 'fresh.txt'), 'utf8')).toBe('new\n')
  })

  it('refuses a write outside the workspace and content above the cap', async () => {
    const b = await bench({ maxFileBytes: 16 })
    expect((await failureOf(b.editor.write(
      b.workspaceId,
      '../outside/other.txt',
      'x\n',
      { kind: 'createIfAbsent' },
      SIGNAL(),
    ))).code).toBe('workspace-editor/outside-workspace')
    expect((await failureOf(b.editor.write(
      b.workspaceId,
      'big.txt',
      'x'.repeat(64),
      { kind: 'createIfAbsent' },
      SIGNAL(),
    ))).code).toBe('workspace-editor/too-large')
  })

  it('performs the write under the configured policy mode', async () => {
    const b = await bench({ writeMode: 'workspace-write' })
    await b.editor.write(b.workspaceId, 'fresh.txt', 'new\n', { kind: 'createIfAbsent' }, SIGNAL())
    expect(b.resolvePolicy).toHaveBeenCalledWith({ mode: 'workspace-write' })
  })

  it('refuses a workspace no registration carries', async () => {
    const b = await bench()
    expect((await failureOf(b.editor.read(WorkspaceId('missing'), 'a.txt', SIGNAL()))).code)
      .toBe('workspace/not-found')
  })
})
