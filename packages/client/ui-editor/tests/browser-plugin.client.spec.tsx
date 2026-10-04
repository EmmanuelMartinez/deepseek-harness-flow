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

/** The session rows and bindings one bench scripts for the reference shortcut. */
interface BenchSessions {
  list: {
    getSnapshot: () => {
      byId: Record<string, { id: string; cwd?: string; retainedBy?: Record<string, number> }>
    }
    subscribe: () => () => void
  }
  binding: (id: string) => { ctx: Context } | undefined
}

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
  const shortcutCommands: unknown[] = []
  ctx.provide('shortcuts', {
    register: (command: unknown) => { shortcutCommands.push(command); return () => undefined },
  } as never)
  const sessions: BenchSessions = {
    list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => undefined },
    binding: () => undefined,
  }
  ctx.provide('sessions', sessions as never)
  let binding: { key: string | undefined; hooks: object; keyedHooks: object; props: Record<string, unknown> } =
    { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const listeners = new Set<() => void>()
  const current = {
    getSnapshot: () => binding,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  ctx.provide('uiSession', { adapter: { current } } as never)
  /** Publish the conversation binding the editor delivers a pending reference into. */
  const publishInput = (actions: unknown): void => {
    binding = { ...binding, props: { inputActions: actions } }
    for (const listener of [...listeners]) listener()
  }
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({ items: [{ workspaceId: WORKSPACE, path: '/w' }] }),
      subscribe: () => () => undefined,
    },
  } as never)
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    workspaceEditor,
    selectPanel,
    shortcutCommands,
    sessions,
    publishInput,
  }
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
    // The left sidebar carries no Editor entry: the frame's right rail is the
    // only place this tool is offered.
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

  it('returns to the conversation and delivers the open file once its input is up', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navigation = b.ctx.get('editorNavigation')
    if (navigation === undefined) throw new Error('the plugin published no editor navigation')
    expect(navigation.open('/w/dir/notes.txt')).toBe(true)
    const command = b.shortcutCommands[0] as {
      resolve: () => { status: string; run?: () => void }
    }
    await vi.waitFor(() => { expect(command.resolve().status).toBe('handled') })
    const insertReferenceAtCaret = vi.fn()
    b.publishInput({ insertReferenceAtCaret })
    command.resolve().run?.()
    expect(b.selectPanel).toHaveBeenCalledWith(null)
    expect(insertReferenceAtCaret).toHaveBeenCalledWith({
      source: 'reference',
      ref: '@dir/notes.txt',
      label: 'notes.txt',
      appearance: 'file',
      clipboardText: '@dir/notes.txt',
    })
  })

  it('names the selected lines in the reference and in its label', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navigation = b.ctx.get('editorNavigation')
    if (navigation === undefined) throw new Error('the plugin published no editor navigation')
    expect(navigation.open('/w/dir/notes.txt')).toBe(true)
    const face = (b.slots.entries('main')[0]?.inject as (() => EditorInjected) | undefined)?.()
    if (face === undefined) throw new Error('the main entry carries no injected face')
    await vi.waitFor(() => { expect(face.hooks.editor.getSnapshot().documents[0]?.text).toBe('first\n') })
    face.select(0, 6)

    const insertReferenceAtCaret = vi.fn()
    b.publishInput({ insertReferenceAtCaret })
    const command = b.shortcutCommands[0] as { resolve: () => { status: string; run?: () => void } }
    command.resolve().run?.()
    expect(insertReferenceAtCaret).toHaveBeenCalledWith(expect.objectContaining({
      ref: '@dir/notes.txt#L1-L2',
      label: 'notes.txt:1-2',
    }))
  })

  it('holds the reference until the input exists, then delivers it', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navigation = b.ctx.get('editorNavigation')
    if (navigation === undefined) throw new Error('the plugin published no editor navigation')
    expect(navigation.open('/w/dir/notes.txt')).toBe(true)
    const command = b.shortcutCommands[0] as { resolve: () => { status: string; run?: () => void } }
    await vi.waitFor(() => { expect(command.resolve().status).toBe('handled') })
    command.resolve().run?.()

    const insertReferenceAtCaret = vi.fn()
    b.publishInput({ insertReferenceAtCaret })
    expect(insertReferenceAtCaret).toHaveBeenCalledWith(expect.objectContaining({ ref: '@dir/notes.txt' }))
  })

  it('blocks the shortcut until a document is open, and delivers nothing without the gesture', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const command = b.shortcutCommands[0] as { resolve: () => { status: string } }
    expect(command.resolve()).toMatchObject({ status: 'blocked' })
    const navigation = b.ctx.get('editorNavigation')
    if (navigation === undefined) throw new Error('the plugin published no editor navigation')
    expect(navigation.open('/w/dir/notes.txt')).toBe(true)
    await vi.waitFor(() => { expect(command.resolve().status).toBe('handled') })
    const insertReferenceAtCaret = vi.fn()
    b.publishInput({ insertReferenceAtCaret })
    expect(insertReferenceAtCaret).not.toHaveBeenCalled()
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
