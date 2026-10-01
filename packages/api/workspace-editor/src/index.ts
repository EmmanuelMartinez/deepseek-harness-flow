/**
 * Workspace document editor: read, stat, and write one Workspace file as
 * `workspaceEditor`, so a browser surface can let a person review and edit a
 * file themselves instead of handing it to another application.
 *
 * The Workspace registration is the only directory authority: a request names a
 * `WorkspaceId` and a path relative to it, and this service refuses any path
 * that resolves outside that root. Writes are version-checked: a caller sends
 * back the version it read, so a buffer the Host has moved past is refused
 * instead of overwriting newer bytes.
 *
 * A write here is a person acting on their own machine, not an Agent tool call,
 * which is what `writeMode` expresses: it selects the sandbox policy the write
 * is performed under, and it defaults to the user's own authority because this
 * controller already confines the target to the Workspace it named. Deployments
 * that want browser edits confined further set `read-only`, which refuses every
 * write while leaving reads intact.
 *
 * @module @deepseek-ai/dsh-api-workspace-editor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorkspaceDocumentStatView,
  WorkspaceDocumentView,
  WorkspaceWriteExpectation,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceEditor` Remote namespace. */
    workspaceEditor: WorkspaceEditor
  }
}

/** Modes a browser write may run under. */
const WRITE_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

/** The byte text never carries: its presence marks a document as binary. */
const NUL = String.fromCharCode(0)

/** Deployment bounds on one document. */
export interface Config {
  /** Inclusive byte cap on one document, for both a read and a write. */
  readonly maxFileBytes: number
  /**
   * Sandbox policy the user's own edits run under. `read-only` refuses every
   * write; the default performs them under the user's authority, confined to
   * the Workspace by this controller.
   */
  readonly writeMode: SandboxMode
}

/**
 * Validate one Workspace-relative path from the wire.
 * @param path - the path to validate.
 * @returns the same path.
 * @throws RemoteError with `workspace-editor/outside-workspace` when it is absolute or steps out.
 */
function requireRelativePath(path: string): string {
  const rejected = path === ''
    || path.includes(NUL)
    || path.startsWith('/')
    || path.startsWith('\\')
    || /^[a-z]:/iu.test(path)
    || path.split('/').includes('..')
  if (rejected) {
    throw new RemoteError('workspace-editor/outside-workspace', `"${path}" is not a workspace-relative path`, { path })
  }
  return path
}

