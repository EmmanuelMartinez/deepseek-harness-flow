---
description: "以 git 的非交互环境、调用方拥有的截止时间与有界输出，通过 `ctx.subprocess` 运行一条 git 命令，并解析两个 git 消费者共用的可执行文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-command

[English](README.md) | 中文

## 概述

凡是 Harness 运行 git 的地方都使用本包。它解析 git 可执行文件——把 macOS 开发者工具桩程序视为不存在——并以从不经 shell 解释的 `argv`、与调用方信号合并的每条命令截止时间、有界 stdout 与诊断用 stderr 尾部，以及 git 的非交互环境运行一条命令。非零退出作为数据返回，由调用方分类；只有截止时间、取消或启动失败会抛出。它不注册服务，也不持有模块级状态。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
const resolved = await resolveGitExecutable(ctx.subprocess, lifetime.signal)
if ('reason' in resolved) return
const git = new GitRunner(ctx.subprocess, resolved.executable, { timeoutMs, outputMaxBytes })
const result = await git.run(['rev-parse', '--show-toplevel'], { cwd, signal })
if (result.exitCode !== 0) { /* the caller classifies stderr */ }
```

| 出口 | 契约 |
|---|---|
| `resolveGitExecutable(subprocess, signal)` | 解析可执行文件，或返回 `{ reason: 'missing' \| 'developer-tools' }`。除「找不到可执行文件」之外的查找失败会被重新抛出。 |
| `GitRunner` | 运行一条命令：`run(args, options)` 以 `{ exitCode, stdout, stderr, truncated }` 结束。 |
| `GitLimits` | 每条命令的 `timeoutMs` 与 stdout 的 `outputMaxBytes`。 |
| `GitRunOptions` | `cwd`、`signal`、可选的每条命令 `maxBytes`、叠加在 git 自身环境之上的额外 `env`，以及可选的 `stdin` 文本。 |
| `parseNumstat(output)` | 按 git 的顺序读取以 NUL 结尾的 `--numstat` 记录，重命名记录的旧路径作为 `oldPath` 返回。畸形记录（stdout 被截断时即会产生）会抛出。 |
| `NumstatEntry` | 一条记录：`path`、可选的 `oldPath`、`added`、`deleted` 与 `binary`。 |

两个消费者都把这次读取与一次 `--raw` 读取连接起来，因为 `--numstat` 记录不含变更类型。

每条命令收到的环境是固定的、不可配置的，因为其中每一项都是契约而非偏好：`GIT_CONFIG_COUNT=0` 让环境中带索引的配置失效（子进程凭据清理已移除 `GIT_CONFIG_KEY_n`，其名称匹配 `KEY`），`GIT_TERMINAL_PROMPT=0` 让子进程不会等待无人可答的提示，`GIT_OPTIONAL_LOCKS=0` 阻止 git 在用户背后刷新索引，`LC_ALL=C` 提供消费者据以判定「不是仓库」的稳定措辞。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

`run` 用 `AbortSignal.timeout` 计算截止时间，并通过 `AbortSignal.any` 与调用方信号合并，然后启动进程并等待 `handle.done`。进程结果不携带原因，因此本包自行分类：结果落地后，合并信号已中止即表示是截止时间或调用方结束了它。

collect 模式的 stdio 总会给出两个读取器，因此对它们的可选链不可达，并为此带有 `v8 ignore`。stdout 由 `outputMaxBytes`（或本次调用的 `maxBytes`）限制，stderr 由固定的 16 KiB 尾部限制；收集保留流的尾部，并通过 `truncated` 报告丢失。

可执行文件按调用方生命周期解析一次。macOS 上的 `/usr/bin/git` 是会弹出安装器对话框而不运行的开发者工具桩程序，因此用 `/usr/bin/xcode-select -p` 探测，探测失败期间它视为不存在。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Subprocess](../../subprocess/subprocess/README.zh.md) — 本运行器启动进程所经过的接缝。
- [workspace-changes](../../deliverables/workspace-changes/README.zh.md) — 轮次记录器，两个消费者之一。
- [git-controller](../../api/git-controller/README.zh.md) — Web 客户端仓库面板背后的 Remote 命名空间，另一个消费者。

<a id="model-experience"></a>
## 模型体验

None, as this package executes git commands for its consumers and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; running a git command does not alter model requests already in flight.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **一次一条命令，没有进度上报。** 遍历大段历史的调用方每页发一条命令；在命令结束之前本包不上报任何内容。
- **没有每条命令的终止阶梯。** `run` 只等待被启动命令的结果，受管范围的静默归 subprocess 服务自身的释放负责，因此比父进程活得更久的 git 进程是该服务的责任，而不是本运行器的。
- **被截断的 stdout 只被报告，不被恢复。** 命令输出可能超过上限的调用方会收到 `truncated: true`，并须自行判断部分输出是否可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

本包的存在是因为两个能力已经在运行 git，否则会各自带着同一份 spawn 规格、环境与开发者工具探测。它不持有模块级状态，因此在依赖策略中列入可安全重复的包，而不是需要共享实例的导出。

</details>

**Runtime invariant:** 不发布伴随文件。本包可能与之分歧的内容——命令在配置的截止时间、上限与环境之下运行——由它针对脚本化子进程的测试以及两个消费者针对真实 git 的测试断言。
