/**
 * Wire types of the `workspaceEditor` Remote namespace. Types only: generated
 * Remote clients consume this module without Host runtime code.
 *
 * Paths here are relative to the Workspace root and `/`-separated, because the
 * editor edits files the user reached through a Workspace. A `version` is an
 * opaque freshness token: a buffer that was read at one version may only be
 * written back while the file still holds it.
 *
 * @module @deepseek-ai/dsh-api-workspace-editor/types
 */

// Import the protocol module so the declaration at the end of this file
// augments its error map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

// The Workspace identity is the only directory authority the editor names, so
// the domain's client-safe vocabulary carries it rather than making every
// consumer import the Workspace package.
export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** The Workspace one document belongs to, as a write request names it. */
export interface WorkspaceDocumentRef {
  readonly workspaceId: WorkspaceId
  /** Path relative to the Workspace root, `/`-separated. */
  readonly path: string
}

/** One document's identity, without its text. */
export interface WorkspaceDocumentStatView {
  /** Path relative to the Workspace root, `/`-separated. */
  readonly path: string
  /** Absolute path in the Host's execution world. */
  readonly absolutePath: string
  /** Opaque freshness token; never parsed by a client. */
  readonly version: string
  /** Complete file size in bytes. */
  readonly bytes: number
}

/** One document as the editor opened it. */
export interface WorkspaceDocumentView extends WorkspaceDocumentStatView {
  /**
   * Complete text, as the filesystem stores it (line feeds normalized). The
   * value a write must send back unchanged when the user saves without editing.
   */
  readonly text: string
}

/**
 * The state a write expects to find. A client sends back the version it read,
 * so an edit made against a buffer the Host has since moved past is refused
 * instead of overwriting the newer bytes.
 */
export type WorkspaceWriteExpectation =
  | {
    /** Replace the file only while it still holds this version. */
    readonly kind: 'replaceIfVersion'
    readonly version: string
  }
  | {
    /** Create the file, refusing when something already exists at the path. */
    readonly kind: 'createIfAbsent'
  }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No entry exists at that path inside the Workspace. */
    'workspace-editor/not-found': { readonly path: string }
    /** The path is not a regular file, so it has no text to edit. */
    'workspace-editor/not-regular-file': {
      readonly path: string
      readonly kind: 'directory' | 'symlink' | 'other'
    }
    /** The path resolves outside the Workspace root. */
    'workspace-editor/outside-workspace': { readonly path: string }
    /** The document exceeds the configured byte cap; it is neither read nor written. */
    'workspace-editor/too-large': { readonly path: string; readonly limit: number }
    /** The content is not decodable UTF-8 text, or carries NUL bytes. */
    'workspace-editor/not-text': { readonly path: string }
    /** The file changed since the version the caller read. */
    'workspace-editor/stale': { readonly path: string; readonly current?: string }
    /** A create-only write found something at the path already. */
    'workspace-editor/not-observed': { readonly path: string }
    /** The filesystem refused the write for a reason this service does not classify further. */
    'workspace-editor/write-failed': { readonly path: string; readonly code: string }
  }
}
