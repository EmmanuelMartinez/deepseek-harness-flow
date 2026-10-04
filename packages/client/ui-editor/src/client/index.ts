/**
 * Editor panel: the global document surface where a person reads and edits
 * files themselves, opened from the Source control panel, the file tree, or a
 * conversation link.
 *
 * The panel is a `main` entry, so it never depends on a Session being on screen,
 * and it publishes `editorNavigation` for the plugins that hand it a document.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { EditorPage } from './EditorPage.tsx'
import { EditorPanelIcon } from './EditorPanelIcon.tsx'
import { EditorModel } from './model.ts'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type EditorLocaleKey } from './locales.ts'
import { EDITOR_NAVIGATION, type EditorNavigation, type EditorInjected } from './slots.ts'

export type { EditorNavigation } from './slots.ts'
export { EDITOR_NAVIGATION } from './slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Editor panel copy. */
    editor: EditorLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'editor'

/**
 * The `@` mention for one path, quoted when it holds a space.
 * @param path - the document's path, as the Host reported it.
 * @returns the mention text a reference carries.
 */
function mentionOf(path: string): string {
  return path.includes(' ') ? `@"${path}"` : `@${path}`
}

/**
 * The selected lines of one buffer, in the `#L` form the app already reads in
 * file links: `#L24` for one line, `#L24-L30` for a span.
 * @param text - the buffer the offsets index into.
 * @param selection - the selection offsets, absent when the buffer has none.
 * @returns the mention fragment and the display suffix; both empty without a selection.
 */
function lineRangeOf(
  text: string,
  selection: { readonly start: number; readonly end: number } | undefined,
): { readonly fragment: string; readonly label: string } {
  if (selection === undefined || selection.end <= selection.start) return { fragment: '', label: '' }
  const start = lineOf(text, selection.start)
  const end = lineOf(text, selection.end)
  if (end <= start) return { fragment: `#L${String(start)}`, label: `:${String(start)}` }
  return { fragment: `#L${String(start)}-L${String(end)}`, label: `:${String(start)}-${String(end)}` }
}

/**
 * One-based line number of a buffer offset.
 * @param text - the buffer the offset indexes into.
 * @param offset - zero-based offset.
 * @returns the one-based line the offset falls on.
 */
function lineOf(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'editor' as MainPanelId

/** Required services: the slots, dictionaries, frame, workspaces, shortcuts, sessions, and the `workspaceEditor` namespace. */
export const inject = [
  'slots', 'locale', 'layout', 'workspaces', 'remote', 'remote.workspaceEditor',
  'shortcuts', 'uiSession',
]

/**
 * Contribute the Editor entry to the sidebar and the page it selects.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-editor: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', function* () {
    // The comparison is optional: a composition without the git controller
    // keeps the buffer and simply offers no Diff. `remote.git` is a dotted
    // service key, so its type comes from the Remote face, not the Context.
    const git = ctx.get('remote.git') as ClientRemote['git'] | undefined
    // Nested Workspaces are possible, so the longest containing root wins and a
    // document opens against the most specific one.
    const locate = (absolutePath: string): { workspaceId: WorkspaceId; root: string } | undefined => {
      let best: { workspaceId: WorkspaceId; root: string } | undefined
      for (const item of ctx.workspaces.list.getSnapshot().items) {
        const root = item.path.replace(/[/\\]+$/u, '')
        if (!absolutePath.startsWith(`${root}/`)) continue
        if (best === undefined || root.length > best.root.length) best = { workspaceId: item.workspaceId, root }
      }
      return best
    }
    const model = new EditorModel(ctx.remote.workspaceEditor, locate, git)
    /**
     * The reference one gesture hands to the chat. The Editor owns the central
     * column, so its panel replaces the Conversation and unmounts the input:
     * the gesture records what it references and returns to the Conversation,
     * and the live subscription below delivers it as soon as that input exists.
     */
    let pending: ReferenceInsert | undefined
    /**
     * Hand the pending reference to the session input the moment that input is
     * reachable. The shell lives in the Session scope, so it usually answers
     * even while the Conversation panel is hidden.
     */
    const deliverPending = (): void => {
      if (pending === undefined) return
      const actions = ctx.uiSession.adapter.current.getSnapshot().props.inputActions as InputActions | undefined
      if (actions?.insertReferenceAtCaret === undefined) return
      const reference = pending
      pending = undefined
      actions.insertReferenceAtCaret(reference)
    }
    ctx.effect(() => ctx.uiSession.adapter.current.subscribe(deliverPending),
      'ui-editor: pending reference delivery')
    /**
     * What one reference insertion would name: the document the Editor shows.
     * @returns the reference to hand over, or undefined when nothing is open.
     */
    const referenceFor = (): ReferenceInsert | undefined => {
      const state = model.getSnapshot()
      const document = state.documents.find(item => item.id === state.active)
      if (document === undefined) return undefined
      const range = lineRangeOf(document.text, state.selection)
      const mention = `${mentionOf(document.path)}${range.fragment}`
      return {
        source: 'reference',
        ref: mention,
        label: `${document.name}${range.label}`,
        appearance: 'file',
        clipboardText: mention,
      }
    }
    // One gesture that hands the open file to the composer without typing an
    // `@` token: the editor owns the document, the session scope owns the caret.
    yield ctx.shortcuts.register({
      id: 'editor.insertReference' as ShortcutCommandId,
      label: () => t('shortcut.reference'),
      aliases: ['insert file reference', 'referenciar fichero'],
      defaults: {
        'web:macos': { code: 'KeyL', modifiers: ['primary', 'alt'] },
        'web:windows': { code: 'KeyL', modifiers: ['primary', 'alt'] },
        'desktop:macos': { code: 'KeyL', modifiers: ['primary'] },
        'desktop:windows': { code: 'KeyL', modifiers: ['primary'] },
        'desktop:linux': { code: 'KeyL', modifiers: ['primary'] },
      },
      regions: ['page', 'editable'],
      modals: [],
      resolve: () => {
        const reference = referenceFor()
        if (reference === undefined) return { status: 'blocked', reason: t('shortcut.referenceUnavailable') }
        return { status: 'handled', run: () => {
          pending = reference
          deliverPending()
          // Back to the Conversation, where the reader sees the reference land.
          ctx.layout.selectPanel(null)
        } }
      },
    })
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): EditorInjected => ({
        hooks: { editor: model },
        activate: (id) => { model.activate(id) },
        close: (id) => { model.close(id) },
        edit: (id, text) => { model.edit(id, text) },
        save: async (id) => { await model.save(id) },
        reload: async (id) => { await model.reload(id) },
        toggleAutosave: () => { model.toggleAutosave() },
        showDiff: (id) => { model.showDiff(id) },
        showEdit: (id) => { model.showEdit(id) },
        select: (start, end) => { model.select(start, end) },
      }),
    }, EditorPage)
    yield () => { model.dispose() }
    const navigation: EditorNavigation = {
      open: (absolutePath) => {
        const opened = model.openAbsolute(absolutePath)
        if (opened) ctx.layout.selectPanel(PANEL_ID)
        return opened
      },
    }
    const disposeNavigation = ctx.reflect.provide(EDITOR_NAVIGATION, navigation)
    yield () => { void disposeNavigation() }
  })

  // The frame's right rail offers the same tool: it owns the button and the
  // toggle, and this registration contributes only the glyph.
  ctx.slots.inject('rightrail', () => ctx.slots.register({
    name: 'rightrail',
    id: PANEL_ID,
    order: 15,
    label: () => t('panel'),
    locale: NS,
  }, EditorPanelIcon))
}
