---
description: "Customizations section in Web Settings for the dsh web client: the deployment's Skills with their discovery source, and its MCP servers with live status and registered tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-customizations

English | [中文](README.zh.md)

## Summary

Open **Settings** and select **Customizations** to see what this deployment gives an agent beyond its built-in tools: the skills a session can load, and the MCP servers it can call. The page reads one snapshot from the Host and splits it into two views, each with its own search over names, descriptions, paths, and tool names. It changes nothing.

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

The **Skills** view lists each skill as a card: its name, the discovery root it came from, whether the model and the user may invoke it, the agent presets that expose it, and its instruction-file path when it has one. The **MCP servers** view lists each server with its enablement, transport, the command line or endpoint its configuration names, and the tools it currently registered; a server with tools discloses them on request.

A server's status line reports the facts the Host can prove. A disabled row reads **Not running**, a failed plugin **Failed to start**, a row that is still loading **Connecting**, and a running row with no registered tools warns that the server may be unreachable rather than claiming a connection. A running row with tools reports their count.

Both views keep their own search, so switching between them never rewrites the query the other list was filtered by. **Refresh** reads the Host again; while a read is in flight the button is disabled, and an answer that a newer read superseded is discarded.

The section registers into `settings.section` with id `customizations` and order 12, so it appears in the Settings navigation between **Models** and **Plugins** under the skill glyph. It reads no Remote during plugin activation: selecting the section for the first time mounts the component and calls `customizations.snapshot()`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half registers one `settings.section` contribution through `ctx.slots.inject`, and the registration's inject face closes over the generated `customizations` Remote namespace: a failed call throws, and the component renders its own error state with Retry rather than exposing a transport code.

The component owns one read state — loading, error, or a ready snapshot — and generation-guards it, so a slower earlier answer never replaces a newer one. The two views are always mounted and hidden, so each keeps its search and disclosure state while the other is shown.

Card layout, the loading skeleton, the empty states, and the failure row are package-local markup on `ui-primitives` controls (`SegmentedTabs`, `Input`, `Button`, `Tag`, `StateDot`, `IconChevronDownOutlineRegular`) and the shared settings-card material; the catalog lists no reusable control the pane could promote.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [api-customizations-controller](../../api/customizations-controller/README.md) — the Host inventory this section renders.
- [ui-settings](../ui-settings/README.md) — the `settings.section` slot type and the settings domain.
- [ui-settings-plugins](../ui-settings-plugins/README.md) — the neighbouring Plugins section.
- [ui-primitives](../ui-primitives/README.md) — the controls and settings-card styling this page composes.

## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Read-only.** The page enables, disables, adds, and edits nothing; MCP management needs its own Host methods and authority review.
- **No connection state.** The MCP client publishes no liveness signal, so the status line reports plugin phase and registered tools instead of a connection.
- **One snapshot per read.** The page does not stream, so a server that connects after the read shows its new tools only after **Refresh**.
- **The skill catalog is merged, not per preset.** A skill several presets provide appears once with all of their ids.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The dictionary namespace is `settings.customizations`. The pane reads the generated `customizations` namespace, mounted by `@deepseek-ai/dsh-api-remotes`; the service itself is `@deepseek-ai/dsh-api-customizations-controller`, mounted as the `customizations-controller` row in `packages/bundle/web-app/cordis.patch.yml`.

</details>

**Runtime invariant:** No companion is published. The pane holds no owned relationship of its own: everything it shows derives from one Host read, and nothing it does writes configuration.
