/**
 * The Git panel's React-free state: one Workspace's repository read over the
 * generated `git` Remote namespace.
 *
 * The model owns the workspace selection, the commit selection, and the request
 * generation, so a newer request discards a slower earlier answer instead of
 * publishing it. It is the registrant-private observable source the slot
 * renderer binds to `useGitPanel`.
 */
import type { ClientRemote, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChangeCountSource } from './change-count.ts'
import type {
  GitCommitDetailView,
  GitCommitView,
  GitRefsView,
  GitRepositoryView,
  GitStatusView,
  WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Commits one history page asks for. */
export const LOG_PAGE = 100

/** The generated `git` namespace as the browser calls it. */
export type GitRemote = ClientRemote['git']

/** Where the panel's read stands. */
export type GitPanelPhase = 'idle' | 'loading' | 'ready' | 'error'

/** Everything the panel renders, as one immutable value. */
export interface GitPanelState {
  /** Selected Workspace; absent until the panel picks one. */
  readonly workspaceId?: WorkspaceId
  readonly phase: GitPanelPhase
  /** Located repository; absent while loading, for a workspace outside one, and after a failure. */
  readonly repository?: GitRepositoryView
  /** Set once the read settled and the workspace's directory is inside no repository. */
  readonly notARepository: boolean
  readonly status?: GitStatusView
  readonly refs?: GitRefsView
  readonly commits: readonly GitCommitView[]
  /** Whether the history walk continues past {@link commits}. */
  readonly more: boolean
  /** Selected commit id; absent while none is selected. */
  readonly selected?: string
  /** Selected commit's detail; absent while it is loading or unselected. */
  readonly commit?: GitCommitDetailView
  readonly failure?: RemoteFailure
}

const INITIAL: GitPanelState = {
  phase: 'idle',
  notARepository: false,
  commits: [],
  more: false,
}

/** Observable Git panel state plus the selections that drive it. */
export class GitPanelModel implements HostObservable<GitPanelState> {
  private state: GitPanelState = INITIAL
  private readonly listeners = new Set<() => void>()
  private generation = 0

  /**
   * @param remote - the generated `git` namespace this model reads.
   * @param changeCount - the shared count the rail badge reads, which outlives this panel.
   */
  constructor(
    private readonly remote: GitRemote,
    private readonly changeCount: ChangeCountSource,
  ) {}

  /**
   * Read the state a render should draw.
   * @returns the same reference until the state moves.
   */
  getSnapshot(): GitPanelState {
    return this.state
  }

  /**
   * Observe state changes.
   * @param listener - called after every published state.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read one Workspace's repository; a repeat of the current selection is ignored.
   * @param workspaceId - Workspace whose repository the panel shows.
   */
  selectWorkspace(workspaceId: WorkspaceId): void {
    if (this.state.workspaceId === workspaceId) return
    this.generation += 1
    this.publish({ phase: 'loading', workspaceId, notARepository: false, commits: [], more: false })
    void this.load(this.generation)
  }

  /** Re-read the current selection, keeping the selected commit's oid. */
  refresh(): void {
    if (this.state.workspaceId === undefined) return
    this.generation += 1
    this.publish({ ...this.state, phase: 'loading' })
    void this.load(this.generation)
  }

  /**
   * Read one commit's detail.
   * @param oid - commit id the history page reported.
   */
  selectCommit(oid: string): void {
    if (this.state.selected === oid) return
    const generation = this.generation
    const { commit: _previous, ...rest } = this.state
    this.publish({ ...rest, selected: oid })
    void this.loadCommit(oid, generation)
  }

  /** Drop the selected commit and its detail, leaving the history in place. */
  clearCommit(): void {
    if (this.state.selected === undefined) return
    const { commit: _detail, selected: _selected, ...rest } = this.state
    this.publish(rest)
  }

  /** Stop publishing: the owning registration is gone. */
  dispose(): void {
    this.generation += 1
    this.listeners.clear()
  }

  private async load(generation: number): Promise<void> {
    const workspaceId = this.state.workspaceId
    if (workspaceId === undefined) return
    const located = await this.remote.repository(workspaceId)
    if (generation !== this.generation) return
    if (!located.ok) {
      this.publish({ ...INITIAL, workspaceId, phase: 'error', failure: located.error })
      return
    }
    if (located.value.kind === 'not-a-repository') {
      this.changeCount.publish(0)
      this.publish({ phase: 'ready', workspaceId, notARepository: true, commits: [], more: false })
      return
    }
    const [status, refs, log] = await Promise.all([
      this.remote.status(workspaceId),
      this.remote.refs(workspaceId),
      this.remote.log(workspaceId, { limit: LOG_PAGE }),
    ])
    if (generation !== this.generation) return
    if (!status.ok) {
      this.publishFailure(workspaceId, status.error)
      return
    }
    if (!refs.ok) {
      this.publishFailure(workspaceId, refs.error)
      return
    }
    if (!log.ok) {
      this.publishFailure(workspaceId, log.error)
      return
    }
    this.changeCount.publish(status.value.entries.length)
    this.publish({
      phase: 'ready',
      workspaceId,
      notARepository: false,
      repository: located.value.repository,
      status: status.value,
      refs: refs.value,
      commits: log.value.commits,
      more: log.value.more,
      ...this.state.selected === undefined ? {} : { selected: this.state.selected },
    })
    const selected = this.state.selected
    if (selected !== undefined && this.state.commit === undefined) {
      void this.loadCommit(selected, generation)
    }
  }

  private async loadCommit(oid: string, generation: number): Promise<void> {
    const workspaceId = this.state.workspaceId
    if (workspaceId === undefined) return
    const result = await this.remote.commit(workspaceId, oid)
    if (generation !== this.generation || this.state.selected !== oid) return
    if (!result.ok) {
      const { commit: _stale, ...rest } = this.state
      this.publish({ ...rest, phase: 'error', failure: result.error })
      return
    }
    this.publish({ ...this.state, commit: result.value })
  }

  /** Publish one failed read of the selected Workspace. */
  private publishFailure(workspaceId: WorkspaceId, failure: RemoteFailure): void {
    this.publish({ ...INITIAL, workspaceId, phase: 'error', failure })
  }

  /** Publish one state and notify every listener. */
  private publish(state: GitPanelState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}
