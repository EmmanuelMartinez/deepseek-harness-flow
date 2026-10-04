// @vitest-environment jsdom
/**
 * The Customizations page's presentation: one Host read feeds two views, and
 * loading, failure, empty, search, disclosure, and superseded-read states are
 * visible behavior.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomizationsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { CustomizationsSection } from '../src/client/CustomizationsSection.tsx'
import type {
  CustomizationsSectionInjected,
  CustomizationsSectionProps,
} from '../src/client/CustomizationsSection.tsx'
import { en, type CustomizationsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: CustomizationsLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as CustomizationsSectionProps['t']

type Server = CustomizationsSnapshot['mcpServers'][number]
type Skill = CustomizationsSnapshot['skills'][number]

/** One MCP row with the given status facts. */
function server(overrides: Partial<Server> & Pick<Server, 'entryId' | 'serverName'>): Server {
  return {
    transport: 'stdio',
    target: 'node server.mjs',
    enabled: true,
    fiberPhase: 'active',
    manageable: true,
    origin: 'profile',
    tools: [],
    ...overrides,
  }
}

/** The deployment one case renders: every row status the page can draw. */
const SNAPSHOT: CustomizationsSnapshot = {
  skillsAvailable: true,
  presets: ['standard'],
  skillsTruncated: false,
  skills: [
    {
      name: 'agy-customizations',
      description: 'Explains how customizations work and their loading priority',
      whenToUse: 'When a customization does not load',
      path: '/work/.agents/skills/agy-customizations/SKILL.md',
      source: 'project-agents',
      provider: 'skill-filesystem',
      modelInvocable: true,
      userInvocable: false,
      presets: ['standard'],
    },
    {
      name: 'release-notes',
      description: 'Writes the release notes for one version',
      source: 'bundled',
      provider: 'runtime',
      modelInvocable: false,
      userInvocable: true,
      presets: [],
    },
    {
      name: 'house-style',
      description: 'A provider-agnostic house style guide',
      source: 'external-marketplace',
      provider: 'team-registry',
      modelInvocable: true,
      userInvocable: true,
      presets: [],
    },
  ],
  rules: [
    { name: 'AGENTS.md', path: '/work/AGENTS.md', scope: 'project', bytes: 120 },
    { name: 'AGENTS.md', path: '/Users/someone/.dsh/AGENTS.md', scope: 'user', bytes: 40 },
  ],
  rulesTruncated: false,
  usage: { instructionBytes: 160, catalogBytes: 200, estimatedTokens: 90, budgetTokens: 65536 },
  mcpServers: [
    server({
      entryId: 'mcp-laravel',
      serverName: 'laravel-boost',
      target: 'php artisan boost:mcp',
      tools: [
        { name: 'database_query', description: 'Run a read-only query' },
        { name: 'list_routes', description: 'List application routes' },
      ],
    }),
    server({
      entryId: 'mcp-sentry',
      serverName: 'sentry',
      tools: [{ name: 'list_issues', description: 'List recent issues' }],
    }),
    server({ entryId: 'mcp-bare', serverName: 'bare-server' }),
    server({
      entryId: 'mcp-web',
      serverName: 'web-search',
      transport: 'streamable-http',
      target: 'https://example.test/mcp',
      enabled: false,
      fiberPhase: null,
      manageable: false,
    }),
    server({ entryId: 'mcp-broken', serverName: 'broken-server', fiberPhase: 'failed' }),
    server({ entryId: 'mcp-starting', serverName: 'starting-server', fiberPhase: 'pending' }),
    server({ entryId: 'mcp-loading', serverName: 'loading-server', fiberPhase: 'loading' }),
  ],
}

/** Props for one render, with a scripted Host read and the writes it may make. */
function props(
  list: CustomizationsSectionInjected['list'],
  setEnabled: CustomizationsSectionInjected['setEnabled'] = vi.fn(async () => APPLIED),
  writes: Partial<Pick<CustomizationsSectionInjected, 'addServer' | 'removeServer' | 'setManagedEnabled' | 'readBalance'>> = {},
): CustomizationsSectionProps {
  return {
    t,
    list,
    close: vi.fn(),
    setEnabled,
    addServer: writes.addServer ?? vi.fn(async () => APPLIED),
    removeServer: writes.removeServer ?? vi.fn(async () => APPLIED),
    setManagedEnabled: writes.setManagedEnabled ?? vi.fn(async () => APPLIED),
    readBalance: writes.readBalance ?? vi.fn(async () => READY_BALANCE),
  } as CustomizationsSectionProps
}

