---
description: "Runs one git command through `ctx.subprocess` with git's non-interactive environment, a caller-owned deadline, and bounded output, and resolves the executable both git consumers use."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-command

English | [中文](README.zh.md)

## Summary

Use this package wherever the harness runs git. It resolves the git executable — counting the macOS developer-tools stub as absent — and runs one command with `argv` never shell-interpreted, a per-command deadline combined with the caller's signal, a bounded stdout with a diagnostic stderr tail, and git's non-interactive environment. A nonzero exit is returned as data for the caller to classify; only a deadline, a cancellation, or a spawn failure raises. It registers no service and holds no module state.

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

```ts
const resolved = await resolveGitExecutable(ctx.subprocess, lifetime.signal)
if ('reason' in resolved) return
const git = new GitRunner(ctx.subprocess, resolved.executable, { timeoutMs, outputMaxBytes })
const result = await git.run(['rev-parse', '--show-toplevel'], { cwd, signal })
if (result.exitCode !== 0) { /* the caller classifies stderr */ }
```

| Export | Contract |
|---|---|
| `resolveGitExecutable(subprocess, signal)` | Resolves the executable, or returns `{ reason: 'missing' \| 'developer-tools' }`. A lookup failure other than a missing executable is rethrown. |
| `GitRunner` | Runs one command: `run(args, options)` settles with `{ exitCode, stdout, stderr, truncated }`. |
| `GitLimits` | `timeoutMs` per command and `outputMaxBytes` for stdout. |
| `GitRunOptions` | `cwd`, `signal`, an optional per-command `maxBytes`, extra `env` entries layered over git's own, and optional `stdin` text. |
| `parseNumstat(output)` | Reads NUL-terminated `--numstat` records in git's order, with a rename's previous path as `oldPath`. A malformed record, which a stdout cut short produces, throws. |
| `NumstatEntry` | One record: `path`, an optional `oldPath`, `added`, `deleted`, and `binary`. |

Both consumers join that read to a `--raw` read, because a `--numstat` record carries no change kind.

The environment every command receives is fixed and not configurable, because each entry is a contract rather than a preference: `GIT_CONFIG_COUNT=0` makes ambient indexed configuration inert (the subprocess credential scrub already removes `GIT_CONFIG_KEY_n`, whose name matches `KEY`), `GIT_TERMINAL_PROMPT=0` keeps a child from waiting on a prompt nobody can answer, `GIT_OPTIONAL_LOCKS=0` stops git refreshing an index under the user, and `LC_ALL=C` gives the stable wording consumers classify "not a repository" by.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`run` computes its deadline with `AbortSignal.timeout` and combines it with the caller's signal through `AbortSignal.any`, spawns, and awaits `handle.done`. The process outcome carries no cause, so this package classifies one itself: once the outcome settles, an aborted combined signal means the deadline or the caller ended it.

Collect-mode stdio always yields both readers, so the optional chain on them is unreachable and carries a `v8 ignore` for that reason. stdout is capped by `outputMaxBytes` (or the call's `maxBytes`) and stderr by a fixed 16 KiB tail; the collection keeps a stream's tail and reports the loss through `truncated`.

The executable is resolved once per caller lifetime. On macOS `/usr/bin/git` is the developer-tools stub that opens an installer dialog instead of running, so it is probed with `/usr/bin/xcode-select -p` and counts as absent while that probe fails.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Subprocess](../../subprocess/subprocess/README.md) — the seam this runner spawns through.
- [workspace-changes](../../deliverables/workspace-changes/README.md) — the turn recorder, one of the two consumers.
- [git-controller](../../api/git-controller/README.md) — the Remote namespace behind the Web client's repository panel, the other consumer.

## Model Experience

None, as this package executes git commands for its consumers and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; running a git command does not alter model requests already in flight.

## Known Limitations and Deferred Work

- **One command at a time, no progress reporting.** A caller that walks a large history issues one command per page; this package reports nothing until a command settles.
- **No per-command termination ladder.** `run` awaits the spawned command's outcome and leaves managed-range quiescence to the subprocess service's own disposal, so a git process that outlives its parent is that service's responsibility, not this runner's.
- **A cut stdout is reported, not recovered.** A caller whose command can exceed its cap receives `truncated: true` and must decide whether the partial output is usable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package exists because two capabilities already ran git and would otherwise carry the same spawn spec, environment, and developer-tools probe. It holds no module state, so it is listed in the dependency policy's duplicate-safe packages threshold rather than the peer-required exports.

</details>

**Runtime invariant:** No companion is published. What this package could diverge on — that a command ran under the configured deadline, caps, and environment — is asserted by its own suite against a scripted subprocess and by both consumers' suites against real git.
