/**
 * The Editor panel's React-free state: which documents are open, what each
 * buffer holds, and whether it differs from the version on disk.
 *
 * The model owns one request generation per document, so a reload that loses a
 * race cannot publish over a newer buffer, and every write sends the version it
 * read, which is what makes a conflicting save refuse instead of overwrite.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientRemote, GitDiffHunk, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** The generated `workspaceEditor` namespace as the browser calls it. */
export type EditorRemote = ClientRemote['workspaceEditor']

/**
 * Resolves the Workspace that contains one absolute path.
 * @param absolutePath - absolute path in the Host's execution world.
 * @returns the containing Workspace and its root, or `undefined` when none contains the path.
 */
export type WorkspaceResolver = (absolutePath: string) => {
  readonly workspaceId: WorkspaceId
  readonly root: string
} | undefined

/** Which two states one comparison reports. */
export type EditorDiffSide = 'worktree' | 'index'

/** One document's comparison against its repository, or why there is none. */
export type EditorDiffState =
  | {
    /** The comparison, as the Host reported it. */
    readonly kind: 'ready'
    /** The index against the working tree, or HEAD against the index. */
    readonly side: EditorDiffSide
    /** Path relative to the repository root, as the comparison named it. */
    readonly path: string
    readonly hunks: readonly GitDiffHunk[]
    readonly binary: boolean
    readonly untracked: boolean
    readonly truncated: boolean
  }
  /** The repository holds no change for this file. */
  | { readonly kind: 'unchanged' }
  /** The file is outside a repository, or the composition mounts no git controller. */
  | { readonly kind: 'unavailable' }

/** One open document. */
export interface EditorDocument {
  /** Stable tab identity: the Workspace and path it was opened from. */
  readonly id: string
  readonly workspaceId: WorkspaceId
  /** Path relative to the Workspace root. */
  readonly path: string
  /** Display name: the final path segment. */
  readonly name: string
  /** Text on disk at the version this buffer was read from; the baseline for `dirty`. */
  readonly saved: string
  /** The buffer the user is editing. */
  readonly text: string
  /** Absolute path in the Host's execution world, as the read reported it. */
  readonly absolutePath?: string | undefined
  /** Version the buffer was read from; absent while the document is still loading. */
  readonly version?: string | undefined
  /** Bytes on disk at that version. */
  readonly bytes?: number | undefined
  /** The buffer differs from `saved`. */
  readonly dirty: boolean
  /** A save or reload is in flight. */
  readonly busy: boolean
  /** Whether the panel shows the buffer or the file's comparison. */
  readonly mode: 'edit' | 'diff'
  /** The comparison once it was asked for; absent until the first request settles. */
  readonly diff?: EditorDiffState | undefined
  /** The file changed under this buffer; its current version, when the Host reported one. */
  readonly conflict?: { readonly current?: string | undefined } | undefined
  readonly failure?: RemoteFailure | undefined
}

/** Everything the editor renders. */
export interface EditorState {
  readonly documents: readonly EditorDocument[]
  /** The active document's id; absent when none is open. */
  readonly active?: string
  /** The active buffer's selection offsets, from the last gesture in the textarea. */
  readonly selection?: { readonly start: number; readonly end: number }
  /** Whether a save follows a pause in typing. */
  readonly autosave: boolean
  /** Whether the composition mounts the git controller, so a comparison can be asked for. */
  readonly gitAvailable: boolean
}

/** Whether a save follows a pause in typing, and how long the pause is. */
export const AUTOSAVE_DELAY_MS = 1200

/**
 * The tab identity of one document.
 * @param workspaceId - Workspace the path belongs to.
 * @param path - Workspace-relative path.
 * @returns the identity used to find and replace the document.
 */
export function documentId(workspaceId: WorkspaceId, path: string): string {
  return `${workspaceId}\u0000${path}`
}

/** The display name of one path: its final segment. */
function nameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/** Editor state plus the operations a panel drives. */
export class EditorModel implements HostObservable<EditorState> {
  private state: EditorState
  private readonly listeners = new Set<() => void>()
  private readonly generations = new Map<string, number>()
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param remote - the generated `workspaceEditor` namespace this model reads and writes.
   * @param locate - resolves the Workspace a caller's absolute path falls in.
   * @param git - the `git` namespace a comparison is asked of, absent in compositions without it.
   */
  constructor(
    private readonly remote: EditorRemote,
    private readonly locate: WorkspaceResolver,
    private readonly git?: ClientRemote['git'],
  ) {
    this.state = { documents: [], autosave: false, gitAvailable: git !== undefined }
  }

