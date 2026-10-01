/**
 * The changed-file count the rail badge shows.
 *
 * The git panel owns the read that produces the number, and the badge lives in
 * frame chrome that outlives that panel, so the count is published into one
 * source both sides share: the panel writes after every status it settles, and
 * the badge keeps reading it while the panel is closed.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One shared changed-file count, with the writer the git panel holds. */
export interface ChangeCountSource extends HostObservable<number> {
  /**
   * Publish the count of one settled status read.
   * @param count - paths changed in the working tree or the index.
   */
  publish(count: number): void
}

/**
 * Create the source the panel writes and the badge reads.
 * @returns the observable readers subscribe to, with the panel's writer.
 */
export function createChangeCountSource(): ChangeCountSource {
  let count = 0
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => count,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (next) => {
      if (next === count) return
      count = next
      for (const listener of [...listeners]) listener()
    },
  }
}
