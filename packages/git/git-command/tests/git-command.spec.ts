/**
 * The shared git runner: the environment and bounds every command gets, the two
 * causes it raises rather than reporting as data, and the executable resolution
 * both consumers call.
 */
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, resolveGitExecutable } from '../src/index.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const signal = (): AbortSignal => new AbortController().signal

/** One command the seam received. */
interface Spawned {
  readonly spec: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly stdio: Record<string, unknown>
    readonly graceMs: number
    readonly env: NodeJS.ProcessEnv
  }
}

/** A subprocess stand-in that records each spec and answers with scripted output. */
function seam(
  outcome: { readonly exitCode: number | null },
  collected: { readonly stdout?: { readonly text: string; readonly lossy: boolean }; readonly stderr?: string } = {},
  done?: Promise<{ readonly exitCode: number | null }>,
): { readonly subprocess: unknown; readonly spawned: Spawned[] } {
  const spawned: Spawned[] = []
  return {
    spawned,
    subprocess: {
      spawn: (spec: Spawned['spec']) => {
        spawned.push({ spec })
        return {
          done: done ?? Promise.resolve(outcome),
          collected: {
            stdout: { readFrom: () => collected.stdout ?? { text: '', lossy: false } },
            stderr: { readFrom: () => ({ text: collected.stderr ?? '' }) },
          },
        }
      },
    },
  }
}

const LIMITS = { timeoutMs: 1_000, outputMaxBytes: 2048 }

describe('GitRunner', () => {
  it('gives every command the non-interactive environment, the configured caps, and the caller entries', async () => {
    const { subprocess, spawned } = seam({ exitCode: 0 })
    const runner = new GitRunner(subprocess as never, '/usr/bin/git', LIMITS)
    const result = await runner.run(['status', '--porcelain=v2'], {
      cwd: '/repo',
      signal: signal(),
      env: { GIT_INDEX_FILE: '/scratch/index' },
      stdin: 'a.txt\0',
      maxBytes: 512,
    })
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '', truncated: false })
    const spec = spawned[0]?.spec
    expect(spec?.argv).toEqual(['/usr/bin/git', 'status', '--porcelain=v2'])
    expect(spec?.cwd).toBe('/repo')
    expect(spec?.graceMs).toBe(2_000)
    expect(spec?.env).toMatchObject({
      GIT_CONFIG_COUNT: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      GIT_INDEX_FILE: '/scratch/index',
    })
    expect(spec?.stdio).toEqual({
      stdin: { data: 'a.txt\0' },
      stdout: { maxBytes: 512 },
      stderr: { maxBytes: 16 * 1024 },
    })
  })

  it('reports a stdout cut, a diagnostic stderr tail, and a nonzero exit as data', async () => {
    const { subprocess } = seam(
      { exitCode: 1 },
      { stdout: { text: 'kept tail', lossy: true }, stderr: 'fatal: nope' },
    )
    const runner = new GitRunner(subprocess as never, 'git', LIMITS)
    expect(await runner.run(['log'], { cwd: '/repo', signal: signal() })).toEqual({
      exitCode: 1,
      stdout: 'kept tail',
      stderr: 'fatal: nope',
      truncated: true,
    })
  })

  it('raises its own deadline as the cause', async () => {
    const { subprocess } = seam({ exitCode: 0 }, {}, new Promise((resolve) => {
      setTimeout(() => { resolve({ exitCode: 0 }) }, 60)
    }))
    const runner = new GitRunner(subprocess as never, 'git', { timeoutMs: 5, outputMaxBytes: 1024 })
    await expect(runner.run(['log'], { cwd: '/repo', signal: signal() }))
      .rejects.toThrow('git log timed out after 5ms')
  })

  it('raises caller cancellation as the cause', async () => {
    const { subprocess } = seam({ exitCode: 0 })
    const runner = new GitRunner(subprocess as never, 'git', LIMITS)
    const controller = new AbortController()
    controller.abort()
    await expect(runner.run(['log'], { cwd: '/repo', signal: controller.signal }))
      .rejects.toThrow('git log was aborted')
  })
})

describe('resolveGitExecutable', () => {
  it('reports a missing executable as its own reason', async () => {
    const subprocess = {
      resolveExecutable: async () => { throw new SubprocessExecutableNotFoundError('git not found') },
    }
    expect(await resolveGitExecutable(subprocess as never, signal())).toEqual({ reason: 'missing' })
  })

  it('lets any other lookup failure through', async () => {
    const failure = new Error('provider unavailable')
    const subprocess = { resolveExecutable: async () => { throw failure } }
    await expect(resolveGitExecutable(subprocess as never, signal())).rejects.toBe(failure)
  })

  it('takes a resolved executable that is not the macOS developer-tools stub', async () => {
    const subprocess = { resolveExecutable: async () => '/opt/homebrew/bin/git' }
    expect(await resolveGitExecutable(subprocess as never, signal())).toEqual({ executable: '/opt/homebrew/bin/git' })
  })

  it('counts the macOS stub as absent, and as present once the tools are selected', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    cleanups.push(() => { Object.defineProperty(process, 'platform', { value: platform, configurable: true }) })
    const stub = { resolveExecutable: async () => '/usr/bin/git' }
    const refused = { ...stub, spawn: () => ({ done: Promise.resolve({ exitCode: 1 }), collected: {} }) }
    expect(await resolveGitExecutable(refused as never, signal())).toEqual({ reason: 'developer-tools' })
    const unavailable = { ...stub, spawn: () => ({ done: Promise.reject(new Error('no provider')), collected: {} }) }
    expect(await resolveGitExecutable(unavailable as never, signal())).toEqual({ reason: 'developer-tools' })
    const selected = { ...stub, spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: {} }) }
    expect(await resolveGitExecutable(selected as never, signal())).toEqual({ executable: '/usr/bin/git' })
  })
})
