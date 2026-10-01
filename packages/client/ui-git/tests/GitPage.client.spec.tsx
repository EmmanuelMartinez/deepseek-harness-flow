// @vitest-environment jsdom
/**
 * The Git page's rendering: each state it can show, the rows it draws, and the
 * selections its controls report. Props are fed directly, so the assertions are
 * about what a user sees rather than about the slot machinery.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, RemoteError, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GitPage, type GitPageProps } from '../src/client/GitPage.tsx'
import type { GitPanelInjected } from '../src/client/slots.ts'
import type { GitPanelState } from '../src/client/model.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const WORKSPACE = 'ws-one' as WorkspaceId
const OID = 'a'.repeat(40)

const ITEMS: readonly WorkspaceView[] = [{
  workspaceId: WORKSPACE,
  path: '/repo',
  title: 'repo',
  sessionIds: [],
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
}]

const REPOSITORY = {
  root: '/repo',
  name: 'repo',
  head: { kind: 'branch' as const, branch: 'main', oid: OID },
}

/** The seats this spec drives: the panel's injected face and the page's locale. */
type PageSeats = InjectFace<GitPanelInjected> & PropsLocale<'git'>

/**
 * A bare observable over one fixed snapshot: the currency the production renderer
 * turns into a selector hook.
 * @param snapshot - the value every read returns.
 * @returns the observable source.
 */
function source<T>(snapshot: T): HostObservable<T> {
  return { getSnapshot: () => snapshot, subscribe: () => () => undefined }
}

/** The page with one state, over scripted selections. */
function page(state: GitPanelState, overrides: Partial<{ workspaces: readonly WorkspaceView[] }> = {}) {
  const selectWorkspace = vi.fn()
  const selectCommit = vi.fn()
  const clearCommit = vi.fn()
  const openFile = vi.fn()
  const refresh = vi.fn()
  const seats: PageSeats = {
    useGitPanel: bindSnapshotSelector(source(state)),
    useGitWorkspaces: bindSnapshotSelector(source({ ...workspaceSnapshot(), items: overrides.workspaces ?? [] })),
    selectWorkspace,
    selectCommit,
    clearCommit,
    openFile,
    refresh,
    t: makeTranslate(zh),
  }
  // The renderer also binds the global standard kit (sessions, layout, resources);
  // browser-plugin.client.spec.tsx covers that wiring, so this spec mounts only its own seats.
  const props = seats as GitPageProps
  return { view: render(<GitPage {...props} />), selectWorkspace, selectCommit, clearCommit, openFile, refresh }
}

describe('GitPage states', () => {
  it('asks for a workspace before one is chosen', () => {
    const { view } = page({ phase: 'idle', notARepository: false, commits: [], more: false })
    expect(view.getByText(zh.noWorkspace)).toBeTruthy()
  })

  it('chooses the first workspace once rows exist', () => {
    const { selectWorkspace } = page(
      { phase: 'idle', notARepository: false, commits: [], more: false },
      { workspaces: ITEMS },
    )
    expect(selectWorkspace).toHaveBeenCalledWith(WORKSPACE)
  })

  it('reports a workspace outside every repository', () => {
    const { view } = page({
      workspaceId: WORKSPACE, phase: 'ready', notARepository: true, commits: [], more: false,
    })
    expect(view.getByText(zh.notARepository)).toBeTruthy()
  })

  it('names an unavailable git and any other failure separately', () => {
    const unavailable = page({
      workspaceId: WORKSPACE,
      phase: 'error',
      notARepository: false,
      commits: [],
      more: false,
      failure: new RemoteError('git/unavailable', 'no git', { reason: 'missing' }),
    })
    expect(unavailable.view.getByText(zh.unavailable)).toBeTruthy()
    cleanup()
    const failed = page({
      workspaceId: WORKSPACE,
      phase: 'error',
      notARepository: false,
      commits: [],
      more: false,
      failure: new RemoteError('git/command-failed', 'boom', { command: 'log' }),
    })
    expect(failed.view.getByText(zh.failed)).toBeTruthy()
  })
})

