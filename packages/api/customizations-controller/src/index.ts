/**
 * Customizations Remote owner: the Skills, MCP, and instruction-file inventory
 * the Web Settings pane renders.
 *
 * The read projects state other owners already hold and invents none of its
 * own: the skill registry's per-scope catalogs, the Loader rows whose module is
 * the MCP client, the tools those rows registered, and the instruction files the
 * agent-instructions plugin would load for this workspace. A skill catalog is
 * scope-layered, so the read walks the composed agent presets and merges their
 * catalogs by name; an MCP server's status derives from its row's enablement and
 * fiber phase plus the `mcp__<server>__` tools actually present in the tool
 * registry.
 *
 * Read-only: this service changes no configuration.
 *
 * @module @deepseek-ai/dsh-api-customizations-controller
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {
  CustomizationBalance,
  ManagedMcpServer,
  CustomizationMcpServer,
  CustomizationMcpTool,
  CustomizationRuleFile,
  CustomizationSkill,
  CustomizationsSnapshot,
  CustomizationUsage,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `customizations` Remote namespace. */
    customizations: CustomizationsController
  }
}

/** The module specifier whose Loader rows are MCP servers. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Prefix one MCP server gives every tool it publishes. */
const MCP_TOOL_PREFIX = 'mcp__'

/** The instruction file the harness home contributes, as `agent-instructions` reads it. */
const USER_INSTRUCTION_FILE = 'AGENTS.md'

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Fiber phase as the wire spells it, with a disposed fiber reported as absent. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, CustomizationMcpServer['fiberPhase']>

/** Fields the constructor re-checks, so a direct construction cannot bypass the schema. */
const POSITIVE_INTEGER_FIELDS = [
  'maxSkills',
  'maxMcpServers',
  'maxMcpTools',
  'maxRuleFiles',
  'maxRuleLevels',
  'bytesPerToken',
  'budgetTokens',
  'balanceTimeoutMs',
] as const

/** The part of a registered tool this inventory reads. */
interface NamedTool {
  readonly name: string
  readonly description: string
}

/** Deployment bounds and estimates for one snapshot. */
export interface Config {
  /** Skills one snapshot returns; a larger catalog is cut and reported truncated. */
  readonly maxSkills: number
  /** MCP servers one snapshot returns. */
  readonly maxMcpServers: number
  /** Tools listed per MCP server. */
  readonly maxMcpTools: number
  /** Instruction files one snapshot returns. */
  readonly maxRuleFiles: number
  /** Ancestor directories the project-root probe may visit. */
  readonly maxRuleLevels: number
  /** Bytes one estimated token stands for. */
  readonly bytesPerToken: number
  /** Customization token budget the estimate is compared against. */
  readonly budgetTokens: number
  /** Directory entry that marks the project root while walking upward. */
  readonly projectMarker: string
  /** Ordered same-directory instruction-file candidates. */
  readonly instructionFileCandidates: string[]
  /** Ordered same-directory overlay candidates, loaded after the base files. */
  readonly localInstructionFileCandidates: string[]
  /** `mcpServers` JSON file the panel reads and writes; empty resolves `<dshHome>/mcp.json`. */
  readonly mcpServersFile: string
  /** Credential reference the DeepSeek balance read authenticates with. */
  readonly apiKeyEnv: string
  /** DeepSeek platform endpoint reporting the key's wallet balance. */
  readonly balanceUrl: string
  /** Milliseconds one balance request may run before its deadline aborts it. */
  readonly balanceTimeoutMs: number
}

/** What one MCP Loader row was configured with, as its config file spelled it. */
interface McpRowFacts {
  readonly serverName: string
  readonly transport: CustomizationMcpServer['transport']
  readonly target: string
}

/** One skill accumulated across the scopes that expose it. */
interface MergedSkill {
  readonly summary: SkillSummary
  readonly presets: string[]
}

/** Whether a Loader config value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the fields this inventory shows out of one MCP row's Loader config.
 *
 * The Loader stores an entry's config as the file spelled it, without applying
 * the plugin's schema defaults, so this narrows the value instead of trusting a
 * type: a row whose config names neither a stdio command nor an HTTP endpoint
 * contributes no server to the pane.
 * @param config - the Loader entry's configured value.
 * @returns the server facts, or undefined when the config names no usable target.
 */
