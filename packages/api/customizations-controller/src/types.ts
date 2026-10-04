/** Wire types for the `customizations` Remote namespace. */

/** Discovery root a skill came from, as the skill registry names it. */
export type CustomizationSkillSource = string

/** One skill offered to an Agent, merged across every scope that exposes it. */
export interface CustomizationSkill {
  readonly name: string
  readonly description: string
  /** The situation the skill's own metadata says it applies to. */
  readonly whenToUse?: string
  /** Absolute instruction-file path; absent for a skill a provider registered without a file. */
  readonly path?: string
  readonly source: CustomizationSkillSource
  /** Provider name that contributed the skill. */
  readonly provider: string
  /** Whether the model may load the skill through its own tool. */
  readonly modelInvocable: boolean
  /** Whether a person may select the skill in the composer. */
  readonly userInvocable: boolean
  /** Agent-preset ids whose composition exposes this skill; empty when only the global layer does. */
  readonly presets: readonly string[]
}

/** Which instruction chain one file belongs to. */
export type CustomizationRuleScope = 'user' | 'project'

/** One instruction file an Agent loads for this workspace. */
export interface CustomizationRuleFile {
  /** File name, or the workspace-relative tail when a name repeats down the chain. */
  readonly name: string
  /** Absolute path the read resolved. */
  readonly path: string
  readonly scope: CustomizationRuleScope
  /** UTF-8 bytes the file holds. */
  readonly bytes: number
}

/** Estimated share of the customization budget the current inventory occupies. */
export interface CustomizationUsage {
  /** Bytes of the instruction files the read found. */
  readonly instructionBytes: number
  /** Bytes of the skill names and descriptions the model is offered. */
  readonly catalogBytes: number
  /** Estimated tokens: the measured bytes at the configured ratio. */
  readonly estimatedTokens: number
  /** Budget those tokens are compared against. */
  readonly budgetTokens: number
}

/** One tool an MCP server published under its `mcp__<server>__<name>` identity. */
export interface CustomizationMcpTool {
  /** The tool's own name, without the server prefix. */
  readonly name: string
  readonly description: string
}

/** One panel-managed MCP server, as the panel stores it and mounts its Loader row. */
export interface ManagedMcpServer {
  /** Stable record id the panel addresses for a later change. */
  readonly id: string
  /** Protocol namespace the server's tools carry. */
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio: executable to start. */
  readonly command?: string
  /** stdio: program arguments. */
  readonly args?: readonly string[]
  /** stdio: extra environment merged over the scrubbed ambient environment. */
  readonly env?: Readonly<Record<string, string>>
  /** stdio: working directory the process starts in. */
  readonly cwd?: string
  /** streamable-http: endpoint URL. */
  readonly url?: string
  /** streamable-http: extra request headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Whether the panel mounts this server's row. */
  readonly enabled: boolean
}

/** One MCP server a Loader row connects to. */
export interface CustomizationMcpServer {
  /** Loader entry id, the identity an enablement write addresses. */
  readonly entryId: string
  /** Protocol namespace the server's tools carry. */
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  /** Command line for a stdio server, endpoint URL for a streamable-http one. */
  readonly target: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  /** Live Loader fiber phase; null when the row holds no fiber. */
  readonly fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  /** Tools currently registered under this server's namespace. */
  readonly tools: readonly CustomizationMcpTool[]
  /** Whether the profile can address this row for an enablement change. */
  readonly manageable: boolean
  /** Where the row came from: the profile's composition, or the panel's managed list. */
  readonly origin: 'profile' | 'panel'
  /** The managed record id, present exactly for a panel row. */
  readonly managedId?: string
}

/** What the DeepSeek platform reports for this deployment's API key. */
export interface CustomizationBalance {
  /** `ready` carries the figures; `no-key` and `failed` carry none. */
  readonly state: 'ready' | 'no-key' | 'failed'
  readonly currency?: string
  readonly total?: string
  readonly granted?: string
  readonly toppedUp?: string
}

/** One complete read of everything the Customizations pane shows. */
export interface CustomizationsSnapshot {
  /** Whether the composition mounts a skill registry at all. */
  readonly skillsAvailable: boolean
  /** Agent-preset ids whose catalogs were merged, in roster order. */
  readonly presets: readonly string[]
  /** Skills after the configured cap; a truncated tail is dropped. */
  readonly skills: readonly CustomizationSkill[]
  /** Whether the skill cap hid part of the catalog. */
  readonly skillsTruncated: boolean
  readonly mcpServers: readonly CustomizationMcpServer[]
  /** Instruction files on this workspace's chain, broad to specific. */
  readonly rules: readonly CustomizationRuleFile[]
  /** Whether the rule cap hid part of the chain. */
  readonly rulesTruncated: boolean
  /** Estimated cost of the inventory against the configured budget. */
  readonly usage: CustomizationUsage
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A managed record was asked for with a malformed id, name, or target. */
    'customizations/bad-request': {}
    /** A managed record already uses the requested id. */
    'customizations/duplicate-id': { readonly id: string }
    /** A managed record already uses the requested serverName. */
    'customizations/duplicate-name': { readonly serverName: string }
    /** No managed record carries the requested id. */
    'customizations/unknown-server': { readonly id: string }
    /** This deployment exposes no harness home to store managed servers in. */
    'customizations/no-store': {}
  }
}