/** A wallet answer with both parts present. */
const READY_BALANCE = {
  state: 'ready' as const,
  currency: 'CNY',
  total: '110.00',
  granted: '10.00',
  toppedUp: '100.00',
}

/** A deployment whose one MCP server the panel itself owns. */
const PANEL_SNAPSHOT: CustomizationsSnapshot = {
  ...SNAPSHOT,
  mcpServers: [server({
    entryId: 'row-1',
    serverName: 'mio',
    target: 'php artisan boost:mcp',
    origin: 'panel',
    managedId: 'mio',
  })],
}

/** The accepted enablement write most cases start from. */
const APPLIED = { ok: true as const, application: 'applied' as const }

describe('Customizations section', () => {
  it('shows the loading placeholder until the Host read settles', async () => {
    let settle: (snapshot: CustomizationsSnapshot) => void = () => undefined
    const list = vi.fn(() => new Promise<CustomizationsSnapshot>((resolve) => { settle = resolve }))
    render(<CustomizationsSection {...props(list)} />)
    expect(screen.getByRole('status', { name: en.loading })).toBeDefined()
    await act(async () => { settle(SNAPSHOT) })
    expect(await screen.findByText('agy-customizations')).toBeDefined()
  })

  it('renders each skill with its source, invocability, presets, and path', async () => {
    render(<CustomizationsSection {...props(async () => SNAPSHOT)} />)
    expect(await screen.findByText('agy-customizations')).toBeDefined()
    expect(screen.getByText(en.sourceProjectAgents)).toBeDefined()
    expect(screen.getAllByText(en.modelTag)).toHaveLength(2)
    expect(screen.getAllByText(en.userTag)).toHaveLength(2)
    expect(screen.getByText(`${en.presetsLabel}: standard`)).toBeDefined()
    expect(screen.getByText('/work/.agents/skills/agy-customizations/SKILL.md')).toBeDefined()
    expect(screen.getByText(en.sourceBundled)).toBeDefined()
    // A provider outside the shipped discovery roots keeps its own name.
    expect(screen.getByText('external-marketplace')).toBeDefined()
    expect(screen.getByText(en.skillsCount.replace('{count}', '3'))).toBeDefined()
  })

  it('switches to the MCP view and discloses one server\'s tools', async () => {
    render(<CustomizationsSection {...props(async () => SNAPSHOT)} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (7)` }))
    expect(screen.getByText('laravel-boost')).toBeDefined()
    expect(screen.getByText('php artisan boost:mcp')).toBeDefined()
    expect(screen.getAllByText(en.mcpEnabled)).toHaveLength(6)
    expect(screen.getByText(en.mcpDisabled)).toBeDefined()
    expect(screen.getAllByText(en.mcpTransportStdio)).toHaveLength(6)
    expect(screen.getAllByText(en.mcpTransportHttp)).toHaveLength(1)
    expect(screen.getByText(en.mcpToolsCount.replace('{count}', '2'))).toBeDefined()
    expect(screen.getByText(en.mcpToolCount)).toBeDefined()
    expect(screen.getByText(en.mcpStatusEmpty)).toBeDefined()
    expect(screen.getByText(en.mcpStatusDisabled)).toBeDefined()
    expect(screen.getByText(en.mcpStatusFailed)).toBeDefined()
    expect(screen.getAllByText(en.mcpStatusLoading)).toHaveLength(2)
    expect(screen.queryByText('database_query')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: en.showTools })[0] as HTMLElement)
    expect(screen.getByText('database_query')).toBeDefined()
    expect(screen.getByText('Run a read-only query')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.hideTools }))
    expect(screen.queryByText('database_query')).toBeNull()
  })

  it('writes an enablement change and reports the restart it needs', async () => {
    const setEnabled = vi.fn(async () => ({ ok: true as const, application: 'restart-required' as const }))
    render(<CustomizationsSection {...props(async () => SNAPSHOT, setEnabled)} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (7)` }))
    fireEvent.click(screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'laravel-boost') }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('mcp-laravel', false) })
    expect(await screen.findByText(en.mcpToggleRestart)).toBeDefined()
  })

  it('reports an accepted enablement write and locks the switch while it runs', async () => {
    let settle: (outcome: Awaited<ReturnType<CustomizationsSectionInjected['setEnabled']>>) => void = () => undefined
    const pending = vi.fn(() => new Promise<Awaited<ReturnType<CustomizationsSectionInjected['setEnabled']>>>((resolve) => { settle = resolve }))
    render(<CustomizationsSection {...props(async () => SNAPSHOT, pending)} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (7)` }))
    const toggle = screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'laravel-boost') })
    fireEvent.click(toggle)
    await waitFor(() => { expect(pending).toHaveBeenCalledWith('mcp-laravel', false) })
    expect(screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'laravel-boost') }).getAttribute('disabled')).not.toBeNull()
    await act(async () => { settle(APPLIED) })
    expect(await screen.findByText(en.mcpToggleApplied)).toBeDefined()
  })

  it('reports a refused and a thrown enablement write', async () => {
    const refused = vi.fn(async () => ({ ok: false as const, message: 'unaddressable' }))
    const { unmount } = render(<CustomizationsSection {...props(async () => SNAPSHOT, refused)} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (7)` }))
    fireEvent.click(screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'sentry') }))
    expect(await screen.findByText(en.mcpToggleFailed)).toBeDefined()
    unmount()

    const thrown = vi.fn(async () => { throw new Error('gateway/internal') })
    render(<CustomizationsSection {...props(async () => SNAPSHOT, thrown)} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (7)` }))
    fireEvent.click(screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'bare-server') }))
    expect(await screen.findByText(en.mcpToggleFailed)).toBeDefined()
  })

  it('locks the toggle for a row this profile cannot address', async () => {
    render(<CustomizationsSection {...props(async () => SNAPSHOT)} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (7)` }))
    const locked = screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'web-search') })
    expect(locked.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByText(en.mcpToggleLocked)).toBeDefined()
  })

  it('stores a server the panel adds and reports a refused add', async () => {
    const addServer = vi.fn(async () => APPLIED)
    const first = render(<CustomizationsSection {...props(async () => PANEL_SNAPSHOT, undefined, { addServer })} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (1)` }))
    fireEvent.click(screen.getByRole('button', { name: en.addOpen }))
    fireEvent.change(screen.getByRole('textbox', { name: en.addName }), { target: { value: 'sentry' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.addCommand }), { target: { value: 'npx' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.addArgs }), { target: { value: '-y sentry-mcp' } })
    fireEvent.click(screen.getByRole('button', { name: en.addSave }))
    await waitFor(() => {
      expect(addServer).toHaveBeenCalledWith({
        id: 'sentry',
        serverName: 'sentry',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'sentry-mcp'],
        enabled: true,
      })
    })

    first.unmount()
    const refused = vi.fn(async () => ({ ok: false as const, message: 'customizations/duplicate-name' }))
    render(<CustomizationsSection {...props(async () => PANEL_SNAPSHOT, undefined, { addServer: refused })} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (1)` }))
    fireEvent.click(screen.getByRole('button', { name: en.addOpen }))
    fireEvent.click(screen.getByRole('button', { name: en.addSave }))
    expect(await screen.findByText(en.addFailed)).toBeDefined()
  })

  it('adds an HTTP server, closes the form, and routes a panel row to its own write', async () => {
    const addServer = vi.fn(async () => APPLIED)
    const setManagedEnabled = vi.fn(async () => APPLIED)
    const setEnabled = vi.fn(async () => APPLIED)
    render(<CustomizationsSection {...props(async () => PANEL_SNAPSHOT, setEnabled, { addServer, setManagedEnabled })} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (1)` }))
    expect(screen.getByText(en.originPanel)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.addOpen }))
    fireEvent.click(screen.getByRole('checkbox', { name: en.addStdio }))
    fireEvent.change(screen.getByRole('textbox', { name: en.addUrl }), { target: { value: 'https://x/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: en.addSave }))
    await waitFor(() => { expect(addServer).toHaveBeenCalledWith(expect.objectContaining({ transport: 'streamable-http', url: 'https://x/mcp' })) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.addSave })).toBeNull() })

    fireEvent.click(screen.getByRole('switch', { name: en.mcpToggle.replace('{name}', 'mio') }))
    await waitFor(() => { expect(setManagedEnabled).toHaveBeenCalledWith('mio', false) })
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('cancels the form and reports a refused delete', async () => {
    const removeServer = vi.fn(async () => ({ ok: false as const, message: 'customizations/no-store' }))
    render(<CustomizationsSection {...props(async () => PANEL_SNAPSHOT, undefined, { removeServer })} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (1)` }))
    fireEvent.click(screen.getByRole('button', { name: en.addOpen }))
    fireEvent.click(screen.getByRole('button', { name: en.addCancel }))
    expect(screen.queryByRole('button', { name: en.addSave })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.deleteServer }))
    await waitFor(() => { expect(removeServer).toHaveBeenCalledWith('mio') })
    expect(await screen.findByText(en.mcpToggleFailed)).toBeDefined()
  })

  it('deletes a panel row through the Host write', async () => {
    const removeServer = vi.fn(async () => APPLIED)
    render(<CustomizationsSection {...props(async () => PANEL_SNAPSHOT, undefined, { removeServer })} />)
    fireEvent.click(await screen.findByRole('tab', { name: `${en.tabMcp} (1)` }))
    fireEvent.click(screen.getByRole('button', { name: en.deleteServer }))
    await waitFor(() => { expect(removeServer).toHaveBeenCalledWith('mio') })
  })

  it('filters both views by the search field', async () => {
    render(<CustomizationsSection {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.searchSkills })
    fireEvent.change(search, { target: { value: 'release' } })
    expect(screen.queryByText('agy-customizations')).toBeNull()
    expect(screen.getByText('release-notes')).toBeDefined()
    fireEvent.change(search, { target: { value: 'nothing matches' } })
    expect(screen.getByText(en.emptySearch)).toBeDefined()
    // Clearing one view's search does not touch the other view's own query.
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabMcp} (7)` }))
    const mcpSearch = screen.getByRole('searchbox', { name: en.searchMcp })
    fireEvent.change(mcpSearch, { target: { value: 'list_routes' } })
    expect(screen.getByText('laravel-boost')).toBeDefined()
    expect(screen.queryByText('sentry')).toBeNull()
    fireEvent.change(mcpSearch, { target: { value: 'nothing matches' } })
    expect(screen.getByText(en.emptySearch)).toBeDefined()
    fireEvent.change(mcpSearch, { target: { value: 'release' } })
    expect(screen.queryByText('laravel-boost')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabSkills} (3)` }))
    expect(screen.getByText('release-notes')).toBeDefined()
  })

  it('reports a failed read and re-reads on Retry', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('gateway/internal'))
      .mockResolvedValue(SNAPSHOT)
    render(<CustomizationsSection {...props(list)} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.getByText('agy-customizations')).toBeDefined() })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('reads again from the Refresh button and refuses a second read in flight', async () => {
    const list = vi.fn(async () => SNAPSHOT)
    render(<CustomizationsSection {...props(list)} />)
    await screen.findByText('agy-customizations')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(screen.getByText('agy-customizations')).toBeDefined()
  })

  it('refuses Refresh while the first read is still in flight', async () => {
    let settle: (snapshot: CustomizationsSnapshot) => void = () => undefined
    const list = vi.fn(() => new Promise<CustomizationsSnapshot>((resolve) => { settle = resolve }))
    render(<CustomizationsSection {...props(list)} />)
    const refresh = screen.getByRole('button', { name: en.refresh })
    expect(refresh.getAttribute('disabled')).not.toBeNull()
    await act(async () => { settle(SNAPSHOT) })
    await screen.findByText('agy-customizations')
    expect(screen.getByRole('button', { name: en.refresh }).getAttribute('disabled')).toBeNull()
  })

  it('lists the instruction chain and the estimated budget', async () => {
    render(<CustomizationsSection {...props(async () => SNAPSHOT)} />)
    expect(await screen.findByText(en.usageTitle)).toBeDefined()
    expect(screen.getByRole('img', { name: /90/ })).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabRules} (2)` }))
    expect(screen.getByText('/work/AGENTS.md')).toBeDefined()
    expect(screen.getByText(en.ruleProject)).toBeDefined()
    expect(screen.getByText(en.ruleUser)).toBeDefined()
    const search = screen.getByRole('searchbox', { name: en.searchRules })
    fireEvent.change(search, { target: { value: 'nothing matches' } })
    expect(screen.getByText(en.emptyRules)).toBeDefined()
  })

  it('draws an empty budget and a cut chain', async () => {
    render(<CustomizationsSection {...props(async () => ({
      ...SNAPSHOT,
      rulesTruncated: true,
      usage: { instructionBytes: 0, catalogBytes: 0, estimatedTokens: 0, budgetTokens: 65_536 },
    }))} />)
    expect(await screen.findByText(en.usageTitle)).toBeDefined()
    expect(screen.getByText(en.usageAvailable.replace('{percent}', '100'))).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabRules} (2)` }))
    expect(screen.getByText(new RegExp(en.truncated.replace('{count}', '2')))).toBeDefined()
  })

  it('shows the DeepSeek balance and re-reads it on demand', async () => {
    const readBalance = vi.fn(async () => READY_BALANCE)
    render(<CustomizationsSection {...props(async () => SNAPSHOT, undefined, { readBalance })} />)
    expect(await screen.findByText(
      `${en.balanceTitle}: ${en.balanceAmount.replace('{amount}', '110.00').replace('{currency}', 'CNY')} · ${en.balanceBreakdown.replace('{toppedUp}', '100.00').replace('{granted}', '10.00')}`,
    )).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.balanceRefresh }))
    await waitFor(() => { expect(readBalance).toHaveBeenCalledTimes(2) })
  })

  it('reports a missing key, an unreadable balance, and a wallet without a breakdown', async () => {
    const { unmount } = render(<CustomizationsSection {...props(
      async () => SNAPSHOT,
      undefined,
      { readBalance: vi.fn(async () => ({ state: 'no-key' as const })) },
    )} />)
    expect(await screen.findByText(`${en.balanceTitle}: ${en.balanceNoKey}`)).toBeDefined()
    unmount()

    const failed = render(<CustomizationsSection {...props(
      async () => SNAPSHOT,
      undefined,
      { readBalance: vi.fn(async () => { throw new Error('gateway/internal') }) },
    )} />)
    expect(await screen.findByText(`${en.balanceTitle}: ${en.balanceFailed}`)).toBeDefined()
    failed.unmount()

    render(<CustomizationsSection {...props(
      async () => SNAPSHOT,
      undefined,
      { readBalance: vi.fn(async () => ({ state: 'ready' as const, currency: 'USD', total: '5.00' })) },
    )} />)
    expect(await screen.findByText(
      `${en.balanceTitle}: ${en.balanceAmount.replace('{amount}', '5.00').replace('{currency}', 'USD')}`,
    )).toBeDefined()
  })

  it('reports a workspace with no instruction files', async () => {
    render(<CustomizationsSection {...props(async () => ({ ...SNAPSHOT, rules: [] }))} />)
    await screen.findByText('agy-customizations')
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabRules} (0)` }))
    expect(screen.getByText(en.emptyRules)).toBeDefined()
  })

  it('reports a deployment with no skill registry and no server', async () => {
    render(<CustomizationsSection {...props(async () => ({
      ...SNAPSHOT,
      skillsAvailable: false,
      skills: [],
      mcpServers: [],
    }))} />)
    expect(await screen.findByText(en.skillsUnavailable)).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: `${en.tabMcp} (0)` }))
    expect(screen.getByText(en.emptyMcp)).toBeDefined()
  })

  it('reports an empty catalog', async () => {
    render(<CustomizationsSection {...props(async () => ({ ...SNAPSHOT, skills: [] }))} />)
    expect(await screen.findByText(en.emptySkills)).toBeDefined()
  })

  it('reports a catalog the Host cut to its own cap', async () => {
    render(<CustomizationsSection {...props(async () => ({
      ...SNAPSHOT,
      skills: [SNAPSHOT.skills[0] as Skill],
      skillsTruncated: true,
    }))} />)
    const summary = await screen.findByText(new RegExp(en.truncated.replace('{count}', '1')))
    expect(summary.textContent).toBe(`${en.skillsCount.replace('{count}', '1')} · ${en.truncated.replace('{count}', '1')}`)
  })
})
