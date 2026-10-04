// @vitest-environment jsdom
/**
 * The Customizations plugin's Settings registration: one `settings.section`
 * contribution appears in the shell's ledger under its dictionary namespace and
 * leaves with the plugin's fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { CustomizationsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { CustomizationsSection } from '../src/client/CustomizationsSection.tsx'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('en-US')
afterEach(cleanup)

const SNAPSHOT: CustomizationsSnapshot = {
  skillsAvailable: true,
  presets: [],
  skillsTruncated: false,
  skills: [],
  mcpServers: [],
  rules: [],
  rulesTruncated: false,
  usage: { instructionBytes: 0, catalogBytes: 0, estimatedTokens: 0, budgetTokens: 65_536 },
}

/** One bench: the slot registry, the locale runtime, and a scripted Host read. */
async function bench(setPluginEnabled?: () => Promise<unknown>) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const snapshot = vi.fn(async () => ({ ok: true as const, value: SNAPSHOT }))
  const enableRow = setPluginEnabled ?? vi.fn(async () => ({
    ok: true as const,
    value: { changed: true, application: 'applied' as const, stage: 'enable' as const, target: 'mcp-bare' },
  }))
  new TestRemote(ctx, { customizations: { snapshot }, pluginManager: { setPluginEnabled: enableRow } })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, snapshot, setPluginEnabled: enableRow }
}

/** A namespace whose one read fails the way the Gateway reports an absent provider. */
async function failingBench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const error = { code: 'gateway/internal', message: 'customizations is unavailable' }
  new TestRemote(ctx, {
    customizations: { snapshot: vi.fn(async () => ({ ok: false as const, error })) },
    pluginManager: { setPluginEnabled: vi.fn(async () => ({ ok: true as const, value: { changed: true, application: 'applied' as const, stage: 'enable' as const, target: 'x' } })) },
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

/** Declare the shell slot this plugin contributes to. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-customizations browser plugin', () => {
  it('keeps the host Loader entry inert and declares the services the browser half uses', () => {
    expect(() => { hostApply() }).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.customizations', 'remote.pluginManager'])
  })

  it('registers the Customizations section and drops it on unload', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const releaseRoot = declare(b.slots)
    const sections = b.slots.entries('settings.section')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.component).toBe(CustomizationsSection)
    expect(sections[0]?.locale).toBe(NS)
    expect(sections[0]?.options).toMatchObject({ id: 'customizations', order: 12 })
    expect(resolveSlotLabel(sections[0]?.options.label)).toBe('Customizations')

    releaseRoot()
    await b.ctx.fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })

  it('reads the Host inventory through the mounted Remote namespace', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    declare(b.slots)
    const section = b.slots.entries('settings.section')[0]
    const injected = (section?.inject as () => { list: () => Promise<CustomizationsSnapshot> })()
    expect(await injected.list()).toBe(SNAPSHOT)
    expect(b.snapshot).toHaveBeenCalledTimes(1)
  })

  it('routes an enablement write through the plugin-manager namespace', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    declare(b.slots)
    const section = b.slots.entries('settings.section')[0]
    const injected = (section?.inject as () => {
      setEnabled: (entryId: string, enabled: boolean) => Promise<{ ok: boolean; application?: string }>
    })()
    await expect(injected.setEnabled('mcp-bare', false)).resolves.toEqual({ ok: true, application: 'applied' })
    expect(b.setPluginEnabled).toHaveBeenCalledWith('mcp-bare', false)
  })

  it('maps every refused enablement answer the Host can return', async () => {
    const cases = [
      {
        answer: async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'no manager' } }),
        expected: { ok: false, message: 'gateway/internal' },
      },
      {
        answer: async () => ({
          ok: true as const,
          value: {
            changed: false,
            application: 'failed' as const,
            stage: 'enable' as const,
            target: 'mcp-bare',
            error: { code: 'unaddressable', diagnostic: 'not in the patch' },
          },
        }),
        expected: { ok: false, message: 'unaddressable: not in the patch' },
      },
      {
        answer: async () => ({
          ok: true as const,
          value: {
            changed: false,
            application: 'failed' as const,
            stage: 'enable' as const,
            target: 'mcp-bare',
            error: { code: 'unaddressable' },
          },
        }),
        expected: { ok: false, message: 'unaddressable: ' },
      },
      {
        answer: async () => ({
          ok: true as const,
          value: { changed: false, application: 'failed' as const, stage: 'enable' as const, target: 'mcp-bare' },
        }),
        expected: { ok: false, message: 'failed' },
      },
    ]
    for (const scenario of cases) {
      const b = await bench(scenario.answer)
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      declare(b.slots)
      const section = b.slots.entries('settings.section')[0]
      const injected = (section?.inject as () => {
        setEnabled: (entryId: string, enabled: boolean) => Promise<unknown>
      })()
      await expect(injected.setEnabled('mcp-bare', true)).resolves.toEqual(scenario.expected)
    }
  })

  it('turns a failed read into a thrown error for the pane', async () => {
    const b = await failingBench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    declare(b.slots)
    const section = b.slots.entries('settings.section')[0]
    const injected = (section?.inject as () => { list: () => Promise<CustomizationsSnapshot> })()
    await expect(injected.list()).rejects.toThrow(
      'customizations.snapshot failed: gateway/internal: customizations is unavailable',
    )
  })
})
