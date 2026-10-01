/**
 * Live repository state: the git panel reads on demand, so something must tell
 * it that the repository moved. This follows one Workspace's watch stream and
 * reports coalesced changes, so a commit — which writes many files at once —
 * costs one re-read instead of one per event.
 */
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'

/** One Workspace's repository watch: the frames its stream yields. */
export type GitWatch = (workspaceId: WorkspaceId, signal: AbortSignal) => AsyncIterable<unknown>

/** What a caller drives: which Workspace to follow, and when to stop. */
export interface GitLive {
  /**
   * Follow one Workspace's repository, replacing whatever was followed before.
   * @param workspaceId - the Workspace to watch, or undefined to only stop.
   */
  follow(workspaceId: WorkspaceId | undefined): void
  /** Stop following and cancel the watch: the owning registration is gone. */
  dispose(): void
}

/** Options of {@link createGitLive}. */
export interface GitLiveOptions {
  readonly watch: GitWatch
  /** Called once per burst of repository changes. */
  readonly onChange: () => void
  /** Quiet period after the last event, in milliseconds. */
  readonly debounceMs?: number
}

/** Default quiet period: long enough to swallow one commit's file writes. */
const DEBOUNCE_MS = 250

/**
 * Create the follow loop.
 * @param options - the watch to follow and the callback a change settles into.
 * @returns the handle the owning plugin drives.
 */
export function createGitLive({ watch, onChange, debounceMs = DEBOUNCE_MS }: GitLiveOptions): GitLive {
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  const stop = (): void => {
    controller?.abort()
    controller = undefined
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  return {
    follow(workspaceId) {
      stop()
      const current = ++generation
      if (workspaceId === undefined) return
      const own = new AbortController()
      controller = own
      void (async () => {
        try {
          for await (const frame of watch(workspaceId, own.signal)) {
            void frame
            if (current !== generation || own.signal.aborted) return
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(() => { timer = undefined; onChange() }, debounceMs)
          }
        } catch (error: unknown) {
          // A watch that fails, ends, or is cancelled leaves the last read in
          // place: the next follow opens a fresh stream.
          void error
        }
      })()
    },
    dispose() {
      generation += 1
      stop()
    },
  }
}