  /**
   * Read the state a render should draw.
   * @returns the same reference until the state moves.
   */
  getSnapshot(): EditorState {
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
   * Open one document, revealing it when it is already open.
   * @param workspaceId - Workspace the path belongs to.
   * @param path - Workspace-relative path.
   */
  open(workspaceId: WorkspaceId, path: string): void {
    const id = documentId(workspaceId, path)
    if (this.state.documents.some(document => document.id === id)) {
      this.publish({ ...this.state, active: id })
      return
    }
    const document: EditorDocument = {
      id,
      workspaceId,
      path,
      name: nameOf(path),
      saved: '',
      text: '',
      dirty: false,
      busy: true,
      mode: 'edit',
    }
    this.publish({ ...this.state, documents: [...this.state.documents, document], active: id })
    void this.load(id)
  }

  /**
   * Open the document at one absolute path, when a Workspace contains it.
   * @param absolutePath - absolute path of a file in the Host's execution world.
   * @returns whether the document was opened; `false` leaves the caller to open it another way.
   */
  openAbsolute(absolutePath: string): boolean {
    const located = this.locate(absolutePath)
    if (located === undefined) return false
    const prefix = `${located.root.replace(/[/\\]+$/u, '')}/`
    if (!absolutePath.startsWith(prefix)) return false
    this.open(located.workspaceId, absolutePath.slice(prefix.length))
    return true
  }

  /**
   * Close one document, dropping any unsaved buffer with it.
   * @param id - tab identity returned by {@link documentId}.
   */
  close(id: string): void {
    const documents = this.state.documents.filter(document => document.id !== id)
    if (documents.length === this.state.documents.length) return
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    const active = this.state.active === id
      ? documents[documents.length - 1]?.id
      : this.state.active
    this.publish({
      ...this.state,
      documents,
      ...active === undefined ? {} : { active },
    })
  }

  /**
   * Show one open document.
   * @param id - tab identity to activate.
   */
  activate(id: string): void {
    if (this.state.active === id || !this.state.documents.some(document => document.id === id)) return
    this.publish({ ...this.state, active: id })
  }

  /**
   * Remember the active buffer's selection, so a shortcut can name its lines.
   * @param start - selection start offset in the buffer.
   * @param end - selection end offset in the buffer.
   */
  select(start: number, end: number): void {
    const selection = this.state.selection
    if (selection?.start === start && selection.end === end) return
    this.publish({ ...this.state, selection: { start, end } })
  }

  /**
   * Replace one buffer's text.
   * @param id - tab identity to edit.
   * @param text - the complete new buffer.
   */
  edit(id: string, text: string): void {
    const document = this.find(id)
    if (document === undefined) return
    this.patch(id, { text, dirty: text !== document.saved })
    if (this.state.autosave) this.armAutosave(id)
  }

  /**
   * Save one buffer at the version it was read from.
   * @param id - tab identity to save.
   */
  async save(id: string): Promise<void> {
    const document = this.find(id)
    if (document === undefined || document.busy || document.version === undefined || !document.dirty) return
    const generation = this.generations.get(id) ?? 0
    this.patch(id, { busy: true, failure: undefined })
    const text = document.text
    const result = await this.remote.write(
      document.workspaceId,
      document.path,
      text,
      { kind: 'replaceIfVersion', version: document.version },
    )
    if ((this.generations.get(id) ?? 0) !== generation || this.find(id) === undefined) return
    if (!result.ok) {
      const stale = result.error.code === 'workspace-editor/stale'
      const current = stale ? (result.error.details as { current?: string }).current : undefined
      this.patch(id, {
        busy: false,
        failure: result.error,
        conflict: stale ? (current === undefined ? {} : { current }) : undefined,
      })
      return
    }
    this.patch(id, {
      saved: text,
      dirty: false,
      busy: false,
      version: result.value.version,
      bytes: result.value.bytes,
      failure: undefined,
      conflict: undefined,
      // The file moved, so any comparison the panel held is stale.
      diff: undefined,
    })
  }

  /**
   * Read the document again, replacing the buffer and clearing any conflict.
   * @param id - tab identity to reload.
   */
  async reload(id: string): Promise<void> {
    if (this.find(id) === undefined) return
    this.patch(id, { busy: true, conflict: undefined, failure: undefined })
    await this.load(id, true)
  }

  /** Turn autosave on or off, saving any dirty buffer when it is turned off. */
  toggleAutosave(): void {
    const autosave = !this.state.autosave
    this.publish({ ...this.state, autosave })
    if (autosave) {
      const active = this.state.active
      if (active !== undefined) this.armAutosave(active)
      return
    }
    this.disarmAutosave()
    const dirty = this.state.documents.filter(document => document.dirty)
    for (const document of dirty) void this.save(document.id)
  }

  /**
   * Show one document's comparison, reading it on the first request.
   * @param id - tab identity to compare.
   */
  showDiff(id: string): void {
    const document = this.find(id)
    if (document === undefined) return
    this.patch(id, { mode: 'diff' })
    if (document.diff === undefined) void this.loadDiff(id)
  }

  /**
   * Show one document's buffer.
   * @param id - tab identity to edit.
   */
  showEdit(id: string): void {
    this.patch(id, { mode: 'edit' })
  }

  /** Read one document's comparison against its repository. */
  private async loadDiff(id: string): Promise<void> {
    const document = this.find(id)
    if (document === undefined) return
    const unavailable: EditorDiffState = { kind: 'unavailable' }
    const git = this.git
    const absolute = document.absolutePath
    if (git === undefined || absolute === undefined) {
      this.patch(id, { diff: unavailable })
      return
    }
    const located = await git.repository(document.workspaceId)
    if (this.find(id) === undefined) return
    if (!located.ok || located.value.kind !== 'repository') {
      this.patch(id, { diff: unavailable })
      return
    }
    const root = located.value.repository.root.replace(/[/\\]+$/u, '')
    if (!absolute.startsWith(`${root}/`)) {
      this.patch(id, { diff: unavailable })
      return
    }
    const path = absolute.slice(root.length + 1)
    const status = await git.status(document.workspaceId)
    if (this.find(id) === undefined) return
    if (!status.ok) {
      this.patch(id, { diff: unavailable })
      return
    }
    const entry = status.value.entries.find(candidate => candidate.path === path)
    if (entry === undefined) {
      this.patch(id, { diff: { kind: 'unchanged' } })
      return
    }
    // A file changed in the working tree shows that change; one whose change is
    // already staged shows the index against HEAD.
    const side: EditorDiffSide = entry.worktree !== 'unmodified' ? 'worktree' : 'index'
    const compared = await git.diff(document.workspaceId, {
      path,
      ...entry.from === undefined ? {} : { from: entry.from },
      side: { kind: side },
    })
    if (this.find(id) === undefined) return
    if (!compared.ok) {
      this.patch(id, { diff: unavailable })
      return
    }
    this.patch(id, {
      diff: {
        kind: 'ready',
        side,
        path,
        hunks: compared.value.hunks,
        binary: compared.value.binary,
        untracked: compared.value.untracked,
        truncated: compared.value.truncated,
      },
    })
  }

  /** Stop publishing and cancel any pending save: the owning registration is gone. */
  dispose(): void {
    this.disarmAutosave()
    for (const document of this.state.documents) {
      this.generations.set(document.id, (this.generations.get(document.id) ?? 0) + 1)
    }
    this.listeners.clear()
  }

  private find(id: string): EditorDocument | undefined {
    return this.state.documents.find(document => document.id === id)
  }

  private async load(id: string, replacing = false): Promise<void> {
    const document = this.find(id)
    if (document === undefined) return
    const generation = (this.generations.get(id) ?? 0) + (replacing ? 1 : 0)
    if (replacing) this.generations.set(id, generation)
    const result = await this.remote.read(document.workspaceId, document.path)
    if ((this.generations.get(id) ?? 0) !== generation || this.find(id) === undefined) return
    if (!result.ok) {
      this.patch(id, { busy: false, failure: result.error })
      return
    }
    this.patch(id, {
      saved: result.value.text,
      text: result.value.text,
      absolutePath: result.value.absolutePath,
      version: result.value.version,
      bytes: result.value.bytes,
      dirty: false,
      busy: false,
      failure: undefined,
      conflict: undefined,
      diff: undefined,
    })
  }

  private armAutosave(id: string): void {
    this.disarmAutosave()
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = undefined
      void this.save(id)
    }, AUTOSAVE_DELAY_MS)
  }

  private disarmAutosave(): void {
    if (this.autosaveTimer === undefined) return
    clearTimeout(this.autosaveTimer)
    this.autosaveTimer = undefined
  }

  /** Publish one document's change, keeping the others by identity. */
  private patch(id: string, change: Partial<EditorDocument>): void {
    const documents = this.state.documents.map((document) => {
      if (document.id !== id) return document
      return { ...document, ...change }
    })
    this.publish({ ...this.state, documents })
  }

  /** Publish one state and notify every listener. */
  private publish(state: EditorState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}
