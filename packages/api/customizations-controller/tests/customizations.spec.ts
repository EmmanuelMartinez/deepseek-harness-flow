/**
 * Unit coverage for the Customizations inventory: how the read merges skill
 * scopes and derives MCP server facts from Loader rows and registered tools.
 *
 * The Loader, tool registry, skill registry, preset roster, Workspace registry,
 * and plugin manager are stand-ins here because this spec drives branch
 * coverage: every one of them can fail, be absent, or answer differently from
 * the shipped composition. `loader-composition.spec.ts` boots the shipped row
 * through the real Loader for the product-visible path.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import CustomizationsController from '../src/index.ts'
import type { Config } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** One Loader row as the controller reads it. */
interface FakeEntry {
  readonly id: string
  readonly options: { readonly name: string; readonly config?: unknown }
  readonly disabled?: boolean
  readonly fiber?: { readonly state: FiberState }
}

/** The scope key one stand-in preset lease carries. */
type FakeScope = string

/** One Loader row a fake loader created. */
interface FakeRow {
  readonly id: string
  readonly name: string
  readonly config: unknown
  disposed: boolean
}

/** The parts of the surrounding composition one case varies. */
interface HarnessOptions {
  readonly storeFile?: string
  readonly loader?: Record<string, unknown>
  readonly entries?: readonly FakeEntry[]
  readonly schemas?: readonly { readonly name: string; readonly description: string }[]
  readonly skills?: (options: { readonly scope?: FakeScope; readonly cwd?: string }) => Promise<readonly SkillSummary[]>
  readonly presets?: {
    readonly compositionInventory: () => Promise<readonly { readonly id: string }[]>
    readonly acquireScope: (id?: string) => Promise<{ readonly key: FakeScope } & AsyncDisposable>
  }
  readonly workspaces?: readonly string[]
  readonly pluginManager?: boolean
  readonly config?: Partial<Config>
  readonly fs?: {
    readonly files?: Readonly<Record<string, string>>
    readonly dirs?: readonly string[]
    readonly unreadable?: readonly string[]
    readonly failingPaths?: readonly string[]
  }
  readonly home?: string
}

const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'

/** The deployment bounds every case starts from. */
const BASE_CONFIG: Config = {
  maxSkills: 500,
  maxMcpServers: 100,
  maxMcpTools: 200,
  maxRuleFiles: 64,
  maxRuleLevels: 64,
  bytesPerToken: 4,
  budgetTokens: 65_536,
  projectMarker: '.git',
  instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md'],
  localInstructionFileCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'],
  mcpServersFile: '',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  balanceUrl: 'https://api.deepseek.com/user/balance',
  balanceTimeoutMs: 10_000,
}

/** One MCP Loader row with the given config. */
function mcpEntry(id: string, config: unknown, overrides: Partial<FakeEntry> = {}): FakeEntry {
  return { id, options: { name: MCP_MODULE, config }, fiber: { state: FiberState.ACTIVE }, ...overrides }
}

/** One skill summary with overridable metadata. */
function skill(name: string, overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name,
    description: `${name} does something`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'project-agents',
    provider: 'skill-filesystem',
    ...overrides,
  }
}

/** A Loader stand-in that records the rows a controller mounts and disposes. */
function fakeLoader(): {
  loader: Record<string, unknown>
  rows: FakeRow[]
} {
  const rows: FakeRow[] = []
  let counter = 0
  const store: Record<string, unknown> = {}
  const loader = {
    entries: () => [],
    store,
    create: async (options: { name: string; config?: unknown }) => {
      counter += 1
      const id = `row-${String(counter)}`
      const row: FakeRow = { id, name: options.name, config: options.config, disposed: false }
      rows.push(row)
      store[id] = {
        options: { name: options.name, config: options.config },
        disabled: false,
        fiber: { state: 2, await: async () => undefined, dispose: () => { row.disposed = true } },
      }
      return id
    },
    resolve: (id: string) => store[id],
    remove: (id: string) => { Reflect.deleteProperty(store, id) },
  }
  return { loader, rows }
}

