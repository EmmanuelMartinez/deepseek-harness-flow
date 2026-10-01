/**
 * The editor model: what a document holds after a read, what an edit makes
 * dirty, how a save sends the version it read, what a stale write does to the
 * buffer, and how autosave follows a pause in typing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { AUTOSAVE_DELAY_MS, EditorModel, documentId } from '../src/client/model.ts'

const WORKSPACE = 'ws-one' as WorkspaceId
const PATH = 'dir/notes.txt'

/** A scripted workspaceEditor namespace with a mutable "disk". */
function seam(initial = 'first\n') {
  const disk = { text: initial, version: 1 }
  const document = {
    path: PATH,
    absolutePath: `/w/${PATH}`,
    version: `v${String(disk.version)}`,
    bytes: disk.text.length,
    text: disk.text,
  }
  return {
    disk,
    remote: {
      read: vi.fn(async () => ({ ok: true as const, value: { ...document, version: `v${String(disk.version)}`, bytes: disk.text.length, text: disk.text } })),
      write: vi.fn(async (
        _workspaceId: WorkspaceId,
        _path: string,
        text: string,
        expected: { kind: 'replaceIfVersion'; version: string },
      ) => {
        if (expected.version !== `v${String(disk.version)}`) {
          return {
            ok: false as const,
            error: {
              code: 'workspace-editor/stale',
              message: 'changed',
              details: { path: PATH, current: `v${String(disk.version)}` },
            },
          }
        }
        disk.text = text
        disk.version += 1
        return {
          ok: true as const,
          value: { path: PATH, absolutePath: `/w/${PATH}`, version: `v${String(disk.version)}`, bytes: text.length },
        }
      }),
      stat: vi.fn(),
    },
  }
}

/** The model's snapshot for one open document. */
function only(model: EditorModel) {
  const state = model.getSnapshot()
  const document = state.documents[0]
  if (document === undefined) throw new Error('no document is open')
  return document
}

/** A git namespace stub: one repository, one status entry, one comparison. */function gitSeam(entry?: Record<string, unknown>) {
  const entry0 = entry ?? { path: PATH, index: 'unmodified', worktree: 'modified' }
  return {
    repository: vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: 'repository' as const,
        repository: { root: '/w', name: 'w', head: { kind: 'branch' as const, branch: 'main', oid: 'a'.repeat(40) } },
      },
    })),
    status: vi.fn(async () => ({
      ok: true as const,
      value: { entries: Object.keys(entry0).length === 0 ? [] : [entry0], truncated: false },
    })),
    diff: vi.fn(async () => ({
      ok: true as const,
      value: {
        path: PATH,
        hunks: [{
          header: '@@ -1,2 +1,2 @@',
          lines: [
            { kind: 'context' as const, text: 'a' },
            { kind: 'delete' as const, text: 'b' },
            { kind: 'add' as const, text: 'B' },
          ],
        }],
        binary: false,
        untracked: false,
        truncated: false,
      },
    })),
  }
}

/** A resolver that knows the one Workspace this suite opens documents in. */
const OPENED = (): { workspaceId: WorkspaceId; root: string } => ({ workspaceId: WORKSPACE, root: '/w' })

/** A resolver for a composition with no Workspace containing the path. */
const NO_WORKSPACE = (): undefined => undefined

/** One open, loaded document over the given git seam. */
async function opened(git?: ReturnType<typeof gitSeam>) {
  const { remote } = seam()
  const model = new EditorModel(remote as never, OPENED, git as never)
  models.push(model)
  model.open(WORKSPACE, PATH)
  await vi.waitFor(() => { expect(only(model).busy).toBe(false) })
  return { model, remote }
}

const models: EditorModel[] = []
afterEach(() => {
  for (const model of models.splice(0)) model.dispose()
  vi.useRealTimers()
})