function readMcpRow(config: unknown): McpRowFacts | undefined {
  if (!isRecord(config)) return undefined
  const serverName = config.serverName
  if (typeof serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(serverName)) return undefined
  if (config.transport === 'stdio' && typeof config.command === 'string') {
    const args = Array.isArray(config.args)
      ? config.args.filter((argument): argument is string => typeof argument === 'string')
      : []
    return { serverName, transport: 'stdio', target: [config.command, ...args].join(' ') }
  }
  if (config.transport === 'streamable-http' && typeof config.url === 'string') {
    return { serverName, transport: 'streamable-http', target: config.url }
  }
  return undefined
}

/** Fold one scope's skills into the merged catalog, keeping the first metadata seen. */
function collect(merged: Map<string, MergedSkill>, skills: readonly SkillSummary[], preset: string | undefined): void {
  for (const summary of skills) {
    const existing = merged.get(summary.name)
    if (existing === undefined) {
      merged.set(summary.name, { summary, presets: preset === undefined ? [] : [preset] })
      continue
    }
    if (preset !== undefined && !existing.presets.includes(preset)) existing.presets.push(preset)
  }
}

/** Project one merged catalog entry onto the wire. */
function skillView(skill: MergedSkill): CustomizationSkill {
  const { summary } = skill
  return {
    name: summary.name,
    description: summary.description,
    ...summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse },
    ...summary.path === undefined ? {} : { path: summary.path },
    source: summary.source,
    provider: summary.provider,
    modelInvocable: summary.invocation.modelInvocable,
    userInvocable: summary.invocation.userInvocable,
    presets: skill.presets,
  }
}

/** UTF-8 bytes one string occupies on the wire. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Bytes one skill contributes to the catalog the model is offered. */
function catalogBytesOf(skill: CustomizationSkill): number {
  return byteLength(skill.name) + byteLength(skill.description) + byteLength(skill.whenToUse ?? '')
}

/** Host Remote owner of the `customizations` namespace. */
export class CustomizationsController extends TypertRemoteService {
  static inject = ['loader', 'tools']

  static Config: z<Config> = z.object({
    maxSkills: z.number().step(1).min(1).default(500),
    maxMcpServers: z.number().step(1).min(1).default(100),
    maxMcpTools: z.number().step(1).min(1).default(200),
    maxRuleFiles: z.number().step(1).min(1).default(64),
    maxRuleLevels: z.number().step(1).min(1).default(64),
    bytesPerToken: z.number().step(1).min(1).default(4),
    budgetTokens: z.number().step(1).min(1).default(65_536),
    projectMarker: z.string().default('.git'),
    instructionFileCandidates: z.array(String).default(['AGENTS.md', 'CLAUDE.md']),
    localInstructionFileCandidates: z.array(String).default(['AGENTS.local.md', 'CLAUDE.local.md']),
    mcpServersFile: z.string().default(''),
    apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
    balanceUrl: z.string().default('https://api.deepseek.com/user/balance'),
    balanceTimeoutMs: z.number().step(1).min(1).default(10_000),
  })

  /** Loader row id per managed record, for the rows this plugin mounted itself. */
  private readonly mounted = new Map<string, string>()

  /** Whether the panel-managed list has been read and mounted once. */
  private synced = false

  /**
   * @param ctx - Host context carrying the Loader and the tool registry.
   * @param config - deployment bounds and estimates for one snapshot.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'customizations', { namespace: 'customizations' })
    for (const field of POSITIVE_INTEGER_FIELDS) {
      const value = config[field]
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`customizations-controller requires a positive integer ${field}`)
      }
    }
  }

  /**
   * Read every Skill, MCP server, and instruction file the current composition holds.
   *
   * The read has no Session: skills are merged across the composed presets and
   * the global layer, MCP rows are read from the Loader wherever they were
   * declared, and instruction files are probed from the first registered
   * Workspace directory.
   * @returns the merged catalog, the MCP rows, the instruction chain, and the estimate.
   */
  /**
   * Add one panel-managed MCP server and mount its row immediately.
   * @param server - the record to store and mount.
   * @returns nothing; the caller re-reads the snapshot.
   * @throws RemoteError when the record is invalid or cannot be written.
   */
  @Remote('addMcpServer')
  async addMcpServer(server: ManagedMcpServer): Promise<void> {
    const record = validateManagedServer(server)
    const servers = await this.readStore()
    if (servers.some(existing => existing.id === record.id)) {
      throw new RemoteError('customizations/duplicate-id', `a managed server "${record.id}" exists`, { id: record.id })
    }
    if (servers.some(existing => existing.serverName === record.serverName)) {
      throw new RemoteError('customizations/duplicate-name', `serverName "${record.serverName}" is taken`, { serverName: record.serverName })
    }
    await this.writeStore([...servers, record])
    if (record.enabled) await this.mount(record)
  }