describe('GitPage content', () => {
  it('renders the branch, the changed paths, and the history rows', () => {
    const { view, selectCommit, refresh } = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: {
        entries: [
          { path: 'a.txt', index: 'modified', worktree: 'unmodified' },
          { path: 'b.txt', index: 'unmodified', worktree: 'untracked' },
          { path: 'c.txt', index: 'added', worktree: 'unmodified' },
        ],
        truncated: true,
      },
      refs: { refs: [], truncated: false },
      commits: [
        { oid: OID, parents: [], subject: 'second commit', authorName: 'T', authorEmail: 't@t', authoredAt: '2026-09-30T00:00:00.000Z', refs: ['main'] },
      ],
      more: true,
    })
    expect(view.getByText('repo')).toBeTruthy()
    // The branch chip and the commit's own ref chip both name the branch.
    expect(view.getAllByText('main')).toHaveLength(2)
    expect(view.getByText('a.txt')).toBeTruthy()
    expect(view.getByText('c.txt')).toBeTruthy()
    expect(view.getByText(zh.untracked)).toBeTruthy()
    expect(view.getByText('second commit')).toBeTruthy()
    expect(view.getByText(zh.truncated)).toBeTruthy()
    expect(view.getByText(zh.moreCommits)).toBeTruthy()

    fireEvent.click(view.getByText('second commit'))
    expect(selectCommit).toHaveBeenCalledWith(OID)
    fireEvent.click(view.getByRole('button', { name: zh.refresh }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('renders an empty repository without changed files or commits', () => {
    const { view } = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: { entries: [], truncated: false },
      refs: { refs: [], truncated: false },
      commits: [],
      more: false,
    })
    expect(view.getByText(zh.noChanges)).toBeTruthy()
    expect(view.getByText(zh.noCommits)).toBeTruthy()
  })

  it('renders the selected commit with its body, files, and counts', () => {
    const { view } = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: { entries: [], truncated: false },
      refs: { refs: [], truncated: false },
      commits: [
        { oid: OID, parents: [OID], subject: 'second commit', authorName: 'T', authorEmail: 't@t', authoredAt: '2026-09-30T00:00:00.000Z', refs: [] },
      ],
      more: false,
      selected: OID,
      commit: {
        oid: OID,
        parents: [OID],
        subject: 'second commit',
        authorName: 'T',
        authorEmail: 't@t',
        authoredAt: '2026-09-30T00:00:00.000Z',
        refs: ['main'],
        body: 'The body explains it.',
        files: [
          { path: 'a.txt', kind: 'modified', insertions: 2, deletions: 1, binary: false },
          { path: 'image.png', kind: 'added', insertions: 0, deletions: 0, binary: true },
        ],
        filesTruncated: true,
      },
    })
    expect(view.getByText('The body explains it.')).toBeTruthy()
    expect(view.getByText('+2 -1')).toBeTruthy()
    expect(view.getByText('image.png')).toBeTruthy()
    expect(view.getByText(zh.binary)).toBeTruthy()
    expect(view.getByText(zh.truncated)).toBeTruthy()
  })

  it('names each workspace in the picker and marks the selected one', () => {
    const { view, selectWorkspace } = page(
      {
        workspaceId: WORKSPACE,
        phase: 'ready',
        notARepository: false,
        repository: REPOSITORY,
        status: { entries: [], truncated: false },
        refs: { refs: [], truncated: false },
        commits: [],
        more: false,
      },
      {
        workspaces: [
          ...ITEMS,
          { ...ITEMS[0]!, workspaceId: 'ws-two' as WorkspaceId, title: 'other' },
        ],
      },
    )
    const other = view.getByRole('button', { name: 'other' })
    expect(other.getAttribute('data-active')).toBe('false')
    expect(view.getByRole('button', { name: 'repo' }).getAttribute('data-active')).toBe('true')
    fireEvent.click(other)
    expect(selectWorkspace).toHaveBeenCalledWith('ws-two')
  })

  it('folds the changed paths away and reports the toggle state', () => {
    const { view } = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: { entries: [{ path: 'a.txt', index: 'modified', worktree: 'unmodified' }], truncated: false },
      refs: { refs: [], truncated: false },
      commits: [],
      more: false,
    })
    const toggle = view.getByRole('button', { name: new RegExp(zh.changes) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('a.txt')).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('a.txt')).toBeNull()
  })

  it('opens a changed path and a commit file through the right column', () => {
    const changed = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: { entries: [{ path: 'dir/a.txt', index: 'modified', worktree: 'unmodified' }], truncated: false },
      refs: { refs: [], truncated: false },
      commits: [],
      more: false,
    })
    fireEvent.click(changed.view.getByText('a.txt'))
    expect(changed.openFile).toHaveBeenCalledWith('dir/a.txt')
    cleanup()

    const detail = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: { entries: [], truncated: false },
      refs: { refs: [], truncated: false },
      commits: [],
      more: false,
      selected: OID,
      commit: {
        oid: OID,
        parents: [],
        subject: 'second commit',
        authorName: 'T',
        authorEmail: 't@t',
        authoredAt: '2026-09-30T00:00:00.000Z',
        refs: [],
        body: '',
        files: [{ path: 'dir/b.txt', kind: 'modified', insertions: 1, deletions: 0, binary: false }],
        filesTruncated: false,
      },
    })
    fireEvent.click(detail.view.getByText('b.txt'))
    expect(detail.openFile).toHaveBeenCalledWith('dir/b.txt')
  })

  it('closes the commit detail from its own control', () => {
    const { view, clearCommit } = page({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: false,
      repository: REPOSITORY,
      status: { entries: [], truncated: false },
      refs: { refs: [], truncated: false },
      commits: [],
      more: false,
      selected: OID,
      commit: {
        oid: OID,
        parents: [],
        subject: 'second commit',
        authorName: 'T',
        authorEmail: 't@t',
        authoredAt: '2026-09-30T00:00:00.000Z',
        refs: [],
        body: '',
        files: [],
        filesTruncated: false,
      },
    })
    fireEvent.click(view.getByRole('button', { name: zh.close }))
    expect(clearCommit).toHaveBeenCalledTimes(1)
  })
})
