---
description: "Read-only git repository state for the web GUI over the `git` Remote namespace: history graph, working-tree status, refs, and file comparisons behind a registered Workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-git-controller

English | [中文](README.zh.md)

## Summary

Use this package to show a workspace's git repository in the web client. It locates the working tree that contains a registered Workspace, reports HEAD and its upstream divergence, lists branches, remote-tracking refs, and tags, pages the history with each commit's parents and pointing refs, reads one commit's message and changed files, and compares one file across the working tree, the index, or a commit. Every path it accepts is relative to the repository root, and the Workspace registration is the only directory it reads. The service mutates nothing.

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

Mount the package beside `dsh-subprocess` and the Workspace registry; the Web bundle mounts it right after `workspace-files`. Every method names a `WorkspaceId` on the wire, so a Client calls `remote.git.repository(workspaceId, signal)`, `status(workspaceId, signal)`, `refs(workspaceId, signal)`, `log(workspaceId, request, signal)`, `commit(workspaceId, oid, signal)`, or `diff(workspaceId, request, signal)` and never names a directory.

| Method | Returns | Purpose |
|---|---|---|
| `repository` | `GitRepositoryResult` | The working tree containing the Workspace, or `not-a-repository`; reports the root, display name, HEAD, and the checked-out branch's upstream divergence. |
| `status` | `GitStatusView` | Every changed path with its staged and unstaged sides reported independently, including untracked paths. |
| `refs` | `GitRefsView` | Branches, remote-tracking refs, and tags, each with the commit it resolves to after peeling. |
| `log` | `GitLogPage` | One page of history in `--date-order`, each commit carrying its parents and the short names of the refs that point at it. |
| `commit` | `GitCommitDetailView` | One commit's message body and changed files, each with its kind, line counts, and binary flag. |
| `diff` | `GitFileDiffView` | One file compared between the working tree and the index, the index and HEAD, or a commit and its parent. |

### Requests and their bounds

`log` takes `rev` (default `HEAD`), `skip`, `limit`, and an optional repository-relative `path`; it returns at most the configured page size and reports `more` when the walk continued. `commit` takes a commit id and reports `filesTruncated` when the file cap dropped entries. `diff` takes a path, an optional pre-rename `from` path, and which two states to compare. A path that is absolute, carries a `..` segment, or contains a NUL byte is refused; a revision that could be read as an option is refused; a commit id must be hexadecimal.

| Config | Default | Purpose |
|---|---|---|
| `timeoutMs` | `30000` | Milliseconds one git command may run before its deadline aborts it. |
| `outputMaxBytes` | `8388608` | Bytes of one command's stdout retained; a larger stream is reported cut. |
| `maxRefs` | `2000` | Refs one read keeps. |
| `maxStatusEntries` | `5000` | Changed paths one status response keeps. |
| `maxLogPage` | `200` | Commits one history page returns when the request names no limit. |
| `maxCommitFiles` | `1000` | Files one commit detail keeps. |

Every field must be a positive safe integer; the plugin throws at load otherwise, and `log` refuses a requested `limit` above `maxLogPage` rather than silently shortening it.

### Failures

The Gateway returns these codes; a Client renders each as its own state.

| Code | Details | Meaning |
|---|---|---|
| `git/unavailable` | `reason: 'missing' \| 'developer-tools'` | No usable git executable: none resolved, or macOS offers only the `/usr/bin/git` developer-tools stub. |
| `git/not-a-repository` | `workspaceId` | The Workspace's directory is inside no git working tree. |
| `git/unknown-revision` | `revision` | The requested revision or commit id does not exist. |
| `git/bad-request` | `reason: 'path-outside-repository' \| 'option-like-revision'` | A path or revision this service refuses before running git. |
| `git/command-failed` | `command` | A git command exited nonzero for a reason this service does not classify further. |
| `workspace/not-found` | `workspaceId` | No Workspace registration carries that identity. |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One command runner (`src/git.ts`) spawns through `ctx.subprocess` with `argv` never shell-interpreted, a per-command `AbortSignal.timeout` combined with the caller's signal, a 16 KiB stderr tail, and git's non-interactive environment: `GIT_CONFIG_COUNT=0` makes ambient indexed configuration inert, `GIT_TERMINAL_PROMPT=0` keeps a child from waiting on a credential prompt, `GIT_OPTIONAL_LOCKS=0` stops git refreshing the index under the user, and `LC_ALL=C` is what the "not a repository" classification reads. A nonzero exit is data; the service classifies it. `src/porcelain.ts` holds one pure parser per command, so the parsing is testable without git and the controller owns process handling.

The Workspace registration is the only path authority: a request names a `WorkspaceId`, `ctx.workspaceRegistry.get` resolves its canonical directory, and `git rev-parse --show-toplevel` locates the containing repository. Resulting paths travel relative to that root.

History decorations come from the same `for-each-ref` read `refs` serves, joined by commit id on the Host, rather than from git's `--decorate` text. A repository whose refs exceed `maxRefs` therefore decorates only the refs that read returned. Commit file kinds come from `diff-tree --raw`, line counts from `diff-tree --numstat`, joined by path, because neither form reports both.

One plugin-lifetime `AbortController` cancels every command on disposal; the executable is resolved once per lifetime with that signal, and a resolution that fails for its own reasons is not cached.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Subprocess](../../subprocess/subprocess/README.md) — the seam every git command runs through.
- [Workspace entity](../../workspace/workspace/README.md) — the registration this service resolves a directory from.
- [API Gateway](../../../docs/api-gateway.md) — how `@Remote` methods become `ctx.remote.git`.
- [workspace-changes](../../deliverables/workspace-changes/README.md) — the other git consumer in this repository, which snapshots a turn rather than describing a repository.

## Model Experience

None, as this package serves the web client's repository panel and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading repository state does not alter model requests already in flight.

## Known Limitations and Deferred Work

- **Read-only.** Nothing here stages, commits, branches, checks out, or touches the network; the panel that needs those operations requires new methods and their authority review.
- **A merge commit's file list is its first-parent comparison.** `diff-tree --numstat` reports nothing for a merge, so `commit` lists no files for one; the graph still shows it and its parents.
- **A commit comparison is against the first parent.** `diff` for `side: 'commit'` uses `git show`, which prints no patch for a merge.
- **Decorations and comparisons can be incomplete.** `maxRefs` bounds the decoration read, and `outputMaxBytes` bounds one command's stdout, in which case `diff` reports `truncated` and `filesTruncated` reports the file cap.
- **An untracked file has no comparison.** `diff` reports `untracked: true` with no hunks rather than reading the file's content.
- **No operation-in-progress state.** A merge, rebase, cherry-pick, or bisect in progress is not reported; the panel cannot yet warn before an action that would conflict with one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The service key is `gitController` and the wire namespace is `git`, so a Client reads `ctx.remote.git`. The package ships a Host face only: `api-remotes` mounts the generated `/remote` contribution, and the panel that consumes it lives in `@deepseek-ai/dsh-client-ui-git`.

</details>

**Runtime invariant:** No companion is published. The observable relationships here — that a command ran under the configured deadline and cap, and that a path came from a Workspace registration — are already asserted by the package's own suite against real git, and no independent observer can diverge from them.
