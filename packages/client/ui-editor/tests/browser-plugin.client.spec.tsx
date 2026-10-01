// @vitest-environment jsdom
/**
 * The Editor plugin's two registrations and the navigation it publishes: the
 * sidebar entry and its page share one id, both leave with the plugin, and
 * `editorNavigation` selects the panel and opens the document it is handed.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { EditorPage } from '../src/client/EditorPage.tsx'
import { EditorPanelIcon } from '../src/client/EditorPanelIcon.tsx'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import type { EditorInjected } from '../src/client/slots.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const WORKSPACE = 'ws-one' as WorkspaceId

/** One bench: the slot registry, the locale runtime, and scripted document reads. */
async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const workspaceEditor = {
    read: vi.fn(async () => ({
      ok: true as const,
      value: {
        path: 'dir/notes.txt',
        absolutePath: '/w/dir/notes.txt',
        version: 'v1',
        bytes: 6,
        text: 'first\n',
      },
    })),
    write: vi.fn(),
    stat: vi.fn(),
  }
  new TestRemote(ctx, { workspaceEditor })
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel } as never)
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({ items: [{ workspaceId: WORKSPACE, path: '/w' }] }),
      subscribe: () => () => undefined,
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, workspaceEditor, selectPanel }
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

describe('ui-editor browser plugin', () => {
  it('registers the Editor entry and its page under one id, and drops both on unload', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('main')).toHaveLength(0)
    const releaseRoot = declare(b.slots)
    const pages = b.slots.entries('main')
    expect(pages).toHaveLength(1)
    expect(pages[0]?.component).toBe(EditorPage)
    expect(pages[0]?.options).toMatchObject({ key: PANEL_ID })
    expect(pages[0]?.locale).toBe(NS)
    const icons = b.slots.entries('sidebar.panellist')
    expect(icons).toHaveLength(1)
    expect(icons[0]?.component).toBe(EditorPanelIcon)
    expect(icons[0]?.options).toMatchObject({ id: PANEL_ID, order: 15 })
    // The frame's right rail offers the same tool with the same glyph.
    const rail = b.slots.entries('rightrail')
    expect(rail).toHaveLength(1)
    expect(rail[0]?.component).toBe(EditorPanelIcon)
    expect(rail[0]?.options).toMatchObject({ id: PANEL_ID, order: 15 })
    releaseRoot()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(b.slots.entries('rightrail')).toHaveLength(0)
  })

  it('publishes the navigation that selects the panel and opens a document', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navigation = b.ctx.get('editorNavigation')
    if (navigation === undefined) throw new Error('the plugin published no editor navigation')
    expect(navigation.open('/w/dir/notes.txt')).toBe(true)
    expect(b.selectPanel).toHaveBeenCalledWith(PANEL_ID)
    const face = (b.slots.entries('main')[0]?.inject as (() => EditorInjected) | undefined)?.()
    if (face === undefined) throw new Error('the main entry carries no injected face')
    await vi.waitFor(() => {
      expect(face.hooks.editor.getSnapshot().documents[0]?.text).toBe('first\n')
    })
    expect(b.workspaceEditor.read).toHaveBeenCalledWith(WORKSPACE, 'dir/notes.txt')
  })

  it('leaves a path outside every workspace to the caller', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navigation = b.ctx.get('editorNavigation')
    if (navigation === undefined) throw new Error('the plugin published no editor navigation')
    expect(navigation.open('/elsewhere/notes.txt')).toBe(false)
    expect(b.selectPanel).not.toHaveBeenCalled()
    expect(b.workspaceEditor.read).not.toHaveBeenCalled()
  })
})