/** A filesystem stand-in: named files, existing marker directories, and scripted failures. */
function fakeFs(options: NonNullable<HarnessOptions['fs']>): object {
  return {
    resolve: async (path: string) => {
      if (options.failingPaths?.includes(path) === true) throw new Error('resolve failed')
      return path
    },
    stat: async (target: string) => (options.dirs?.includes(target) === true ? { type: 'directory' } : undefined),
    readText: async (target: string) => {
      if (options.unreadable?.includes(target) === true) throw new Error('unreadable')
      const text = options.files?.[target]
      if (text === undefined) throw new Error(`no file at ${target}`)
      return text
    },
  }
}

/** Boot the controller over stand-in services. */
async function harness(options: HarnessOptions = {}): Promise<CustomizationsController> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('loader', {
    ...options.loader,
    entries: () => options.entries ?? [],
  } as never)
  ctx.provide('tools', { schemas: () => options.schemas ?? [] } as never)
  if (options.skills !== undefined) {
    ctx.provide('skills', { list: options.skills } as never)
  }
  if (options.presets !== undefined) {
    ctx.provide('agentPresets', options.presets as never)
  }
  if (options.workspaces !== undefined) {
    ctx.provide('workspaceRegistry', { list: () => options.workspaces?.map(path => ({ path })) } as never)
  }
  if (options.pluginManager === true) ctx.provide('pluginManager', {} as never)
  if (options.fs !== undefined) ctx.provide('fs', fakeFs(options.fs) as never)
  if (options.home !== undefined) ctx.provide('dshHomePath', (() => options.home) as never)
  await ctx.plugin(CustomizationsController, {
    ...BASE_CONFIG,
    ...options.config,
    ...options.storeFile === undefined ? {} : { mcpServersFile: options.storeFile },
  })
  return ctx.get('customizations') as CustomizationsController
}

/** A preset roster whose leases the caller settles itself. */
function presetRoster(ids: readonly string[]): NonNullable<HarnessOptions['presets']> {
  return {
    compositionInventory: async () => ids.map(id => ({ id })),
    acquireScope: async (id?: string) => ({
      key: `scope:${id ?? 'default'}`,
      [Symbol.asyncDispose]: async () => {},
    }),
  }
}

