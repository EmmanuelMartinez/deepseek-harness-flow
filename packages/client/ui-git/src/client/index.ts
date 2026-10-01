/**
 * Git surface, browser half: the sidebar's **Source control** entry and the page
 * it opens in the main column.
 *
 * The page reads one Workspace's repository through the generated `git` Remote
 * namespace. Its state model lives for exactly as long as the `main`
 * registration, so switching away from the panel keeps nothing alive.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-editor/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { GitPage } from './GitPage.tsx'
import { GitPanelIcon } from './GitPanelIcon.tsx'
import { GitRailIcon } from './GitRailIcon.tsx'
import { createChangeCountSource, type ChangeCountSource } from './change-count.ts'
import { createGitLive } from './live.ts'
import { GitPanelModel } from './model.ts'
import { en, zh, type GitLocaleKey } from './locales.ts'
import type { GitWatchFrame } from '@deepseek-ai/dsh-api-git-controller/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { GitPanelInjected } from './slots.ts'
import type { GitRailInjected } from './GitRailIcon.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Git panel copy. */
    git: GitLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'git'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'git' as MainPanelId

/** Required services: the slots, dictionaries, Workspace rows, right column, frame, and the `git` namespace. */
export const inject = ['slots', 'locale', 'workspaces', 'sidebarRight', 'layout', 'remote', 'remote.git']

/**
 * Contribute the Source control entry to the sidebar and the page it selects.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-git: dictionaries')
  const t = ctx.locale.bind(NS)
  // The right column belongs to the Session on screen, which is the Conversation's
  // Session: this panel is global, so remembering the last one is what lets a file
  // click reach the column the Conversation draws.
  let lastSession = ctx.sidebarRight.mounted.getSnapshot()
  ctx.effect(() => ctx.sidebarRight.mounted.subscribe(() => {
    const current = ctx.sidebarRight.mounted.getSnapshot()
    if (current !== undefined) lastSession = current
  }), 'ui-git: on-screen session')

  const changeCount: ChangeCountSource = createChangeCountSource()
  // The open panel while it exists: the live watch refreshes it, and the badge
  // falls back to its own read when the panel is closed.
  let activeModel: GitPanelModel | undefined
  const onlyWorkspace = (): WorkspaceId | undefined => {
    const items = ctx.workspaces.list.getSnapshot().items
    return items.length === 1 ? items[0]?.workspaceId : undefined
  }
  const refreshCount = (): void => {
    const workspaceId = activeModel?.getSnapshot().workspaceId ?? onlyWorkspace()
    if (workspaceId === undefined) return
    void ctx.remote.git.status(workspaceId).then((result) => {
      if (result.ok) changeCount.publish(result.value.entries.length)
    })
  }
  // One Workspace is the only case where the badge's number is unambiguous
  // before the panel has read anything: it seeds here, and the panel keeps it
  // current from every status it settles while it is open.
  ctx.effect(() => {
    const off = ctx.workspaces.list.subscribe(refreshCount)
    refreshCount()
    return off
  }, 'ui-git: change count')
  // Live state: `.git` moves on a commit, a checkout, or an index write, and
  // nothing else tells the panel that its read went stale.
  const live = createGitLive({
    watch: (workspaceId, signal) => ctx.remote.$stream<GitWatchFrame>({
      name: `repository ${workspaceId}`,
      open: () => ctx.remote.git.watch(workspaceId, signal),
      ended: () => new Error(`Repository watch ended: ${workspaceId}`),
    }),
    onChange: () => {
      const model = activeModel
      if (model === undefined) refreshCount()
      else model.refresh()
    },
  })
  ctx.effect(() => {
    const sync = (): void => { live.follow(activeModel?.getSnapshot().workspaceId ?? onlyWorkspace()) }
    const off = ctx.workspaces.list.subscribe(sync)
    sync()
    return () => { off(); live.dispose() }
  }, 'ui-git: live repository')

  ctx.slots.inject('main', function* () {
    const model = new GitPanelModel(ctx.remote.git, changeCount)
    activeModel = model
    live.follow(model.getSnapshot().workspaceId ?? onlyWorkspace())
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): GitPanelInjected => ({
        hooks: { gitPanel: model, gitWorkspaces: ctx.workspaces.list },
        selectWorkspace: (workspaceId) => {
          model.selectWorkspace(workspaceId)
          live.follow(workspaceId)
        },
        selectCommit: (oid) => { model.selectCommit(oid) },
        clearCommit: () => { model.clearCommit() },
        refresh: () => { model.refresh() },
        openFile: (path) => {
          const root = model.getSnapshot().repository?.root
          if (root === undefined) return
          const absolute = `${root.replace(/[/\\]+$/u, '')}/${path}`
          // The Editor takes any document a Workspace contains; one outside it —
          // a repository above the Workspace root — keeps the read-only preview.
          if (ctx.get('editorNavigation')?.open(absolute) === true) return
          const session = ctx.sidebarRight.mounted.getSnapshot() ?? lastSession
          if (session === undefined) return
          const address = fileAddressFor(session, undefined, absolute)
          ctx.layout.selectPanel(null)
          ctx.sidebarRight.openResourceIn(session, address)
        },
      }),
    }, GitPage)
    yield () => { activeModel = undefined; model.dispose() }
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    label: () => t('panel'),
    locale: NS,
  }, GitPanelIcon))

  // The frame's right rail offers the same tool: it owns the button and the
  // toggle, and this registration contributes the glyph with the changed-file
  // count the panel publishes.
  ctx.slots.inject('rightrail', () => ctx.slots.register({
    name: 'rightrail',
    id: PANEL_ID,
    order: 20,
    label: () => t('panel'),
    locale: NS,
    inject: (): GitRailInjected => ({ hooks: { changeCount } }),
  }, GitRailIcon))
}
