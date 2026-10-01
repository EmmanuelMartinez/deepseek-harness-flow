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
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { EditorPage } from './EditorPage.tsx'
import { EditorPanelIcon } from './EditorPanelIcon.tsx'
import { EditorModel } from './model.ts'
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

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'editor' as MainPanelId

/** Required services: the slots, dictionaries, frame, workspaces, and the `workspaceEditor` namespace. */
export const inject = ['slots', 'locale', 'layout', 'workspaces', 'remote', 'remote.workspaceEditor']

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

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 15,
    label: () => t('panel'),
    locale: NS,
  }, EditorPanelIcon))

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
