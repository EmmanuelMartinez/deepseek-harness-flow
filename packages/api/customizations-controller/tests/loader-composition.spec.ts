/**
 * REAL-composition proof: the shipped `customizations-controller` row boots
 * through the vendored Loader beside the real skill and tool registries, reads
 * a real MCP Loader row's YAML config, and projects the tools that row
 * registered.
 *
 * The MCP client itself is the one stand-in: the real one spawns a server
 * process, and this composition reads nothing of it beyond the row's config and
 * the tools registered under the server's namespace. The Workspace registry is
 * the second: the real one needs durable storage, and this read uses only the
 * directory lookup.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { CustomizationsController } from '../src/index.ts'
import * as CustomizationsControllerPlugin from '../src/index.ts'

/** A stub standing in for the process-spawning MCP client. */
const mcpClientStub = {
  name: 'test-mcp-client',
  inject: ['tools'],
  apply(ctx: Context): void {
    ctx.tools.register({
      name: 'mcp__github__list_issues',
      description: 'List repository issues',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'object' },
        render: () => [{ type: 'text', text: 'ok' }],
      },
      execute: async () => ({}),
    })
  },
}

/** Registers one runtime skill into the real registry. */
const skillProviderStub = {
  name: 'test-skill-provider',
  inject: ['skills'],
  apply(ctx: Context): void {
    ctx.skills.register({
      name: 'release-notes',
      description: 'Writes the release notes for one version',
      content: '# Release notes\n',
      source: 'project-agents',
      path: '/work/.agents/skills/release-notes/SKILL.md',
    })
  },
}

/** Test-local Workspace registry: the directory lookup the controller performs. */
const workspaceRegistry = {
  name: 'test-workspace-registry',
  apply(ctx: Context): void {
    ctx.provide('workspaceRegistry', { list: () => [{ path: '/work' }] } as never)
  },
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('reads skills from the registry and an MCP row with its registered tools', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-customizations-loader-'))
    await writeFile(join(root, 'cordis.yml'), [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-skill'",
      "- name: 'test-skill-provider'",
      "- name: 'test-workspace-registry'",
      "- name: '@deepseek-ai/dsh-mcp-client'",
      '  config:',
      '    transport: stdio',
      '    serverName: github',
      '    command: npx',
      '    args:',
      "      - '-y'",
      "      - '@modelcontextprotocol/server-github'",
      "- name: '@deepseek-ai/dsh-api-customizations-controller'",
      '  config:',
      '    maxSkills: 500',
      '    maxMcpServers: 100',
      '    maxMcpTools: 200',
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', (await import('@deepseek-ai/dsh-system-prompt')).default],
      ['@deepseek-ai/dsh-tools', (await import('@deepseek-ai/dsh-tools')).default],
      ['@deepseek-ai/dsh-skill', (await import('@deepseek-ai/dsh-skill')).default],
      ['test-skill-provider', skillProviderStub],
      ['test-workspace-registry', workspaceRegistry],
      ['@deepseek-ai/dsh-mcp-client', mcpClientStub],
      ['@deepseek-ai/dsh-api-customizations-controller', CustomizationsControllerPlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      import: async (specifier: string) => {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
      loadCache: new Map(),
      register(): never { throw new Error('unexpected module hook registration') },
      getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
      resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
      load(): never { throw new Error('unexpected module load') },
    }
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(join(root, 'cordis.yml')).href },
    })
    await context.loader.await()
    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const controller = context.get('customizations') as CustomizationsController
    const snapshot = await controller.snapshot()
    expect(snapshot.skillsAvailable).toBe(true)
    expect(snapshot.skills).toMatchObject([{
      name: 'release-notes',
      description: 'Writes the release notes for one version',
      source: 'project-agents',
      path: '/work/.agents/skills/release-notes/SKILL.md',
      modelInvocable: true,
      userInvocable: true,
      presets: [],
    }])
    expect(snapshot.presets).toEqual([])
    expect(snapshot.mcpServers).toMatchObject([{
      serverName: 'github',
      transport: 'stdio',
      target: 'npx -y @modelcontextprotocol/server-github',
      enabled: true,
      fiberPhase: 'active',
      manageable: false,
      tools: [{ name: 'list_issues', description: 'List repository issues' }],
    }])
  }, 60_000)
})
