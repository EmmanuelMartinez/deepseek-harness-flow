/**
 * The follow loop: one Workspace watched at a time, bursts coalesced into one
 * callback, and a replaced or disposed watch that goes quiet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { createGitLive } from '../src/client/live.ts'

const FIRST = 'ws-one' as WorkspaceId
const SECOND = 'ws-two' as WorkspaceId

/** A watch whose frames the test pushes by hand. */
function scripted() {
  const pushes: ((value: unknown) => void)[] = []
  const signals: AbortSignal[] = []
  const watch = vi.fn((_workspaceId: WorkspaceId, signal: AbortSignal) => {
    signals.push(signal)
    return (async function* () {
      for (;;) {
        const value = await new Promise<unknown>((resolve) => { pushes.push(resolve) })
        yield value
      }
    })()
  })
  return {
    watch,
    signals,
    emit: async (value: unknown = { kind: 'change' }): Promise<void> => {
      // The follow loop opens its stream asynchronously: give it a turn before
      // claiming that nothing is listening.
      for (let attempt = 0; attempt < 20 && pushes.length === 0; attempt += 1) await Promise.resolve()
      const next = pushes.shift()
      if (next === undefined) throw new Error('no watch is open')
      next(value)
      // Let the loop consume the frame before the assertion reads the timer.
      await Promise.resolve()
    },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('createGitLive', () => {
  it('coalesces a burst into one callback', async () => {
    vi.useFakeTimers()
    const seam = scripted()
    const onChange = vi.fn()
    const live = createGitLive({ watch: seam.watch, onChange, debounceMs: 250 })
    live.follow(FIRST)
    expect(seam.watch).toHaveBeenCalledWith(FIRST, expect.anything())
    await seam.emit()
    await seam.emit()
    await seam.emit()
    expect(onChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(onChange).toHaveBeenCalledTimes(1)
    live.dispose()
  })

  it('stops the previous watch when it follows another Workspace', async () => {
    vi.useFakeTimers()
    const seam = scripted()
    const live = createGitLive({ watch: seam.watch, onChange: vi.fn() })
    live.follow(FIRST)
    const first = seam.signals[0]
    live.follow(SECOND)
    expect(first?.aborted).toBe(true)
    expect(seam.watch).toHaveBeenLastCalledWith(SECOND, expect.anything())
    live.dispose()
  })

  it('cancels a pending callback and the watch when disposed', async () => {
    vi.useFakeTimers()
    const seam = scripted()
    const onChange = vi.fn()
    const live = createGitLive({ watch: seam.watch, onChange })
    live.follow(FIRST)
    await seam.emit()
    live.dispose()
    expect(seam.signals[0]?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('follows nothing without a Workspace', () => {
    const seam = scripted()
    const live = createGitLive({ watch: seam.watch, onChange: vi.fn() })
    live.follow(undefined)
    expect(seam.watch).not.toHaveBeenCalled()
    live.dispose()
  })
})
