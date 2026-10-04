---
description: "Read-only Skills and MCP inventory for the Web Customizations settings pane over the `customizations` Remote namespace: the merged skill catalog of the composed agent presets plus every MCP Loader row with the tools it registered."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-customizations-controller

English | [中文](README.zh.md)

## Summary

Use this package to show what a deployment offers an agent as *customizations*: the skills a session can load and the MCP servers it can call. It merges the skill catalog across the composed agent presets and the global layer, reads every Loader row whose module is the MCP client, and projects the tools those rows registered. The service mutates nothing and writes no configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package beside `dsh-tools` and the Loader; the Web bundle mounts it after `workspace-editor`. The browser calls `remote.customizations.snapshot()` once and renders the whole page from the answer.

| Field | Meaning |
|---|---|
| `skillsAvailable` | Whether the composition mounts a skill registry at all. When false the pane says so instead of showing an empty catalog. |
| `presets` | Agent-preset ids whose catalogs were merged, in roster order. |
| `skills` | The merged catalog, sorted by name. |
| `skillsTruncated` | Whether `maxSkills` hid part of the catalog. |
| `mcpServers` | Every MCP Loader row with its live facts. |

Each skill carries its name, description, `whenToUse`, instruction-file path, discovery `source`, `provider`, whether the model and the user may invoke it, and the preset ids whose composition exposes it.

Each MCP server carries its Loader `entryId`, protocol `serverName`, `transport`, the `target` its config names (a command line for stdio, an endpoint URL for streamable-http), effective `enabled`, live `fiberPhase`, whether the profile can address the row for an enablement change (`manageable`), and the `tools` currently registered under `mcp__<serverName>__`.

| Config | Default | Purpose |
|---|---|---|
| `maxSkills` | `500` | Skills one snapshot returns; a larger catalog is cut and reported truncated. |
| `maxMcpServers` | `100` | MCP servers one snapshot returns. |
| `maxMcpTools` | `200` | Tools listed per MCP server. |

Every field must be a positive safe integer; the plugin throws at load otherwise.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Skill catalogs are scope-layered, so a global read alone answers for no preset in the shipped Web composition: the base `skill-filesystem` row is disabled there and each preset owns its own discovery. The read therefore walks `agentPresets.compositionInventory()`, acquires each preset's scope (the same cold-read path the session skill catalog uses, which mounts a preset generation without creating an Agent), lists that scope, and releases the lease. Entries are merged by name: the first metadata seen wins, and later scopes only add their preset id, so a skill every preset provides reports all of them. A preset that cannot mount contributes nothing and is logged; its siblings still list.

MCP rows are read straight from the Loader rather than from a service, because `dsh-mcp-client` publishes none and keeps its connection state in a closure. The row's config is narrowed instead of trusted: the Loader stores what the YAML spelled, without applying the plugin's schema defaults, so a row that names neither a stdio command nor an HTTP endpoint contributes no server. Tool ownership is recovered by the `mcp__<serverName>__` name prefix, the only place that fact exists — `ctx.tools` records no registering plugin.

The workspace directory from the first registered Workspace is passed as the skill lookup `cwd`, because project skill roots are discovered per directory.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Skills subsystem](../../../docs/subsystems/skills.md) — the registry, its layered scopes, and discovery ranks.
- [mcp-client](../../mcp/mcp-client/README.md) — the plugin each row here mounts.
- [Agent preset registry](../../preset/agent-preset-registry/README.md) — the roster and the scope lease this read acquires.
- [API Gateway](../../../docs/api-gateway.md) — how `@Remote` methods become `ctx.remote.customizations`.
- [ui-settings-customizations](../../client/ui-settings-customizations/README.md) — the pane that renders this snapshot.

## Model Experience

None, as this package serves a settings pane and registers no prompt, tool, or session event. It reports what other plugins made model-visible; it adds nothing to a request.

#### KV Cache effect

No direct effect; a read changes no model request.

## Known Limitations and Deferred Work

- **Read-only.** Nothing here enables, disables, adds, or edits a server; the pane that needs those operations requires new methods and their authority review.
- **No MCP connection state.** `dsh-mcp-client` publishes no `connected`, `reconnecting`, or `gaveUp` signal, so a running row with no registered tools is reported as possibly unreachable rather than as connected.
- **Tool ownership is inferred from the name prefix.** A non-MCP tool that happens to be named `mcp__<server>__…` would be counted, and an MCP server whose tools were restricted away from the global view reports none.
- **Preset-scope reads mount a preset generation.** Listing the catalog can activate and then release each preset's plugins; a deployment with expensive preset rows pays that cost on every read.
- **Skills are merged, not attributed per preset.** A skill that two presets define differently reports the first metadata seen and the union of preset ids.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The service key and the wire namespace are both `customizations`, so a Client reads `ctx.remote.customizations.snapshot()`. The package ships a Host face only: `api-remotes` mounts the generated `/remote` contribution, and the pane that consumes it lives in `@deepseek-ai/dsh-client-ui-settings-customizations`.

</details>

**Runtime invariant:** No companion is published. The relationships here — a skill's scope chain and an MCP row's tool prefix — are read from their owning services on every call, so no second cache can diverge from them.