describe('EditorModel reads', () => {
  it('loads a document clean, with the version a save sends back', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.waitFor(() => { expect(only(model).busy).toBe(false) })
    expect(only(model)).toMatchObject({
      id: documentId(WORKSPACE, PATH),
      name: 'notes.txt',
      text: 'first\n',
      saved: 'first\n',
      version: 'v1',
      dirty: false,
    })
    expect(model.getSnapshot().active).toBe(documentId(WORKSPACE, PATH))
  })

  it('reveals an already open document instead of reading it twice', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.waitFor(() => { expect(only(model).busy).toBe(false) })
    model.open(WORKSPACE, PATH)
    expect(remote.read).toHaveBeenCalledTimes(1)
    expect(model.getSnapshot().documents).toHaveLength(1)
  })
})

describe('EditorModel writes', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('marks an edit dirty and saves it at the version it read', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.advanceTimersByTimeAsync(0)
    model.edit(documentId(WORKSPACE, PATH), 'second\n')
    expect(only(model).dirty).toBe(true)
    await model.save(documentId(WORKSPACE, PATH))
    expect(remote.write).toHaveBeenCalledWith(
      WORKSPACE,
      PATH,
      'second\n',
      { kind: 'replaceIfVersion', version: 'v1' },
    )
    expect(only(model)).toMatchObject({ saved: 'second\n', dirty: false, version: 'v2' })
  })

  it('saves nothing when the buffer matches the file', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.advanceTimersByTimeAsync(0)
    await model.save(documentId(WORKSPACE, PATH))
    expect(remote.write).not.toHaveBeenCalled()
  })

  it('refuses a stale save, keeps the buffer, and clears the conflict on reload', async () => {
    const { remote, disk } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.advanceTimersByTimeAsync(0)
    model.edit(documentId(WORKSPACE, PATH), 'mine\n')
    // Somebody else writes the file first.
    disk.text = 'theirs\n'
    disk.version += 1
    await model.save(documentId(WORKSPACE, PATH))
    expect(only(model)).toMatchObject({ dirty: true, text: 'mine\n', conflict: { current: 'v2' } })
    expect(only(model).failure?.code).toBe('workspace-editor/stale')
    await model.reload(documentId(WORKSPACE, PATH))
    expect(only(model)).toMatchObject({ text: 'theirs\n', saved: 'theirs\n', dirty: false, version: 'v2' })
    expect(only(model).conflict).toBeUndefined()
    expect(only(model).failure).toBeUndefined()
  })

  it('saves after a pause in typing once autosave is on', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.advanceTimersByTimeAsync(0)
    model.toggleAutosave()
    expect(model.getSnapshot().autosave).toBe(true)
    model.edit(documentId(WORKSPACE, PATH), 'auto\n')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(remote.write).toHaveBeenCalledTimes(1)
    expect(only(model).dirty).toBe(false)
  })

  it('flushes a dirty buffer when autosave is turned off', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    await vi.advanceTimersByTimeAsync(0)
    model.toggleAutosave()
    model.edit(documentId(WORKSPACE, PATH), 'auto\n')
    model.toggleAutosave()
    await vi.advanceTimersByTimeAsync(0)
    expect(remote.write).toHaveBeenCalledTimes(1)
    expect(only(model).dirty).toBe(false)
  })
})

describe('EditorModel absolute paths', () => {
  it('opens the document one absolute path names, under the workspace that contains it', async () => {
    const { remote } = seam()
    const model = new EditorModel(remote as never, OPENED)
    models.push(model)
    expect(model.openAbsolute('/w/other/file.ts')).toBe(true)
    await vi.waitFor(() => { expect(model.getSnapshot().documents).toHaveLength(1) })
    expect(model.getSnapshot().documents[0]).toMatchObject({
      workspaceId: WORKSPACE,
      path: 'other/file.ts',
      name: 'file.ts',
    })
  })

  it('refuses a path no workspace contains, and one its resolver does not cover', () => {
    const { remote } = seam()
    const none = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(none)
    expect(none.openAbsolute('/w/dir/notes.txt')).toBe(false)
    expect(none.getSnapshot().documents).toHaveLength(0)

    const wrongRoot = new EditorModel(remote as never, OPENED)
    models.push(wrongRoot)
    expect(wrongRoot.openAbsolute('/elsewhere/notes.txt')).toBe(false)
    expect(wrongRoot.getSnapshot().documents).toHaveLength(0)
  })
})

