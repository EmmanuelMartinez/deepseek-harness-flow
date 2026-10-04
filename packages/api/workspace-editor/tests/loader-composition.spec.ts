/**
 * REAL-composition proof: the shipped `workspace-editor` row boots through the
 * vendored Loader beside the local filesystem, and a user's edit reaches the
 * file with its version check intact.
 *
 * Two seams are stand-ins: the Workspace registry needs durable storage, and
 * the sandbox policy's own service needs the Session projections this
 * composition does not mount. Both are external to the editor, which reads
 * nothing of them beyond the directory lookup and the write policy.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import * as WorkspaceEditorPlugin from '../src/index.ts'

/** Directories the test-local registry answers with. */
const directories = new Map<WorkspaceId, string>()

/** Test-local Workspace registry: the directory lookup the editor performs. */
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

/** Test-local sandbox policy seam: the write the editor performs is the user's own. */
const sandboxPolicy = {
  name: 'test-sandbox-policy',
  apply(ctx: Context): void {
    ctx.provide('sandboxPolicy', {
      workspaceRoot: process.cwd(),
      resolve: () => ({ mode: 'danger-full-access', workspaceRoot: process.cwd() }),
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

describe('real Loader composition', () => {
  it('loads the shipped row and writes a document under its version check', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workspace-editor-loader-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'notes.txt'), 'first\n')

    await writeFile(join(root, 'cordis.yml'), [
      "- name: '@deepseek-ai/dsh-fs-local'",
      "- name: 'test-sandbox-policy'",
      "- name: 'test-workspace-registry'",
      "- name: '@deepseek-ai/dsh-api-workspace-editor'",
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['test-sandbox-policy', sandboxPolicy],
      ['test-workspace-registry', workspaceRegistry],
      ['@deepseek-ai/dsh-api-workspace-editor', WorkspaceEditorPlugin],
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

    const id = 'ws-composed' as WorkspaceId
    directories.set(id, workspace)
    const signal = new AbortController().signal
    const document = await context.workspaceEditor.read(id, 'notes.txt', signal)
    expect(document.text).toBe('first\n')
    const written = await context.workspaceEditor.write(
      id,
      'notes.txt',
      'second\n',
      { kind: 'replaceIfVersion', version: document.version },
      signal,
    )
    expect(written.version).not.toBe(document.version)
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('second\n')
  })
})
