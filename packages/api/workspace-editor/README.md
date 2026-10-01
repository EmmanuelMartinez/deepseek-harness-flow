---
description: "Workspace document editor over the `workspaceEditor` Remote namespace: read, stat, and version-checked writes confined to a registered Workspace, so a person can review and edit a file in the Harness instead of another application."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-editor

English | [中文](README.zh.md)

## Summary

Use this package where a person, not the model, edits a file. It reads one Workspace document with the version token a save must send back, reports that identity again on demand, and writes the complete text only while the file still holds the version the caller read. Paths are relative to a registered Workspace and refused outside it. `writeMode` selects the sandbox policy the write runs under, defaulting to the user's own authority because this service already confines the target to the Workspace it named.

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

Mount the package beside `dsh-fs`, `dsh-sandbox-policy`, and the Workspace registry; the Web bundle mounts it right after the Git Controller. Every method names a `WorkspaceId` and a Workspace-relative path, so a Client calls `remote.workspaceEditor.read(workspaceId, path, signal)`, `stat(workspaceId, path, signal)`, or `write(workspaceId, path, text, expected, signal)` and never names a directory.

| Method | Returns | Purpose |
|---|---|---|
| `read` | `WorkspaceDocumentView` | The document's complete text, its absolute path, its byte size, and the version a save must send back. |
| `stat` | `WorkspaceDocumentStatView` | The same identity without the text, for a freshness check before saving. |
| `write` | `WorkspaceDocumentStatView` | Replaces the document under the caller's expectation and reports the new version; creates it when the caller asks for a create. |

The expectation is what makes an edit safe to offer:

| Expectation | Meaning |
|---|---|
| `{ kind: 'replaceIfVersion', version }` | Write only while the file still holds that version. A file that changed underneath — by the Agent, by another tab, by a build — is refused, and the failure carries the version it holds now. |
| `{ kind: 'createIfAbsent' }` | Create the file, refusing when anything already exists at the path. |

| Config | Default | Purpose |
|---|---|---|
| `maxFileBytes` | `4194304` | Inclusive byte cap on one document, for a read and a write alike. Content beyond it is refused, never truncated. |
| `writeMode` | `danger-full-access` | Sandbox policy the user's own edit runs under. `read-only` refuses every write and leaves reads intact. |

### Failures

| Code | Details | Meaning |
|---|---|---|
| `workspace-editor/not-found` | `path` | No entry exists at that path. |
| `workspace-editor/not-regular-file` | `path`, `kind` | The path is a directory, symlink, or something else with no text. |
| `workspace-editor/outside-workspace` | `path` | The path is absolute or steps out of the Workspace root. |
| `workspace-editor/too-large` | `path`, `limit` | The document exceeds `maxFileBytes`. |
| `workspace-editor/not-text` | `path` | The content is not decodable UTF-8, or carries NUL bytes. |
| `workspace-editor/stale` | `path`, `current?` | The file changed since the version the caller read; `current` is the version it holds now. |
| `workspace-editor/not-observed` | `path` | A create-only write found something at the path already. |
| `workspace-editor/write-failed` | `path`, `code` | The filesystem refused the write for a reason this service does not classify further. |
| `workspace/not-found` | `workspaceId` | No Workspace registration carries that identity. |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Workspace registration is the only directory authority. `ctx.workspaceRegistry.get` resolves the root, `ctx.fs.resolve` resolves the target against it, and `ctx.fs.contains` refuses anything outside; a path that is absolute, carries a `..` segment, or holds a NUL byte is refused before resolution.

Reads and writes share one cap. A read checks the stat size first, reads the complete text, and refuses either side of that check when it exceeds `maxFileBytes`; NUL bytes are refused as binary. A write checks the content's byte length before touching the file, so an oversized save is refused rather than cut.

The version check is the filesystem's own: `writeText` takes `replaceIfVersion` or `createIfAbsent`, and the local provider rejects a mismatch with `FS_STALE_VERSION` or an occupied path with `FS_NOT_OBSERVED`. This service maps those onto the wire vocabulary and, for a stale write, reports the version the file holds now so a client can offer a reload instead of a blind overwrite. Error codes are read structurally, because the error class belongs to whichever filesystem instance the provider loaded.

`writeMode` exists because this is a person editing their own machine, not an Agent tool call: the value is a deployment choice, so it is a validated Config field rather than a constant. `read-only` makes every browser surface read-only without touching reads.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Filesystem](../../fs/fs/README.md) — the service every read and write goes through, and the write intents this package relies on.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — the resolved policy a write is performed under.
- [Workspace entity](../../workspace/workspace/README.md) — the registration this service resolves a root from.
- [workspace-files](../workspace-files/README.md) — the read-only sibling this package deliberately does not extend.

## Model Experience

None, as this package serves a person editing their own files and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading or writing a document does not alter model requests already in flight.

## Known Limitations and Deferred Work

- **No turn accounting.** A user's edit is not recorded as a Session event, matching the terminal: the log is the Agent's record, not a keystroke log. A turn's changed-files card therefore reports what git sees at its own snapshot points, not who wrote it.
- **Conflicts are reported, never merged.** A stale save is refused with the current version; merging two text versions is the caller's decision.
- **Whole-file writes only.** There is no range or patch write, so a large document is sent complete on every save.
- **The write cap is smaller than the read cap of its sibling.** `maxFileBytes` defaults to 4 MiB, because a browser editor holds the whole document in memory.
- **Deployment policy is coarse.** `writeMode` is one value for every Workspace on the Host; per-Workspace policy would need a richer request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The service key and the wire namespace are both `workspaceEditor`, so a Client reads `ctx.remote.workspaceEditor`. The package ships a Host face only: `api-remotes` mounts the generated `/remote` contribution, and the browser surface that consumes it registers its own panel.

</details>

**Runtime invariant:** No companion is published. What this package could diverge on — that a write only lands at the version the caller read, and that no path leaves the Workspace — is asserted by its own suite against a real filesystem and by a real Loader composition, and no independent observer can diverge from either.