describe('EditorModel comparisons', () => {
  it('compares the working tree when that side holds the change', async () => {
    const git = gitSeam()
    const { model } = await opened(git)
    expect(model.getSnapshot().gitAvailable).toBe(true)
    model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(model).diff?.kind).toBe('ready') })
    expect(git.status).toHaveBeenCalledWith(WORKSPACE)
    expect(git.diff).toHaveBeenCalledWith(WORKSPACE, { path: PATH, side: { kind: 'worktree' } })
    const diff = only(model).diff
    if (diff?.kind !== 'ready') throw new Error('expected a ready comparison')
    expect(diff.side).toBe('worktree')
    expect(diff.hunks[0]?.lines.map(line => line.kind)).toEqual(['context', 'delete', 'add'])
    model.showEdit(documentId(WORKSPACE, PATH))
    expect(only(model).mode).toBe('edit')
  })

  it('compares the index when the change is already staged', async () => {
    const git = gitSeam({ path: PATH, index: 'modified', worktree: 'unmodified' })
    const { model } = await opened(git)
    model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(model).diff?.kind).toBe('ready') })
    expect(git.diff).toHaveBeenCalledWith(WORKSPACE, { path: PATH, side: { kind: 'index' } })
  })

  it('carries a rename through its previous path', async () => {
    const git = gitSeam({ path: PATH, from: 'dir/old.txt', index: 'renamed', worktree: 'unmodified' })
    const { model } = await opened(git)
    model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(model).diff?.kind).toBe('ready') })
    expect(git.diff).toHaveBeenCalledWith(WORKSPACE, {
      path: PATH,
      from: 'dir/old.txt',
      side: { kind: 'index' },
    })
  })

  it('reports a file the repository holds no change for', async () => {
    const git = gitSeam({ path: 'another.txt', index: 'modified', worktree: 'unmodified' })
    const { model } = await opened(git)
    model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(model).diff).toEqual({ kind: 'unchanged' }) })
    expect(git.diff).not.toHaveBeenCalled()
  })

  it('reports a workspace outside every repository, and a composition without git', async () => {
    const outside = gitSeam()
    outside.repository.mockResolvedValue({ ok: true, value: { kind: 'not-a-repository' } } as never)
    const withGit = await opened(outside)
    withGit.model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(withGit.model).diff).toEqual({ kind: 'unavailable' }) })

    const withoutGit = await opened(undefined)
    expect(withoutGit.model.getSnapshot().gitAvailable).toBe(false)
    withoutGit.model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(withoutGit.model).diff).toEqual({ kind: 'unavailable' }) })
  })

  it('drops a comparison once the file is written', async () => {
    const git = gitSeam()
    const { model } = await opened(git)
    model.showDiff(documentId(WORKSPACE, PATH))
    await vi.waitFor(() => { expect(only(model).diff?.kind).toBe('ready') })
    model.edit(documentId(WORKSPACE, PATH), 'second\n')
    await model.save(documentId(WORKSPACE, PATH))
    expect(only(model).diff).toBeUndefined()
  })
})

describe('EditorModel tabs', () => {
  it('closes a document and keeps the remaining one active', async () => {
    vi.useFakeTimers()
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    models.push(model)
    model.open(WORKSPACE, PATH)
    model.open(WORKSPACE, 'other.txt')
    await vi.advanceTimersByTimeAsync(0)
    model.activate(documentId(WORKSPACE, PATH))
    model.close(documentId(WORKSPACE, PATH))
    const state = model.getSnapshot()
    expect(state.documents.map(document => document.name)).toEqual(['other.txt'])
    expect(state.active).toBe(documentId(WORKSPACE, 'other.txt'))
  })

  it('stops publishing once disposed', async () => {
    vi.useFakeTimers()
    const { remote } = seam()
    const model = new EditorModel(remote as never, NO_WORKSPACE)
    const listener = vi.fn()
    model.subscribe(listener)
    model.open(WORKSPACE, PATH)
    await vi.advanceTimersByTimeAsync(0)
    listener.mockClear()
    model.dispose()
    model.edit(documentId(WORKSPACE, PATH), 'after\n')
    expect(listener).not.toHaveBeenCalled()
  })
})
