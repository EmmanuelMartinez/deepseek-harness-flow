---
description: "Git surface for the dsh web client: the sidebar's Source control entry and the repository page it opens over the `git` Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git

English | [中文](README.zh.md)

## Summary

The web client's Source control surface: a sidebar entry with the repository page it selects. The page shows one Workspace's repository — its branch and upstream divergence, the changed files with their staged and unstaged sides, the history graph with refs, and one selected commit's message and changed files. It reads through the `git` Remote namespace, picks the first Workspace until the user chooses another, and never mutates the repository.

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

Mount the package in a Client composition that carries the sidebar, the frame's `rightrail` seat, the layout's `main` keyed slot, and the `git` Remote namespace; the Web bundle mounts it after `ui-goal`. The sidebar's **Source control** entry and the page share one id (`git`), so selecting the entry opens the page and the sidebar draws the entry's own selected state. A second registration puts the same tool on the frame's right rail, which owns that button and its toggle: one press opens the page, and a press on the active entry closes it again. That entry's glyph carries the changed-file count, published into a source the plugin owns so it survives the page being closed; it seeds from one status read when the composition has exactly one Workspace, and the page keeps it current from every status it settles.

| Region | Shows |
|---|---|
| Head | Repository name, the checked-out branch (or `detached`), the upstream divergence as `+ahead -behind`, the Workspace picker, and Refresh. |
| Changes | One row per changed path with git's two status letters — the index side first — and the untracked marker. |
| History | The history page in `--date-order` with one graph lane per branch line, the subject, the commit id, the author, the date, and the refs that point at the commit. Selecting a row reads that commit. |
| Commit | The selected commit's message body, author, parents, refs, and changed files with their line counts. |

Every read is per Workspace, and the panel shows one at a time. Selecting a Workspace in the header replaces the whole panel; Refresh re-reads the current one and keeps the selected commit. The panel is live: it follows that Workspace's `git.watch` stream, so a commit, a checkout or an index write made anywhere re-reads the graph and the working tree without a manual Refresh. Events coalesce over a short quiet period, because one commit writes many files. The changed-file badge on the frame's rail follows the same stream while the panel is open, and reads on its own when the panel is closed.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/model.ts` is the React-free state: one observable snapshot plus `selectWorkspace`, `selectCommit`, `refresh`, and `dispose`. It owns a request generation, so a Workspace switch discards a slower earlier answer instead of publishing it. Its `git` namespace type comes from the `api-remotes` facade; it never imports the Gateway.

`src/client/lanes.ts` assigns graph lanes from the page's commits alone. A lane holds the commit id it waits for; a commit takes the lane already waiting for it or a free one, merges away lanes that waited for the same commit, and leaves its first parent in its own lane while later parents take further lanes.

`src/client/index.ts` registers two contributions in one fiber: the `main` keyed entry under the panel id with its injected face, and the `sidebar.panellist` icon under the same id. The face carries the state model and the Workspace list through the registrant-private `hooks` compartment, which the renderer binds to `useGitPanel` and `useGitWorkspaces`. The model lives exactly as long as the `main` registration, so nothing survives an unload.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [git-controller](../../api/git-controller/README.md) — the Host Remote namespace this page reads.
- [ui-sidebar](../ui-sidebar/README.md) — the shell that owns the entry's button, label, and selected state.
- [ui-layout](../ui-layout/README.md) — the `main` keyed slot the page occupies.
- [ui-primitives](../ui-primitives/README.md) — the branch glyph the entry draws.

## Model Experience

None, as this package renders a browser panel and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading repository state does not alter model requests already in flight.

## Known Limitations and Deferred Work

- **Read-only.** No staging, committing, branching, checking out, or network operation is offered; those arrive with the Host methods they need.
- **The panel is Workspace-scoped, not Session-scoped.** A `main` entry other than `conversation` receives no Session binding, so the page picks a Workspace rather than reading the current Session's.
- **One page of history, no filtering.** The page asks for one page and reports that older commits exist; it has no search, path filter, or infinite scroll.
- **The graph is a display approximation.** Lanes merge and continue from the page's parents alone, so a page cut mid-history draws the cut as continuing lanes.
- **No diff viewer yet.** The commit's file list reports line counts; opening one file's comparison needs the file and diff surfaces.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The panel id and the dictionary namespace are both `git`; the Host service key is `gitController` with wire namespace `git`. The Workspace rows arrive as a second registrant-private source rather than the slot's standard `useWorkspaces` seat, which the `main` slot's typed props do not carry.

</details>

**Runtime invariant:** No companion is published. What this package could diverge on — the two registrations sharing one id and their disposal — is asserted by its own client spec, and no independent observer exists for a browser-side slot contribution.
