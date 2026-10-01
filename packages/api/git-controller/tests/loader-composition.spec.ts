/**
 * REAL-composition proof: the shipped `git-controller` row boots through the
 * vendored Loader beside the local subprocess provider and answers for a
 * Workspace whose directory is a real repository.
 *
 * The only stand-in is the Workspace registry: the real one needs durable
 * storage, and this composition reads nothing of it beyond the directory
 * lookup, which the test controls.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import * as GitControllerPlugin from '../src/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gitController: {
      repository(id: WorkspaceId, signal: AbortSignal): Promise<{ kind: string; repository: unknown }>
      status(id: WorkspaceId, signal: AbortSignal): Promise<{ entries: unknown[] }>
      log(id: WorkspaceId, options: { limit: number }, signal: AbortSignal): Promise<{ commits: { subject: string }[] }>
    }
  }
}
// ------------------------------------------
/** Directories the test-local registry answers with. */
const directories = new Map<WorkspaceId, string>()

/** Test-local Workspace registry: the directory lookup the controller performs. */
const workspaceRegistry = {
  name: 'test-workspace-registry',
  apply(ctx: Context): void {
    ctx.provide('workspaceRegistry', {
      get: (id: WorkspaceId) => {
        const path = directories.get(id)
        return path === undefined ? undefined : { path }
      },
    } as never)
  },
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  directories.clear()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Run one git command for fixture setup, outside the composition. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

describe('real Loader composition', () => {
  it('loads the shipped row and answers for the Workspace repository', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-git-controller-loader-'))
    const repo = join(root, 'repo')
    await mkdir(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    await writeFile(join(repo, 'tracked.txt'), 'one\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'init')

    await writeFile(join(root, 'cordis.yml'), [
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      "- name: 'test-workspace-registry'",
      "- name: '@deepseek-ai/dsh-api-git-controller'",
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['test-workspace-registry', workspaceRegistry],
      ['@deepseek-ai/dsh-api-git-controller', GitControllerPlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(join(root, 'cordis.yml')).href },
    })
    await context.loader.await()
    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const id = 'ws-composed' as WorkspaceId
    directories.set(id, repo)
    const signal = new AbortController().signal
    expect(await context.gitController.repository(id, signal)).toMatchObject({
      kind: 'repository',
      repository: { name: 'repo', head: { kind: 'branch', branch: 'main' } },
    })
    const status = await context.gitController.status(id, signal)
    expect(status.entries).toEqual([])
    const log = await context.gitController.log(id, { limit: 5 }, signal)
    expect(log.commits.map(commit => commit.subject)).toEqual(['init'])
  })
})
