/** Customizations Settings section: this deployment's Skills and MCP servers. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ManagedMcpServer, PluginEntryId } from '@deepseek-ai/dsh-api-remotes/client'
import { CustomizationsSection, type CustomizationsSectionInjected } from './CustomizationsSection.tsx'
import type { McpWriteOutcome } from './McpServersList.tsx'
import { en, zh, type CustomizationsLocaleKey } from './locales.ts'

export type { CustomizationsSectionInjected, CustomizationsSectionProps } from './CustomizationsSection.tsx'
export type { CustomizationsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Customizations section copy. */
    'settings.customizations': CustomizationsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.customizations'

/** Services required by the Settings registration and the Remotes the pane writes through. */
export const inject = ['slots', 'locale', 'remote', 'remote.customizations', 'remote.pluginManager']

/**
 * Contribute the Customizations page to the Settings navigation.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-customizations: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: CustomizationsSectionInjected['list'] = async () => {
    const result = await ctx.remote.customizations.snapshot()
    if (!result.ok) {
      throw new Error(`customizations.snapshot failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const setEnabled = async (entryId: string, enabled: boolean): Promise<McpWriteOutcome> => {
    // The Loader handed this id to the Host; the wire carries it back as an opaque string.
    const result = await ctx.remote.pluginManager.setPluginEnabled(entryId as PluginEntryId, enabled)
    if (!result.ok) return { ok: false, message: result.error.code }
    const failure = result.value.error
    if (failure !== undefined) return { ok: false, message: `${failure.code}: ${failure.diagnostic ?? ''}` }
    if (result.value.application === 'failed' || result.value.application === 'cancelled') {
      return { ok: false, message: result.value.application }
    }
    return { ok: true, application: result.value.application }
  }
  const write = async (call: () => Promise<{ ok: boolean; error?: { code: string } }>): Promise<McpWriteOutcome> => {
    const result = await call()
    return result.ok ? { ok: true, application: 'applied' } : { ok: false, message: result.error?.code ?? 'gateway/internal' }
  }
  const addServer = (server: ManagedMcpServer): Promise<McpWriteOutcome> =>
    write(() => ctx.remote.customizations.addMcpServer(server))
  const removeServer = (id: string): Promise<McpWriteOutcome> =>
    write(() => ctx.remote.customizations.removeMcpServer(id))
  const setManagedEnabled = (id: string, enabled: boolean): Promise<McpWriteOutcome> =>
    write(() => ctx.remote.customizations.setManagedMcpServerEnabled(id, enabled))
  const readBalance: CustomizationsSectionInjected['readBalance'] = async () => {
    const result = await ctx.remote.customizations.balance()
    if (!result.ok) throw new Error(`customizations.balance failed: ${result.error.code}`)
    return result.value
  }
  const injected = (): CustomizationsSectionInjected => ({
    list, setEnabled, addServer, removeServer, setManagedEnabled, readBalance,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'customizations',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, CustomizationsSection))
}
