/**
 * The Editor page's injected face, and the navigation another plugin reaches to
 * open a document without importing this package's values.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditorState } from './model.ts'

/** The name this plugin provides its navigation under. */
export const EDITOR_NAVIGATION = 'editorNavigation'

/** What another plugin calls to show a document in the Editor panel. */
export interface EditorNavigation {
  /**
   * Show the document at one absolute path, selecting the Editor panel.
   * @param absolutePath - absolute path of a file, as the Host's filesystem reports it.
   * @returns whether the Editor took the document; `false` means no Workspace contains
   * that path, leaving the caller to open it another way.
   */
  open(absolutePath: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-plugin navigation that shows a document in the Editor panel. */
    editorNavigation: EditorNavigation
  }
}

/** Injected business face of the Editor page. */
export interface EditorInjected {
  readonly hooks: {
    /** Every open document and the active one. */
    readonly editor: HostObservable<EditorState>
  }
  /**
   * Show one open document.
   * @param id - tab identity.
   */
  readonly activate: (id: string) => void
  /**
   * Close one document.
   * @param id - tab identity.
   */
  readonly close: (id: string) => void
  /**
   * Replace one buffer.
   * @param id - tab identity.
   * @param text - the complete new buffer.
   */
  readonly edit: (id: string, text: string) => void
  /**
   * Write one buffer to disk.
   * @param id - tab identity.
   */
  readonly save: (id: string) => Promise<void>
  /**
   * Read one document again.
   * @param id - tab identity.
   */
  readonly reload: (id: string) => Promise<void>
  /** Turn autosave on or off. */
  readonly toggleAutosave: () => void
  /**
   * Show one document's comparison against its repository.
   * @param id - tab identity.
   */
  readonly showDiff: (id: string) => void
  /**
   * Show one document's buffer.
   * @param id - tab identity.
   */
  readonly showEdit: (id: string) => void
  /**
   * Report the active buffer's selection, so a shortcut can name its lines.
   * @param start - selection start offset in the buffer.
   * @param end - selection end offset in the buffer.
   */
  readonly select: (start: number, end: number) => void
}
