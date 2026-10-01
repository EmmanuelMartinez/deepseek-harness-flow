---
description: "git 组的导航图：每个 git 消费者共同使用的命令运行器，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# git/ — git 执行家族

[English](README.md) | 中文

## Summary

Harness 中的 git 由各能力自己的消费者读取，而不是由一个 git 服务统一提供：轮次改动记录器对工作树做快照，Web 客户端的版本控制面板读取仓库的历史、状态与引用。本组只拥有这些消费者必须共享的一件事——一条 git 命令如何被启动。每条命令都通过 `ctx.subprocess` 运行，带 git 的非交互环境、调用方拥有的截止时间与有界输出。命令的含义、运行哪些命令、结果如何呈现，都属于提出请求的那个消费者。

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`git-command`](git-command/README.zh.md) | 解析 git 可执行文件，并以 git 的非交互环境、调用方拥有的截止时间与有界输出运行一条 git 命令 | library — 无 ctx 键 |

-----

<a id="related-documentation"></a>
## Related documentation

- [Subprocess 子系统](../../docs/subsystems/subprocess.zh.md) — 每条命令经过的进程接缝、其净化后的父环境，以及终止阶梯。
- [Workspace changes](../deliverables/workspace-changes/README.zh.md) — 通过本运行器对工作树做快照的轮次记录器。
- [Git Controller](../api/git-controller/README.zh.md) — 通过本运行器为 Web 客户端读取仓库的 Remote 命名空间。

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

两个消费者此前各自带有一份 spawn 规格、非交互环境与 macOS 开发者工具探测的副本；重复度门禁拒绝了第二份。运行器不持有模块级状态，因此重复安装是安全的（[依赖策略](../../scripts/package-dependency-policy.ts)）。

</details>