  /**
   * Remove one panel-managed MCP server and unmount its row.
   * @param id - managed record id.
   * @returns nothing; a missing record is already in the asked-for state.
   * @throws RemoteError when the store cannot be written.
   */
  @Remote('removeMcpServer')
  async removeMcpServer(id: string): Promise<void> {
    const servers = await this.readStore()
    await this.writeStore(servers.filter(server => server.id !== id))
    await this.unmount(id)
  }

  /**
   * Enable or disable one panel-managed MCP server without touching the profile.
   * @param id - managed record id.
   * @param enabled - whether the panel should mount the row.
   * @returns nothing; the caller re-reads the snapshot.
   * @throws RemoteError when the record is unknown or the store cannot be written.
   */
  @Remote('setManagedMcpServerEnabled')
  async setManagedMcpServerEnabled(id: string, enabled: boolean): Promise<void> {
    const servers = await this.readStore()
    const found = servers.find(server => server.id === id)
    if (found === undefined) throw new RemoteError('customizations/unknown-server', `no managed server "${id}"`, { id })
    await this.writeStore(servers.map(server => (server.id === id ? { ...server, enabled } : server)))
    if (enabled) await this.mount({ ...found, enabled })
    else await this.unmount(id)
  }

  /**
   * Read the DeepSeek platform balance for this deployment's API key.
   *
   * A deployment without a stored key answers `no-key`; a refused or unreachable
   * request answers `failed`. Neither is an error: the pane reports what it knows.
   * @returns the wallet figures, or the state that explains their absence.
   */
  @Remote('balance')
  async balance(): Promise<CustomizationBalance> {
    const key = await this.apiKey()
    if (key === undefined) return { state: 'no-key' }
    try {
      const response = await fetch(this.config.balanceUrl, {
        headers: { accept: 'application/json', authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(this.config.balanceTimeoutMs),
      })
      if (!response.ok) return { state: 'failed' }
      return readBalance(await response.json())
    } catch {
      // An unreachable or slow platform is a state the pane shows, not a failed read.
      return { state: 'failed' }
    }
  }

  /** The DeepSeek API key this deployment authenticates with, from credentials first. */
  private async apiKey(): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(credentialRef(this.config.apiKeyEnv))
        if (resolved !== undefined && resolved.value !== '') return resolved.value
      } catch {
        // A credential provider that cannot answer falls back to the ambient variable.
      }
    }
    const ambient = process.env[this.config.apiKeyEnv]
    return ambient === undefined || ambient === '' ? undefined : ambient
  }

  @Remote('snapshot')
  async snapshot(): Promise<CustomizationsSnapshot> {
    const cwd = this.workspaceCwd()
    await this.syncStore()
    const skills = await this.readSkills(cwd)
    const rules = await this.readRules(cwd)
    const instructionBytes = rules.rules.reduce((total, rule) => total + rule.bytes, 0)
    const catalogBytes = skills.skills.reduce((total, skill) => total + catalogBytesOf(skill), 0)
    const usage: CustomizationUsage = {
      instructionBytes,
      catalogBytes,
      estimatedTokens: Math.ceil((instructionBytes + catalogBytes) / this.config.bytesPerToken),
      budgetTokens: this.config.budgetTokens,
    }
    return { ...skills, ...rules, usage, mcpServers: this.readMcpServers() }
  }

  /** Merge the global skill layer with every composed preset's catalog. */
  private async readSkills(cwd: string | undefined): Promise<Pick<CustomizationsSnapshot, 'skillsAvailable' | 'presets' | 'skills' | 'skillsTruncated'>> {
    const registry = this.ctx.get('skills')
    if (registry === undefined) {
      return { skillsAvailable: false, presets: [], skills: [], skillsTruncated: false }
    }
    const lookup = cwd === undefined ? {} : { cwd }
    const merged = new Map<string, MergedSkill>()
    try {
      collect(merged, await registry.list(lookup), undefined)
    } catch (error: unknown) {
      this.ctx.logger.warn(`customizations: global skill catalog unavailable: ${String(error)}`)
    }
    const presets: string[] = []
    const roster = this.ctx.get('agentPresets')
    if (roster !== undefined) {
      for (const preset of await roster.compositionInventory()) {
        presets.push(preset.id)
        try {
          await using lease = await roster.acquireScope(preset.id)
          collect(merged, await registry.list({ scope: lease.key, ...lookup }), preset.id)
        } catch (error: unknown) {
          // A preset that cannot mount contributes no skills; its siblings still list.
          this.ctx.logger.warn(`customizations: preset "${preset.id}" skill catalog unavailable: ${String(error)}`)
        }
      }
    }
    const all = [...merged.values()].sort((left, right) => left.summary.name.localeCompare(right.summary.name))
    return {
      skillsAvailable: true,
      presets,
      skills: all.slice(0, this.config.maxSkills).map(skillView),
      skillsTruncated: all.length > this.config.maxSkills,
    }
  }

  /** Read every MCP Loader row and the tools each one currently publishes. */
  private readMcpServers(): CustomizationMcpServer[] {
    const tools = this.ctx.tools.schemas()
    const manageable = this.ctx.get('pluginManager') !== undefined
    const servers: CustomizationMcpServer[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      const facts = readMcpRow(entry.options.config)
      if (facts === undefined) continue
      const managedId = this.managedIdOf(entry.id)
      servers.push({
        entryId: entry.id,
        serverName: facts.serverName,
        transport: facts.transport,
        target: facts.target,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
        tools: this.toolsOf(tools, facts.serverName),
        manageable,
        origin: managedId === undefined ? 'profile' : 'panel',
        ...managedId === undefined ? {} : { managedId },
      })
      if (servers.length >= this.config.maxMcpServers) break
    }
    return servers
  }

  /** Read the tools registered under one server's namespace. */
  private toolsOf(schemas: readonly NamedTool[], serverName: string): CustomizationMcpTool[] {
    const prefix = `${MCP_TOOL_PREFIX}${serverName}__`
    return schemas
      .filter(schema => schema.name.startsWith(prefix))
      .slice(0, this.config.maxMcpTools)
      .map(schema => ({ name: schema.name.slice(prefix.length), description: schema.description }))
  }

  /**
   * Probe the instruction chain this workspace's agents load: the harness home's
   * own file first, then every existing candidate from the project root down to
   * the workspace directory.
   *
   * File discovery belongs to `agent-instructions`; this read mirrors its
   * candidate names and root marker, which the deployment configures here in the
   * same terms, so the pane reports the files that plugin would load.
   */
  private async readRules(cwd: string | undefined): Promise<Pick<CustomizationsSnapshot, 'rules' | 'rulesTruncated'>> {
    const fs = this.ctx.get('fs')
    if (fs === undefined || cwd === undefined) return { rules: [], rulesTruncated: false }
    const files: CustomizationRuleFile[] = []
    const home = this.ctx.get('dshHomePath')
    if (home !== undefined) {
      const path = join(home(), USER_INSTRUCTION_FILE)
      const bytes = await readInstructionBytes(fs, path)
      if (bytes !== undefined) files.push({ name: USER_INSTRUCTION_FILE, path, scope: 'user', bytes })
    }
    const root = await projectRoot(fs, cwd, this.config)
    for (const directory of ancestors(root, cwd)) {
      for (const name of [...this.config.instructionFileCandidates, ...this.config.localInstructionFileCandidates]) {
        const path = join(directory, name)
        const bytes = await readInstructionBytes(fs, path)
        if (bytes !== undefined) files.push({ name, path, scope: 'project', bytes })
      }
    }
    return { rules: files.slice(0, this.config.maxRuleFiles), rulesTruncated: files.length > this.config.maxRuleFiles }
  }

  /** The managed record behind one Loader row, when this plugin mounted it. */
  private managedIdOf(entryId: string): string | undefined {
    for (const [id, mounted] of this.mounted) {
      if (mounted === entryId) return id
    }
    return undefined
  }

  /** Read and mount the managed list once per lifetime. */
  private async syncStore(): Promise<void> {
    if (this.synced) return
    this.synced = true
    for (const server of await this.readStore()) {
      if (server.enabled) await this.mount(server)
    }
  }

  /** Create the Loader row for one managed server, replacing any row it already owns. */
  private async mount(server: ManagedMcpServer): Promise<void> {
    await this.unmount(server.id)
    const id = await this.ctx.loader.create({ name: MCP_CLIENT_MODULE, config: mcpConfigOf(server) })
    this.mounted.set(server.id, id)
    const entry = this.ctx.loader.resolve(id)
    await entry.fiber?.await()
  }

  /** Dispose the Loader row one managed server owns, when it has one. */
  private async unmount(recordId: string): Promise<void> {
    const id = this.mounted.get(recordId)
    if (id === undefined) return
    this.mounted.delete(recordId)
    const entry = this.ctx.loader.store[id]
    if (entry === undefined) return
    const disposal = entry.fiber?.dispose()
    this.ctx.loader.remove(id)
    await disposal
  }

  /** The managed-server store path, or undefined when the deployment has no harness home. */
  private storePath(): string | undefined {
    if (this.config.mcpServersFile !== '') return this.config.mcpServersFile
    const home = this.ctx.get('dshHomePath')
    return home === undefined ? undefined : join(home(), 'mcp.json')
  }

  /** Read the `mcpServers` map; an absent or unreadable file reads as empty. */
  private async readStore(): Promise<ManagedMcpServer[]> {
    const path = this.storePath()
    if (path === undefined) return []
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return []
      return Object.entries(parsed.mcpServers).flatMap(([name, entry]) => {
        const server = readSharedServer(name, entry)
        return server === undefined ? [] : [server]
      })
    } catch {
      // A missing store is the ordinary first run; a corrupt one must not stop the panel.
      return []
    }
  }

  /** Replace the `mcpServers` map atomically and privately, in the shared file format. */
  private async writeStore(servers: readonly ManagedMcpServer[]): Promise<void> {
    const path = this.storePath()
    if (path === undefined) {
      throw new RemoteError('customizations/no-store', 'this deployment has no harness home to store MCP servers in', {})
    }
    const mcpServers: Record<string, unknown> = {}
    for (const server of servers) mcpServers[server.serverName] = sharedServerOf(server)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`, { mode: 0o600 })
  }

  /** The first registered Workspace directory, which project skills and rules are discovered under. */
  private workspaceCwd(): string | undefined {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    return registry.list()[0]?.path
  }
}

/** Read one instruction file's UTF-8 byte count, or undefined when it is absent or unreadable. */
async function readInstructionBytes(fs: FileSystem, path: string): Promise<number | undefined> {
  try {
    const text = await fs.readText(await fs.resolve(path))
    return byteLength(text)
  } catch {
    // An absent or unreadable candidate simply does not load; the chain continues.
    return undefined
  }
}

/**
 * Walk upward to the nearest directory carrying the project marker.
 * @param fs - the host filesystem the probe runs through.
 * @param cwd - the workspace directory the walk starts at.
 * @param config - the marker name and the ancestor bound.
 * @returns the marked ancestor, or the workspace directory when no probe finds one.
 */
async function projectRoot(fs: FileSystem, cwd: string, config: Config): Promise<string> {
  let directory = cwd
  for (let level = 0; level < config.maxRuleLevels; level += 1) {
    const parent = dirname(directory)
    /* v8 ignore next -- root is always an ancestor of cwd: projectRoot only walks upward */
    if (parent === directory) break
    directory = parent
    try {
      if (await fs.stat(await fs.resolve(join(directory, config.projectMarker))) !== undefined) return directory
    } catch {
      // An unreadable marker probe leaves the walk running; the root fallback is the workspace.
    }
  }
  return cwd
}

/** Read the platform's wallet answer, or the state that explains an unreadable one. */
function readBalance(value: unknown): CustomizationBalance {
  if (!isRecord(value) || !Array.isArray(value.balance_infos)) return { state: 'failed' }
  const first: unknown = value.balance_infos[0]
  if (!isRecord(first) || typeof first.currency !== 'string' || typeof first.total_balance !== 'string') {
    return { state: 'failed' }
  }
  return {
    state: 'ready',
    currency: first.currency,
    total: first.total_balance,
    ...typeof first.granted_balance === 'string' ? { granted: first.granted_balance } : {},
    ...typeof first.topped_up_balance === 'string' ? { toppedUp: first.topped_up_balance } : {},
  }
}

/** One string list, or undefined when the value is not a list of strings. */
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every(item => typeof item === 'string') ? [...value] : undefined
}

/** One string record, or undefined when the value is not a record of strings. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (!entries.every(([, item]) => typeof item === 'string')) return undefined
  return Object.fromEntries(entries) as Record<string, string>
}

/**
 * Read one `mcpServers` entry in the shared file format.
 *
 * The format is the one Claude, Cursor, and Antigravity write: a map keyed by
 * server name, `command`/`args`/`env` for a local process and `url`/`headers`
 * for an HTTP endpoint, with an optional `disabled` flag. The key becomes the
 * server's tool namespace.
 * @param name - the map key.
 * @param entry - the parsed entry value.
 * @returns the managed record, or undefined when the entry names no usable target.
 */
function readSharedServer(name: string, entry: unknown): ManagedMcpServer | undefined {
  if (!isRecord(entry) || !/^[A-Za-z0-9_-]{1,32}$/u.test(name)) return undefined
  const enabled = entry.disabled !== true
  const args = stringList(entry.args)
  const env = stringRecord(entry.env)
  const headers = stringRecord(entry.headers)
  const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined
  if (entry.transport !== 'streamable-http' && typeof entry.command === 'string' && entry.command !== '') {
    return {
      id: name,
      serverName: name,
      transport: 'stdio',
      command: entry.command,
      ...args === undefined ? {} : { args },
      ...env === undefined ? {} : { env },
      ...cwd === undefined ? {} : { cwd },
      enabled,
    }
  }
  if (typeof entry.url === 'string' && entry.url !== '') {
    return {
      id: name,
      serverName: name,
      transport: 'streamable-http',
      url: entry.url,
      ...headers === undefined ? {} : { headers },
      enabled,
    }
  }
  return undefined
}

/** Project one managed record back onto the shared file format. */
function sharedServerOf(server: ManagedMcpServer): Record<string, unknown> {
  const disabled = !server.enabled
  if (server.transport === 'stdio') {
    return {
      disabled,
      command: server.command ?? '',
      args: [...server.args ?? []],
      ...server.env === undefined ? {} : { env: { ...server.env } },
      ...server.cwd === undefined || server.cwd === '' ? {} : { cwd: server.cwd },
    }
  }
  return {
    disabled,
    transport: 'streamable-http',
    url: server.url ?? '',
    ...server.headers === undefined ? {} : { headers: { ...server.headers } },
  }
}

/**
 * Reject a record the Loader could not mount, before it reaches the store.
 * @param server - the record a caller asked to add.
 * @returns the same record once it names a usable transport.
 * @throws RemoteError when the id, name, or target is missing or malformed.
 */
function validateManagedServer(server: ManagedMcpServer): ManagedMcpServer {
  if (typeof server.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(server.id)) {
    throw new RemoteError('customizations/bad-request', 'id must start with a letter or digit and use [A-Za-z0-9_-]', {})
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(server.serverName)) {
    throw new RemoteError('customizations/bad-request', 'serverName must match [A-Za-z0-9_-]{1,32}', {})
  }
  if (server.transport === 'stdio' && (typeof server.command !== 'string' || server.command === '')) {
    throw new RemoteError('customizations/bad-request', 'a stdio server needs a command', {})
  }
  if (server.transport === 'streamable-http' && (typeof server.url !== 'string' || server.url === '')) {
    throw new RemoteError('customizations/bad-request', 'an http server needs a url', {})
  }
  return server
}

/** Project one managed record onto the MCP client's own config fields. */
function mcpConfigOf(server: ManagedMcpServer): Record<string, unknown> {
  if (server.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: server.serverName,
      command: server.command ?? '',
      args: [...server.args ?? []],
      ...server.env === undefined ? {} : { env: { ...server.env } },
      ...server.cwd === undefined || server.cwd === '' ? {} : { cwd: server.cwd },
    }
  }
  return {
    transport: 'streamable-http',
    serverName: server.serverName,
    url: server.url ?? '',
    headers: { ...server.headers ?? {} },
  }
}

/** Every directory from one broad root down to a specific directory, inclusive. */
function ancestors(root: string, cwd: string): string[] {
  if (root === cwd) return [cwd]
  const chain: string[] = []
  let directory = cwd
  while (directory !== root) {
    chain.unshift(directory)
    const parent = dirname(directory)
    /* v8 ignore next -- root is always an ancestor of cwd: projectRoot only walks upward */
    if (parent === directory) break
    directory = parent
  }
  /* v8 ignore next -- the walk stops at root, so the chain never starts there */
  if (chain[0] !== root) chain.unshift(root)
  return chain
}

export default CustomizationsController
