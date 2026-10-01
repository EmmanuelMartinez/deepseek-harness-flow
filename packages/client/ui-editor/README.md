---
description: "The Web client's Editor panel: a global document surface with tabs, explicit or automatic saving, and version-checked writes, so a person reviews and edits files inside the Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-editor

English | [中文](README.zh.md)

## Summary

The Web client's document surface: a sidebar entry with a panel of open documents, each an editable buffer over one Workspace file. Saving is explicit — ⌘S or the Save control — and the Autosave switch makes a save follow a pause in typing instead. Every save sends the version the buffer was read from, so a file the Agent or another window changed in the meantime is reported as a conflict with the reload that reads it again, rather than overwritten.

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

Mount the package in a Client composition that carries the sidebar, the frame's `rightrail` seat, the layout's `main` keyed slot, and the `workspaceEditor` Remote namespace; the Web bundle mounts it after `ui-git`. The sidebar's **Editor** entry and the panel share one id, so selecting the entry opens the panel and the sidebar draws its own selected state. A second registration puts the same tool on the frame's right rail, which owns that button and its toggle: one press opens the panel, and a press on the active entry closes it again.

| Region | Shows |
|---|---|
| Tabs | One tab per open document, with its name, a dot while the buffer differs from the file, and its close control. |
| Status bar | The Workspace-relative path, the saved or unsaved state, the Edit/Diff switch, the Autosave switch, Reload, and Save. |
| Banner | A conflict — the file changed under the buffer — or the failure that stopped a read or a write, each with what to do about it. |
| Body | The document's complete text, editable, with Tab inserting two spaces; or its comparison against the repository, with added lines in green and deleted lines in red. |

The comparison needs no extra package: the panel asks the `git` namespace when the composition mounts it, and offers the Diff switch only then. A file changed in the working tree shows that change; one whose change is already staged shows the index against HEAD; a file the repository holds no change for says so instead of showing an empty view.

### Opening a document from another plugin

The panel publishes `editorNavigation` for the plugins that hand it a file, so a caller does not import this package's values:

```ts
const editor = ctx.get('editorNavigation')
if (editor?.open('/home/me/project/packages/app/src/main.ts') !== true) {
  // No Workspace contains that path: open it another way.
}
```

`open` resolves the Workspace that contains the absolute path, selects the Editor panel, and opens the document, revealing it when it is already open. It returns `false` when no Workspace contains the path, which is what leaves the Source control panel and the file tree to their read-only preview.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/model.ts` is the React-free state: the open documents, the active one, and whether autosave is on. Each document keeps the text it was read at (`saved`), the buffer (`text`), and the version that text came from; `dirty` is exactly `text !== saved`, so it is derived rather than tracked. The model owns one request generation per document, so a reload that loses a race cannot publish over a newer buffer, and disposing it invalidates every pending save.

The panel renders a `<textarea>` rather than a code editor: the buffer is the document, the caret is the browser's, and the panel keeps the value controlled so a save always writes what the user sees. Tab inserts two spaces through the same value setter and restores the caret after the render.

The comparison is a read of the `git` namespace, not a second remote: `loadDiff` resolves the repository behind the Workspace, maps the document's absolute path to a repository-relative one, reads the file's status entry, and asks for the side that holds the change — the working tree when the file differs there, the index when the change is already staged. The result is a discriminated value (`ready`, `unchanged`, `unavailable`), so the panel renders a reason instead of an empty view, and a successful save drops the comparison because the file moved.

A conflict keeps the user's buffer and offers Reload, which rereads the file and replaces the buffer. There is no merge: two text versions are the user's to reconcile, and the honest default is to show both the fact and the escape hatch rather than to pick one.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [workspace-editor](../../api/workspace-editor/README.md) — the Host namespace this panel reads and writes through.
- [ui-sidebar](../ui-sidebar/README.md) — the shell that owns the entry's button, label, and selected state.
- [ui-layout](../ui-layout/README.md) — the `main` keyed slot the page occupies.
- [ui-git](../ui-git/README.md) — the panel that opens a changed file here.

## Model Experience

None, as this package renders a browser panel and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; a person's edit reaches the filesystem, not a model request.

## Known Limitations and Deferred Work

- **A plain text buffer.** There is no syntax highlighting, completion, or multi-cursor; Tab indents by two spaces and nothing reformats. The shared highlighter exists for a later revision.
- **No merge on conflict.** Reload discards the local buffer; reconciling two versions is the user's work.
- **Closing a tab drops unsaved text** without a prompt.
- **The panel edits inside the Workspace only.** A file outside it opens in the read-only preview, because the Host namespace is workspace-confined.
- **The comparison replaces the buffer.** It is a unified view with line numbers, not a side-by-side editor, and the changed lines cannot be edited from it; the Edit switch returns to the buffer.
- **One comparison at a time.** A file with both staged and unstaged changes shows the side that holds a working-tree change, so the staged part is not shown beside it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The panel id and the dictionary namespace are both `editor`; the Host service key is `workspaceEditor`. The panel is a `main` entry rather than a right-column tab, because the right column belongs to the Session on screen and a global panel must work without one.

</details>

**Runtime invariant:** No companion is published. What this package could diverge on — that both registrations share one id and leave together, and that `editorNavigation` selects the panel and opens what it is handed — is asserted by its own client spec, and no independent observer exists for a browser-side slot contribution.