describe('skill catalog', () => {
  it('reports an absent registry instead of failing the read', async () => {
    const controller = await harness()
    expect(await controller.snapshot()).toEqual({
      skillsAvailable: false,
      presets: [],
      skills: [],
      skillsTruncated: false,
      mcpServers: [],
      rules: [],
      rulesTruncated: false,
      usage: { instructionBytes: 0, catalogBytes: 0, estimatedTokens: 0, budgetTokens: 65_536 },
    })
  })

  it('keeps the MCP rows when the global catalog fails', async () => {
    const controller = await harness({
      entries: [mcpEntry('mcp-github', { transport: 'stdio', serverName: 'github', command: 'npx' })],
      skills: async () => { throw new Error('provider exploded') },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.skillsAvailable).toBe(true)
    expect(snapshot.skills).toEqual([])
    expect(snapshot.mcpServers.map(server => server.serverName)).toEqual(['github'])
  })

  it('merges global and per-preset catalogs, keeping the first metadata seen', async () => {
    const controller = await harness({
      skills: async (options) => {
        if (options.scope === undefined) {
          return [skill('shared', { description: 'global copy' }), skill('shared'), skill('global-only')]
        }
        if (options.scope === 'scope:standard') return [skill('shared', { description: 'preset copy' }), skill('standard-only')]
        return [skill('shared'), skill('ptc-only')]
      },
      presets: presetRoster(['standard', 'ptc']),
      workspaces: ['/work/project'],
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.presets).toEqual(['standard', 'ptc'])
    expect(snapshot.skills.map(entry => entry.name)).toEqual(['global-only', 'ptc-only', 'shared', 'standard-only'])
    expect(snapshot.skills.find(entry => entry.name === 'shared')).toMatchObject({
      description: 'global copy',
      presets: ['standard', 'ptc'],
    })
    expect(snapshot.skills.find(entry => entry.name === 'global-only')?.presets).toEqual([])
  })

  it('skips a preset that cannot mount and keeps listing its siblings', async () => {
    const controller = await harness({
      skills: async options => (options.scope === 'scope:ptc' ? [skill('ptc-only')] : []),
      presets: {
        compositionInventory: async () => [{ id: 'broken' }, { id: 'ptc' }],
        acquireScope: async (id?: string) => {
          if (id === 'broken') throw new Error('preset is unavailable')
          return { key: 'scope:ptc', [Symbol.asyncDispose]: async () => {} }
        },
      },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.presets).toEqual(['broken', 'ptc'])
    expect(snapshot.skills.map(entry => entry.name)).toEqual(['ptc-only'])
  })

  it('carries a skill path and whenToUse through and cuts the configured cap', async () => {
    const controller = await harness({
      skills: async () => [
        skill('alpha', { whenToUse: 'when alpha', path: '/work/.agents/skills/alpha/SKILL.md', source: 'bundled' }),
        skill('beta', { invocation: { modelInvocable: false, userInvocable: false }, source: 'runtime' }),
      ],
      config: { maxSkills: 2 },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.skillsTruncated).toBe(false)
    expect(snapshot.skills[0]).toMatchObject({
      name: 'alpha',
      whenToUse: 'when alpha',
      path: '/work/.agents/skills/alpha/SKILL.md',
      source: 'bundled',
      modelInvocable: true,
      userInvocable: true,
    })
    expect(snapshot.skills[1]).toMatchObject({ name: 'beta', modelInvocable: false, userInvocable: false })
  })

  it('reports a catalog the configured cap hid', async () => {
    const controller = await harness({
      skills: async () => [skill('alpha'), skill('beta')],
      config: { maxSkills: 1 },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.skills.map(entry => entry.name)).toEqual(['alpha'])
    expect(snapshot.skillsTruncated).toBe(true)
  })
})

describe('MCP rows', () => {
  it('derives a stdio server with the tools registered under its namespace', async () => {
    const controller = await harness({
      entries: [
        mcpEntry('mcp-github', { transport: 'stdio', serverName: 'github', command: 'npx', args: ['-y', 'server-github', 7] }),
        { id: 'other', options: { name: '@deepseek-ai/dsh-skill' } },
      ],
      schemas: [
        { name: 'mcp__github__create_issue', description: 'Create an issue' },
        { name: 'mcp__github__search', description: 'Search' },
        { name: 'read_file', description: 'Not MCP' },
        { name: 'mcp__web__search', description: 'Another server' },
      ],
      pluginManager: true,
    })
    expect(await controller.snapshot()).toMatchObject({
      mcpServers: [{
        entryId: 'mcp-github',
        serverName: 'github',
        transport: 'stdio',
        target: 'npx -y server-github',
        enabled: true,
        fiberPhase: 'active',
        manageable: true,
        tools: [
          { name: 'create_issue', description: 'Create an issue' },
          { name: 'search', description: 'Search' },
        ],
      }],
    })
  })

  it('reads a streamable-http row and reports an unaddressable profile', async () => {
    const controller = await harness({
      entries: [mcpEntry('mcp-web', { transport: 'streamable-http', serverName: 'web', url: 'https://example.test/mcp' })],
    })
    expect(await controller.snapshot()).toMatchObject({
      mcpServers: [{
        serverName: 'web',
        transport: 'streamable-http',
        target: 'https://example.test/mcp',
        manageable: false,
        tools: [],
      }],
    })
  })

  it('drops rows whose config names no usable target', async () => {
    const controller = await harness({
      entries: [
        mcpEntry('no-config', undefined),
        mcpEntry('not-an-object', 'stdio'),
        mcpEntry('no-server-name', { transport: 'stdio', command: 'npx' }),
        mcpEntry('bad-server-name', { transport: 'stdio', serverName: 'has spaces', command: 'npx' }),
        mcpEntry('stdio-without-command', { transport: 'stdio', serverName: 'alpha' }),
        mcpEntry('http-without-url', { transport: 'streamable-http', serverName: 'beta' }),
        mcpEntry('unknown-transport', { transport: 'sse', serverName: 'gamma', url: 'https://example.test' }),
        mcpEntry('usable', { transport: 'stdio', serverName: 'delta', command: 'node' }),
      ],
    })
    expect((await controller.snapshot()).mcpServers.map(server => server.serverName)).toEqual(['delta'])
  })

  it('reports a disabled, failed, or not-yet-loaded row honestly', async () => {
    const controller = await harness({
      entries: [
        mcpEntry('mcp-off', { transport: 'stdio', serverName: 'off', command: 'node' }, { disabled: true }),
        mcpEntry('mcp-failed', { transport: 'stdio', serverName: 'failed', command: 'node' }, { fiber: { state: FiberState.FAILED } }),
        mcpEntry('mcp-loading', { transport: 'stdio', serverName: 'loading', command: 'node' }, { fiber: { state: FiberState.LOADING } }),
        mcpEntry('mcp-pending', { transport: 'stdio', serverName: 'pending', command: 'node' }, { fiber: { state: FiberState.PENDING } }),
        mcpEntry('mcp-gone', { transport: 'stdio', serverName: 'gone', command: 'node' }, { fiber: { state: FiberState.DISPOSED } }),
        { id: 'mcp-bare', options: { name: MCP_MODULE, config: { transport: 'stdio', serverName: 'bare', command: 'node' } } },
      ],
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.mcpServers.map(server => [server.serverName, server.enabled, server.fiberPhase])).toEqual([
      ['off', false, 'active'],
      ['failed', true, 'failed'],
      ['loading', true, 'loading'],
      ['pending', true, 'pending'],
      ['gone', true, null],
      ['bare', true, null],
    ])
  })

  it('applies the server and per-server tool caps', async () => {
    const controller = await harness({
      entries: [
        mcpEntry('one', { transport: 'stdio', serverName: 'one', command: 'node', args: ['a'] }),
        mcpEntry('two', { transport: 'stdio', serverName: 'two', command: 'node' }),
      ],
      schemas: [
        { name: 'mcp__one__first', description: 'First' },
        { name: 'mcp__one__second', description: 'Second' },
      ],
      config: { maxMcpServers: 1, maxMcpTools: 1 },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.mcpServers).toHaveLength(1)
    expect(snapshot.mcpServers[0]?.tools.map(tool => tool.name)).toEqual(['first'])
  })

  it('reads no workspace and no plugin manager when the composition has neither', async () => {
    const controller = await harness({
      skills: async () => [],
      presets: presetRoster([]),
    })
    expect(await controller.snapshot()).toMatchObject({ skillsAvailable: true, presets: [], mcpServers: [] })
  })
})

describe('instruction chain and budget', () => {
  it('reads the harness home file, the project chain, and the estimate', async () => {
    const controller = await harness({
      workspaces: ['/work/app'],
      home: '/home/user/.dsh',
      fs: {
        dirs: ['/work/.git'],
        files: {
          '/home/user/.dsh/AGENTS.md': 'user rules',
          '/work/AGENTS.md': 'project rules',
          '/work/app/CLAUDE.local.md': 'local overlay',
        },
      },
      skills: async () => [skill('alpha', { whenToUse: 'when alpha' })],
      config: { bytesPerToken: 4 },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.rules.map(rule => [rule.scope, rule.name, rule.path])).toEqual([
      ['user', 'AGENTS.md', '/home/user/.dsh/AGENTS.md'],
      ['project', 'AGENTS.md', '/work/AGENTS.md'],
      ['project', 'CLAUDE.local.md', '/work/app/CLAUDE.local.md'],
    ])
    expect(snapshot.rules[0]?.bytes).toBe(10)
    expect(snapshot.usage.instructionBytes).toBe(10 + 13 + 13)
    expect(snapshot.usage.catalogBytes).toBeGreaterThan(0)
    expect(snapshot.usage.estimatedTokens).toBe(
      Math.ceil((snapshot.usage.instructionBytes + snapshot.usage.catalogBytes) / 4),
    )
    expect(snapshot.usage.budgetTokens).toBe(65_536)
    expect(snapshot.rulesTruncated).toBe(false)
  })

  it('falls back to the workspace directory when no marker exists', async () => {
    const controller = await harness({
      workspaces: ['/solo'],
      fs: { files: { '/solo/AGENTS.md': 'rules' } },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.rules.map(rule => rule.path)).toEqual(['/solo/AGENTS.md'])
  })

  it('keeps walking when a candidate or a marker probe fails', async () => {
    const controller = await harness({
      workspaces: ['/work/app'],
      fs: {
        dirs: ['/work/app/.git'],
        files: { '/work/app/AGENTS.md': 'rules' },
        unreadable: ['/work/CLAUDE.md'],
        failingPaths: ['/work/.git'],
      },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.rules.map(rule => rule.path)).toEqual(['/work/app/AGENTS.md'])
  })

  it('cuts the chain at the configured file cap', async () => {
    const controller = await harness({
      workspaces: ['/work'],
      fs: { files: { '/work/AGENTS.md': 'a', '/work/CLAUDE.md': 'b' } },
      config: { maxRuleFiles: 1 },
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.rules).toHaveLength(1)
    expect(snapshot.rulesTruncated).toBe(true)
  })

  it('keeps one entry when a preset lists the same name twice', async () => {
    const controller = await harness({
      skills: async options => (options.scope === 'scope:standard'
        ? [skill('shared', { description: 'first' }), skill('shared', { description: 'second' })]
        : []),
      presets: presetRoster(['standard']),
    })
    const snapshot = await controller.snapshot()
    expect(snapshot.skills).toMatchObject([{ name: 'shared', description: 'first', presets: ['standard'] }])
  })

  it('reads no user file when the harness home has none', async () => {
    const controller = await harness({
      workspaces: ['/work'],
      home: '/home/user/.dsh',
      fs: { files: { '/work/AGENTS.md': 'rules' } },
    })
    expect((await controller.snapshot()).rules.map(rule => rule.scope)).toEqual(['project'])
  })

  it('reports no workspace directory when the registry lists none', async () => {
    const controller = await harness({ workspaces: [], skills: async () => [] })
    expect(await controller.snapshot()).toMatchObject({ rules: [], usage: { instructionBytes: 0 } })
  })

  it('reads no rules without a filesystem or a workspace', async () => {
    const withWorkspace = await harness({ workspaces: ['/work'] })
    expect(await withWorkspace.snapshot()).toMatchObject({ rules: [], rulesTruncated: false })
    const withFs = await harness({ fs: {} })
    expect(await withFs.snapshot()).toMatchObject({ rules: [] })
  })
})

describe('panel-managed MCP servers', () => {
  it('stores and mounts an added server, then unmounts it on removal', async () => {
    const storeFile = join(tmpdir(), `dsh-managed-${String(Date.now())}-${String(Math.random())}.json`)
    const { loader, rows } = fakeLoader()
    const controller = await harness({ loader, storeFile })
    await controller.addMcpServer({
      id: 'mio',
      serverName: 'mio',
      transport: 'stdio',
      command: 'php',
      args: ['artisan', 'boost:mcp'],
      enabled: true,
    })
    expect(rows.map(row => row.name)).toEqual(['@deepseek-ai/dsh-mcp-client'])
    expect(rows[0]?.config).toMatchObject({ transport: 'stdio', serverName: 'mio', command: 'php', args: ['artisan', 'boost:mcp'] })
    const stored: unknown = JSON.parse(await readFile(storeFile, 'utf8'))
    expect(stored).toEqual({ mcpServers: { mio: { disabled: false, command: 'php', args: ['artisan', 'boost:mcp'] } } })
    expect((await controller.snapshot()).mcpServers).toEqual([])

    await controller.removeMcpServer('mio')
    expect(rows[0]?.disposed).toBe(true)
    expect(JSON.parse(await readFile(storeFile, 'utf8'))).toEqual({ mcpServers: {} })
    await rm(storeFile, { force: true })
  })

  it('mounts a stored server once on the first snapshot and flips it off and on', async () => {
    const storeFile = join(tmpdir(), `dsh-managed-${String(Date.now())}-${String(Math.random())}.json`)
    const { loader, rows } = fakeLoader()
    const controller = await harness({ loader, storeFile })
    await controller.addMcpServer({ id: 'web', serverName: 'web', transport: 'streamable-http', url: 'https://x/mcp', enabled: false })
    expect(rows).toHaveLength(0)
    await controller.setManagedMcpServerEnabled('web', true)
    expect(rows).toHaveLength(1)
    await controller.setManagedMcpServerEnabled('web', false)
    expect(rows[0]?.disposed).toBe(true)
    await rm(storeFile, { force: true })
  })

  it('reads the shared file format, including env, headers, and the disabled flag', async () => {
    const storeFile = join(tmpdir(), `dsh-managed-shared-${String(Date.now())}.json`)
    await writeFile(storeFile, JSON.stringify({
      mcpServers: {
        boost: { disabled: false, command: 'bash', args: ['-c', './vendor/bin/sail artisan boost:mcp'], env: { APP_ENV: 'local' } },
        off: { disabled: true, command: 'node', args: ['server.mjs'] },
        mercadopago: { transport: 'streamable-http', url: 'https://mcp.mercadopago.com/mcp', headers: { Authorization: 'Bearer x' } },
        broken: { args: ['nothing'] },
        'bad name': { command: 'node' },
        'not-an-object': 7,
      },
    }))
    const { loader, rows } = fakeLoader()
    const controller = await harness({ loader, storeFile })
    const snapshot = await controller.snapshot()
    expect(snapshot.mcpServers).toEqual([])
    expect(rows.map(row => [row.name, (row.config as { serverName: string }).serverName])).toEqual([
      ['@deepseek-ai/dsh-mcp-client', 'boost'],
      ['@deepseek-ai/dsh-mcp-client', 'mercadopago'],
    ])
    expect(rows[0]?.config).toMatchObject({ transport: 'stdio', command: 'bash', env: { APP_ENV: 'local' } })
    expect(rows[1]?.config).toMatchObject({ transport: 'streamable-http', url: 'https://mcp.mercadopago.com/mcp' })
    await rm(storeFile, { force: true })
  })

  it('refuses a duplicate id, a duplicate name, a malformed record, and an unknown id', async () => {
    const storeFile = join(tmpdir(), `dsh-managed-${String(Date.now())}-${String(Math.random())}.json`)
    const controller = await harness({ loader: fakeLoader().loader, storeFile })
    const base = { id: 'one', serverName: 'one', transport: 'stdio' as const, command: 'node', enabled: true }
    await controller.addMcpServer(base)
    await expect(controller.addMcpServer(base)).rejects.toThrow('exists')
    await expect(controller.addMcpServer({ ...base, id: 'two' })).rejects.toThrow('is taken')
    await expect(controller.addMcpServer({ ...base, id: 'bad id' })).rejects.toThrow('must start with a letter or digit')
    await expect(controller.addMcpServer({ ...base, id: 'three', serverName: 'bad name' })).rejects.toThrow('serverName must match')
    await expect(controller.addMcpServer({ ...base, id: 'four', serverName: 'four', command: '' })).rejects.toThrow('needs a command')
    await expect(controller.addMcpServer({ ...base, id: 'five', serverName: 'five', transport: 'streamable-http' })).rejects.toThrow('needs a url')
    await expect(controller.setManagedMcpServerEnabled('missing', true)).rejects.toThrow('no managed server')
    await rm(storeFile, { force: true })
  })

  it('reports no store and ignores a corrupt one', async () => {
    const controller = await harness({ loader: fakeLoader().loader, config: { mcpServersFile: '' } })
    await expect(controller.addMcpServer({ id: 'x', serverName: 'x', transport: 'stdio', command: 'node', enabled: true }))
      .rejects.toThrow('no harness home')
    const corrupt = join(tmpdir(), `dsh-managed-corrupt-${String(Date.now())}.json`)
    await writeFile(corrupt, '{ not json')
    const reading = await harness({ loader: fakeLoader().loader, storeFile: corrupt })
    expect(await reading.snapshot()).toMatchObject({ mcpServers: [] })
    await rm(corrupt, { force: true })
  })
})

describe('configuration', () => {
  it('refuses a non-positive bound at load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('loader', { entries: () => [] } as never)
    ctx.provide('tools', { schemas: () => [] } as never)
    await expect(ctx.plugin(CustomizationsController, { ...BASE_CONFIG, maxSkills: 0 }))
      .rejects.toThrow('invalid config')
  })

  it('refuses a non-positive bound a direct construction passes', () => {
    const ctx = new Context()
    contexts.push(ctx)
    expect(() => new CustomizationsController(ctx, { ...BASE_CONFIG, maxSkills: 0 }))
      .toThrow('customizations-controller requires a positive integer maxSkills')
  })
})