/** Host Remote owner of the `workspaceEditor` namespace. */
export class WorkspaceEditor extends TypertRemoteService {
  static inject = ['fs', 'sandboxPolicy', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    maxFileBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER - 1).default(4 * 1024 * 1024),
    writeMode: z.union([...WRITE_MODES]).default('danger-full-access'),
  })

  /**
   * @param ctx - Host context carrying the filesystem, the sandbox policy, and the Workspace registry.
   * @param config - the document cap and the write policy.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceEditor', { namespace: 'workspaceEditor' })
    if (!Number.isSafeInteger(config.maxFileBytes) || config.maxFileBytes < 1) {
      throw new Error('workspace-editor requires a positive integer maxFileBytes')
    }
    if (!WRITE_MODES.includes(config.writeMode)) {
      throw new Error(`workspace-editor requires writeMode to be one of ${WRITE_MODES.join(', ')}`)
    }
  }

  /**
   * Read one document's complete text and the version a write must send back.
   * @param workspaceId - registered Workspace the path is relative to.
   * @param path - Workspace-relative path of the file to read.
   * @param signal - caller cancellation.
   * @returns the document's text, version, and size.
   * @throws RemoteError when the path is outside the Workspace, is not a regular file, is not text, or exceeds the cap.
   */
  @Remote
  async read(workspaceId: WorkspaceId, path: string, signal: AbortSignal): Promise<WorkspaceDocumentView> {
    const { target, info } = await this.locate(workspaceId, path, signal)
    if (info.size !== undefined && info.size > this.config.maxFileBytes) {
      throw this.tooLarge(path)
    }
    let text: string
    try {
      text = await this.ctx.fs.readText(target, signal)
    } catch (error: unknown) {
      throw this.classify(path, error)
    }
    if (text.includes(NUL)) {
      throw new RemoteError('workspace-editor/not-text', `"${path}" contains NUL bytes`, { path })
    }
    if (Buffer.byteLength(text, 'utf8') > this.config.maxFileBytes) {
      throw this.tooLarge(path)
    }
    return { ...this.statOf(target, info), path: this.relative(path), text }
  }

  /**
   * Report one document's identity and current version without its text.
   * @param workspaceId - registered Workspace the path is relative to.
   * @param path - Workspace-relative path of the file to stat.
   * @param signal - caller cancellation.
   * @returns the document's version and size.
   * @throws RemoteError when the path is outside the Workspace or is not a regular file.
   */
  @Remote
  async stat(workspaceId: WorkspaceId, path: string, signal: AbortSignal): Promise<WorkspaceDocumentStatView> {
    const { target, info } = await this.locate(workspaceId, path, signal)
    return { ...this.statOf(target, info), path: this.relative(path) }
  }

  /**
   * Write one document's complete text under the caller's expectation.
   * @param workspaceId - registered Workspace the path is relative to.
   * @param path - Workspace-relative path of the file to write.
   * @param text - the complete new text.
   * @param expected - the state the caller read, or a create-only request.
   * @param signal - caller cancellation.
   * @returns the document's new version and size.
   * @throws RemoteError when the path is outside the Workspace, the content exceeds the cap,
   * the expectation no longer holds, or the write policy refuses it.
   */
  @Remote
  async write(
    workspaceId: WorkspaceId,
    path: string,
    text: string,
    expected: WorkspaceWriteExpectation,
    signal: AbortSignal,
  ): Promise<WorkspaceDocumentStatView> {
    const { target } = await this.prepare(workspaceId, path, signal)
    if (Buffer.byteLength(text, 'utf8') > this.config.maxFileBytes) {
      throw this.tooLarge(path)
    }
    const intent = expected.kind === 'createIfAbsent'
      ? { kind: 'createIfAbsent' as const }
      : { kind: 'replaceIfVersion' as const, version: FsVersion(expected.version) }
    const policy = this.ctx.sandboxPolicy.resolve({ mode: this.config.writeMode })
    try {
      const outcome = await this.ctx.fs.writeText(target, text, intent, signal, policy)
      return {
        path: this.relative(path),
        absolutePath: this.ctx.fs.processPath(target),
        version: outcome.version,
        bytes: Buffer.byteLength(outcome.after, 'utf8'),
      }
    } catch (error: unknown) {
      throw await this.classifyWrite(path, target, error, signal)
    }
  }

  /** The Workspace's canonical directory; the registration is the only path authority. */
  private workspaceRoot(workspaceId: WorkspaceId): string {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw new RemoteError('workspace/not-found', `no workspace "${workspaceId}"`, { workspaceId })
    }
    return workspace.path
  }

  /** Resolve one path and refuse it unless the Workspace contains it. */
  private async prepare(workspaceId: WorkspaceId, path: string, signal: AbortSignal): Promise<{ target: FsTarget }> {
    const root = this.workspaceRoot(workspaceId)
    const workspace = await this.ctx.fs.resolve(root, { signal })
    const target = await this.ctx.fs.resolve(requireRelativePath(path), { cwd: root, signal })
    if (!this.ctx.fs.contains(workspace, target)) {
      throw new RemoteError('workspace-editor/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    return { target }
  }

  /** Resolve one existing regular file, with the stat that names its version and size. */
  private async locate(
    workspaceId: WorkspaceId,
    path: string,
    signal: AbortSignal,
  ): Promise<{ target: FsTarget; info: FsInfo }> {
    const { target } = await this.prepare(workspaceId, path, signal)
    const entry = await this.ctx.fs.lstat(path, { cwd: this.workspaceRoot(workspaceId) }, signal)
    if (entry === undefined) {
      throw new RemoteError('workspace-editor/not-found', `no entry at "${path}"`, { path })
    }
    if (entry.type !== 'file') {
      throw new RemoteError('workspace-editor/not-regular-file', `"${path}" is a ${entry.type}`, { path, kind: entry.type })
    }
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) {
      throw new RemoteError('workspace-editor/not-found', `no entry at "${path}"`, { path })
    }
    if (info.type !== 'file') {
      throw new RemoteError('workspace-editor/not-regular-file', `"${path}" is a ${info.type}`, { path, kind: info.type })
    }
    return { target, info }
  }

  private statOf(target: FsTarget, info: FsInfo): Omit<WorkspaceDocumentStatView, 'path'> {
    return {
      absolutePath: this.ctx.fs.processPath(target),
      version: info.version,
      bytes: info.size ?? 0,
    }
  }

  /** The wire path: the caller's own spelling, normalized to `/`. */
  private relative(path: string): string {
    return path.replace(/\\/g, '/')
  }

  private tooLarge(path: string): RemoteError {
    return new RemoteError(
      'workspace-editor/too-large',
      `"${path}" exceeds the ${this.config.maxFileBytes} byte document cap`,
      { path, limit: this.config.maxFileBytes },
    )
  }

  /** Map a read failure onto the wire vocabulary. */
  private classify(path: string, error: unknown): unknown {
    const code = errorCodeOf(error)
    if (code === 'FS_NOT_TEXT') {
      return new RemoteError('workspace-editor/not-text', `"${path}" is not UTF-8 text`, { path }, { cause: error })
    }
    return error
  }

  /**
   * Map a write failure onto the wire vocabulary, reporting the version the file
   * holds now when the caller's expectation was what failed.
   */
  private async classifyWrite(
    path: string,
    target: FsTarget,
    error: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const code = errorCodeOf(error)
    if (code === 'FS_STALE_VERSION') {
      const current = await this.ctx.fs.stat(target, signal).catch(() => undefined)
      return new RemoteError(
        'workspace-editor/stale',
        `"${path}" changed since it was read`,
        { path, ...current === undefined ? {} : { current: current.version } },
        { cause: error },
      )
    }
    if (code === 'FS_NOT_OBSERVED') {
      return new RemoteError('workspace-editor/not-observed', `"${path}" already exists`, { path }, { cause: error })
    }
    if (code === 'FS_TOO_LARGE') return this.tooLarge(path)
    if (code === 'FS_NOT_TEXT') {
      return new RemoteError('workspace-editor/not-text', `"${path}" is not UTF-8 text`, { path }, { cause: error })
    }
    if (error instanceof FsError) {
      return new RemoteError(
        'workspace-editor/write-failed',
        `cannot write "${path}": ${error.message}`,
        { path, code: error.code },
        { cause: error },
      )
    }
    return error
  }
}

/**
 * The filesystem error code an error carries, read structurally: the error class
 * belongs to whichever `dsh-fs` instance the provider loaded, so no class
 * identity is shared across the package boundary.
 */
function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

export default WorkspaceEditor
