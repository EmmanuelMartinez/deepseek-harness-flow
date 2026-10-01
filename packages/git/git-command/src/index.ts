/**
 * One git command through the subprocess seam.
 *
 * Two capabilities run git here — the turn change recorder and the browser's
 * repository panel — and both must run it the same way: never shell-interpreted,
 * never waiting on a credential prompt, never reading the user's ambient git
 * configuration, never taking an optional lock under the user, and always under
 * a caller-owned deadline with bounded output. This package is that one home.
 * It also parses the one porcelain form both callers read back: NUL-terminated
 * `--numstat` records.
 *
 * A nonzero exit is data the caller classifies, so nothing here raises one; a
 * command that times out, is aborted, or cannot spawn is an exception, and the
 * caller owns the cause because the process outcome carries none.
 *
 * @module @deepseek-ai/dsh-git-command
 */

import { homedir } from 'node:os'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'

/** Milliseconds a terminated git range has to exit before it is killed. */
const TERMINATE_GRACE_MS = 2_000

/** Bytes of one command's stderr kept as its diagnostic tail. */
const STDERR_TAIL_BYTES = 16 * 1024

/**
 * Git's non-interactive environment, layered under every command's own entries.
 *
 * `GIT_CONFIG_COUNT=0` makes ambient indexed configuration inert: the subprocess
 * credential scrub already removes `GIT_CONFIG_KEY_n` (its name matches `KEY`),
 * and this makes any survivor meaningless. `GIT_TERMINAL_PROMPT=0` keeps a child
 * from waiting on a prompt nobody can answer. `GIT_OPTIONAL_LOCKS=0` stops git
 * refreshing an index under the user. `LC_ALL=C` is the stable wording that
 * callers classify "not a repository" by.
 */
const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_CONFIG_COUNT: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
}

/** One settled git command, whether or not it succeeded. */
export interface GitRunResult {
  /** Process exit code; `null` when a signal killed the child. */
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** Whether the output cap dropped the head of stdout. */
  readonly truncated: boolean
}

/** Everything one command needs beyond its arguments. */
export interface GitRunOptions {
  /** Directory the command runs in; git resolves the repository from it. */
  readonly cwd: string
  /** Caller cancellation, combined with the command's own deadline. */
  readonly signal: AbortSignal
  /** Overrides the configured stdout cap for this command. */
  readonly maxBytes?: number | undefined
  /** Extra environment entries layered over {@link GIT_ENV}. */
  readonly env?: Readonly<Record<string, string>> | undefined
  /** Text delivered on the child's stdin, for the commands that read a list of paths. */
  readonly stdin?: string | undefined
}

/** Bounds every git command runs under. */
export interface GitLimits {
  /** Milliseconds one command may run before its deadline aborts it. */
  readonly timeoutMs: number
  /** Bytes of one command's stdout retained; a larger stream is reported cut. */
  readonly outputMaxBytes: number
}

/** Runs one resolved git executable with a deadline and bounded output. */
export class GitRunner {
  /**
   * @param subprocess - the process seam every command spawns through.
   * @param executable - resolved absolute git executable.
   * @param limits - deadline and output cap for one command.
   */
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly executable: string,
    private readonly limits: GitLimits,
  ) {}

  /**
   * Run one git subcommand to settlement.
   * @param args - arguments after the executable; never shell-interpreted.
   * @param options - directory, cancellation, and per-command overrides.
   * @returns the exit facts and the retained stdout and stderr.
   * @throws Error when the deadline or the caller's signal ended the command, or when the spawn itself failed.
   */
  async run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
    const timeout = AbortSignal.timeout(this.limits.timeoutMs)
    const signal = AbortSignal.any([options.signal, timeout])
    const handle = this.subprocess.spawn({
      argv: [this.executable, ...args],
      cwd: options.cwd,
      stdio: {
        stdin: options.stdin === undefined ? 'ignore' : { data: options.stdin },
        stdout: { maxBytes: options.maxBytes ?? this.limits.outputMaxBytes },
        stderr: { maxBytes: STDERR_TAIL_BYTES },
      },
      graceMs: TERMINATE_GRACE_MS,
      signal,
      env: { ...GIT_ENV, ...options.env },
    })
    const outcome = await handle.done
    if (signal.aborted) {
      const cause = timeout.aborted ? `timed out after ${this.limits.timeoutMs}ms` : 'was aborted'
      throw new Error(`git ${args.join(' ')} ${cause}`)
    }
    /* v8 ignore start -- collect-mode stdio always yields both readers. */
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    /* v8 ignore stop */
    return { exitCode: outcome.exitCode, stdout: stdout.text, stderr, truncated: stdout.lossy }
  }
}

/** Why no git executable is usable on this host. */
export type GitUnavailableReason = 'missing' | 'developer-tools'

/** What executable resolution settled on. */
export type GitResolution =
  | { readonly executable: string }
  | { readonly reason: GitUnavailableReason }

/**
 * Resolve the git executable this host can run.
 *
 * On macOS the `/usr/bin/git` developer-tools stub opens an installer dialog
 * instead of running, so it counts as absent until the tools are selected.
 * @param subprocess - the process seam used to resolve and probe.
 * @param signal - the caller's lifetime; cancels the lookup and the probe.
 * @returns the executable path, or the reason none is usable.
 * @throws Error when the lookup fails for a reason other than a missing executable.
 */
export async function resolveGitExecutable(
  subprocess: SubprocessRuntime,
  signal: AbortSignal,
): Promise<GitResolution> {
  const executable = await subprocess.resolveExecutable('git', undefined, signal).catch((error: unknown) => {
    if (error instanceof SubprocessExecutableNotFoundError) return undefined
    throw error
  })
  if (executable === undefined) return { reason: 'missing' }
  if (process.platform !== 'darwin' || executable !== '/usr/bin/git') return { executable }
  const probe = subprocess.spawn({
    argv: ['/usr/bin/xcode-select', '-p'],
    cwd: homedir(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
    graceMs: 1_000,
    signal,
  })
  const outcome = await probe.done.catch(() => ({ exitCode: null }))
  return outcome.exitCode === 0 ? { executable } : { reason: 'developer-tools' }
}

export { parseNumstat, type NumstatEntry } from './porcelain.ts'
