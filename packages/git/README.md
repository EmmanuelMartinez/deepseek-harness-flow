---
description: "The git group map: the shared command runner every git consumer spawns through, for users and maintainers navigating the group."
kind: "package-group"
---

# git/ — git execution family

English | [中文](README.zh.md)

## Summary

Git is read by capability-specific consumers rather than one git service: the turn change recorder snapshots a working tree, and the Web client's Source control panel reads a repository's history, status, and refs. This group owns the one thing those consumers must share — how a git command is spawned. Every command runs through `ctx.subprocess` with git's non-interactive environment, a caller-owned deadline, and bounded output. What a command means, which commands run, and how a result is presented stay with the consumer that asked for it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`git-command`](git-command/README.md) | Resolves the git executable and runs one git command with git's non-interactive environment, a caller-owned deadline, and bounded output | library — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Subprocess subsystem](../../docs/subsystems/subprocess.md) — the process seam every command spawns through, its scrubbed parent environment, and its termination ladder.
- [Workspace changes](../deliverables/workspace-changes/README.md) — the turn recorder that snapshots a working tree through this runner.
- [Git Controller](../api/git-controller/README.md) — the Remote namespace that reads a repository for the Web client through this runner.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Both consumers previously carried their own copy of the spawn spec, the non-interactive environment, and the macOS developer-tools probe; the duplication gate rejected the second copy. The runner holds no module state, so duplicate installations are safe ([dependency policy](../../scripts/package-dependency-policy.ts)).

</details>
