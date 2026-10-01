// @vitest-environment jsdom
/**
 * The Git surface's two registrations: one id shared by the sidebar entry and
 * the main page, the state the injected face drives over the `git` Remote
 * namespace, and both contributions leaving with the plugin.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import { GitPage } from '../src/client/GitPage.tsx'
import { GitPanelIcon } from '../src/client/GitPanelIcon.tsx'
import { GitRailIcon } from '../src/client/GitRailIcon.tsx'
import type { GitPanelInjected } from '../src/client/slots.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const WORKSPACE = 'ws-one' as WorkspaceId
/** The Session the right column draws while the Conversation is the main panel. */
const SESSION = 's-one'

/** One bench: the slot registry, the locale runtime, scripted git reads, and one Workspace row. */
async function bench(repository: object = { kind: 'not-a-repository' as const }) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const git = {
    repository: vi.fn(async () => ({ ok: true as const, value: repository })),
    status: vi.fn(async () => ({ ok: true as const, value: { entries: [], truncated: false } })),
    refs: vi.fn(async () => ({ ok: true as const, value: { refs: [], truncated: false } })),
    log: vi.fn(async () => ({ ok: true as const, value: { commits: [], more: false } })),
    commit: vi.fn(async () => ({ ok: true as const, value: undefined })),
    diff: vi.fn(),
  }
  const remote = new TestRemote(ctx, { git })
  const list = createSnapshotStore({
    items: [{ workspaceId: WORKSPACE, path: '/repo', title: 'repo', sessionIds: [], createdAt: '', updatedAt: '' }],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle' as const,
    phase: 'ready' as const,
    error: null,
  })
  ctx.provide('workspaces', { list } as never)
  // The right column: the panel opens a changed file through it, and the
  // preview's own Open control then hands the file to the host application.
  const openResourceIn = vi.fn()
  const selectPanel = vi.fn()
  ctx.provide('sidebarRight', {
    mounted: { getSnapshot: () => SESSION, subscribe: () => () => undefined },
    openResourceIn,
  } as never)
  ctx.provide('layout', { selectPanel } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, git, remote, list, openResourceIn, selectPanel }
}

/** Declare the shell slots this plugin contributes to. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'rightrail': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-git browser plugin', () => {
  it('registers the Source control entry and its page under one id, and drops both on unload', async () => {
    const b = await bench()
    b.git.status.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: 'a.ts' }, { path: 'b.ts' }], truncated: false } as never,
    })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The declarations are absent, so a contribution waits instead of applying.
    expect(b.slots.entries('main')).toHaveLength(0)
    const releaseRoot = declare(b.slots)
    const pages = b.slots.entries('main')
    expect(pages).toHaveLength(1)
    expect(pages[0]?.component).toBe(GitPage)
    expect(pages[0]?.options).toMatchObject({ key: PANEL_ID })
    expect(pages[0]?.locale).toBe(NS)
    const icons = b.slots.entries('sidebar.panellist')
    expect(icons).toHaveLength(1)
    expect(icons[0]?.component).toBe(GitPanelIcon)
    expect(icons[0]?.options).toMatchObject({ id: PANEL_ID, order: 20 })
    // The frame's right rail offers the same tool with the same glyph.
    const rail = b.slots.entries('rightrail')
    expect(rail).toHaveLength(1)
    expect(rail[0]?.component).toBe(GitRailIcon)
    expect(rail[0]?.options).toMatchObject({ id: PANEL_ID, order: 20 })
    // The badge reads the count the panel publishes; the seed reads it once for
    // the only Workspace, so the entry carries a number before the panel opens.
    const railFace = (rail[0]?.inject as (() => { hooks: { changeCount: { getSnapshot: () => number } } }) | undefined)?.()
    if (railFace === undefined) throw new Error('the rail entry carries no injected face')
    await vi.waitFor(() => { expect(railFace.hooks.changeCount.getSnapshot()).toBe(2) })
    releaseRoot()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(b.slots.entries('rightrail')).toHaveLength(0)
  })

  it('reads the selected workspace through the injected model and publishes its state', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entries('main')[0]?.inject as (() => GitPanelInjected) | undefined)?.()
    if (face === undefined) throw new Error('the main entry carries no injected face')
    face.selectWorkspace(WORKSPACE)
    await vi.waitFor(() => { expect(b.git.repository).toHaveBeenCalledWith(WORKSPACE) })
    expect(face.hooks.gitPanel.getSnapshot()).toMatchObject({
      workspaceId: WORKSPACE,
      phase: 'ready',
      notARepository: true,
    })
  })

  it('opens a changed file in the right column at the repository absolute path', async () => {
    const b = await bench({
      kind: 'repository',
      repository: { root: '/repo', name: 'repo', head: { kind: 'branch', branch: 'main', oid: 'a'.repeat(40) } },
    })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entries('main')[0]?.inject as (() => GitPanelInjected) | undefined)?.()
    if (face === undefined) throw new Error('the main entry carries no injected face')
    face.selectWorkspace(WORKSPACE)
    await vi.waitFor(() => { expect(face.hooks.gitPanel.getSnapshot().repository).toBeDefined() })
    face.openFile('dir/a.txt')
    expect(b.selectPanel).toHaveBeenCalledWith(null)
    const [session, address] = b.openResourceIn.mock.calls[0] as [string, string]
    expect(session).toBe(SESSION)
    expect(address).toContain('dsh-resource://')
    expect(decodeURIComponent(address)).toContain('/repo/dir/a.txt')
  })

  it('hands the changed file to the Editor when one is mounted', async () => {
    const b = await bench({
      kind: 'repository',
      repository: { root: '/repo', name: 'repo', head: { kind: 'branch', branch: 'main', oid: 'a'.repeat(40) } },
    })
    declare(b.slots)
    const open = vi.fn(() => true)
    b.ctx.provide('editorNavigation', { open } as never)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entries('main')[0]?.inject as (() => GitPanelInjected) | undefined)?.()
    if (face === undefined) throw new Error('the main entry carries no injected face')
    face.selectWorkspace(WORKSPACE)
    await vi.waitFor(() => { expect(face.hooks.gitPanel.getSnapshot().repository).toBeDefined() })
    face.openFile('dir/a.txt')
    expect(open).toHaveBeenCalledWith('/repo/dir/a.txt')
    expect(b.openResourceIn).not.toHaveBeenCalled()
  })
})
