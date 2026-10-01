---
description: "面向 Web GUI 的只读 git 仓库状态，经 `git` Remote 命名空间提供：已注册 Workspace 背后的历史图、工作树状态、引用与文件对比。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-git-controller

[English](README.md) | 中文

## 概述

用本包在 Web 客户端展示某个工作区的 git 仓库。它定位包含已注册 Workspace 的工作树，报告 HEAD 及其上游分叉，列出分支、远程跟踪引用与标签，分页返回历史并为每个提交附上父提交与指向它的引用，读取单个提交的消息与改动文件，并可在工作树、索引或某个提交之间对比单个文件。它接受的每条路径都相对仓库根目录，唯一读取的目录来自 Workspace 注册。本服务不做任何修改。

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

把本包与 `dsh-subprocess` 和 Workspace 注册表挂载在一起；Web 组合包把它紧接在 `workspace-files` 之后挂载。每个方法在线上只给出 `WorkspaceId`，因此客户端调用 `remote.git.repository(workspaceId, signal)`、`status(workspaceId, signal)`、`refs(workspaceId, signal)`、`log(workspaceId, request, signal)`、`commit(workspaceId, oid, signal)` 或 `diff(workspaceId, request, signal)`，从不给出目录。

| 方法 | 返回 | 用途 |
|---|---|---|
| `repository` | `GitRepositoryResult` | 包含该 Workspace 的工作树，或 `not-a-repository`；报告根目录、显示名、HEAD，以及当前分支相对上游的分叉。 |
| `status` | `GitStatusView` | 每条改动路径，分别报告其已暂存与未暂存的一侧，包含未跟踪路径。 |
| `refs` | `GitRefsView` | 分支、远程跟踪引用与标签，各自带上剥离后解析到的提交。 |
| `log` | `GitLogPage` | `--date-order` 下的一页历史，每个提交携带其父提交与指向它的引用短名。 |
| `commit` | `GitCommitDetailView` | 单个提交的消息正文与改动文件，各自带上类型、行数与二进制标记。 |
| `diff` | `GitFileDiffView` | 单个文件在工作树与索引、索引与 HEAD，或某个提交与其父提交之间的对比。 |

### 请求与其边界

`log` 接受 `rev`（默认 `HEAD`）、`skip`、`limit`，以及可选的仓库相对 `path`；它最多返回配置的页大小，并在遍历仍继续时报告 `more`。`commit` 接受一个提交 id，并在文件上限丢弃条目时报告 `filesTruncated`。`diff` 接受一条路径、可选的改名前的 `from` 路径，以及要对比的两种状态。绝对路径、带 `..` 段的路径或含 NUL 字节的路径会被拒绝；可能被当成选项解读的修订会被拒绝；提交 id 必须是十六进制。

| Config | 默认值 | 用途 |
|---|---|---|
| `timeoutMs` | `30000` | 单条 git 命令在被截止时间中止前可运行的毫秒数。 |
| `outputMaxBytes` | `8388608` | 单条命令标准输出保留的字节数；更大的流会被报告为被截断。 |
| `maxRefs` | `2000` | 一次读取保留的引用数。 |
| `maxStatusEntries` | `5000` | 一次状态响应保留的改动路径数。 |
| `maxLogPage` | `200` | 请求未给出上限时一页历史返回的提交数。 |
| `maxCommitFiles` | `1000` | 单个提交详情保留的文件数。 |

每个字段都必须是正的安全整数；否则插件在加载时抛错，且 `log` 会拒绝高于 `maxLogPage` 的 `limit`，而不是悄悄缩短它。

### 失败

Gateway 返回以下错误码；客户端把每一个渲染为各自的状态。

| 错误码 | 细节 | 含义 |
|---|---|---|
| `git/unavailable` | `reason: 'missing' \| 'developer-tools'` | 没有可用的 git 可执行文件：要么没解析到，要么 macOS 只提供 `/usr/bin/git` 开发者工具桩程序。 |
| `git/not-a-repository` | `workspaceId` | 该 Workspace 的目录不在任何 git 工作树内。 |
| `git/unknown-revision` | `revision` | 请求的修订或提交 id 不存在。 |
| `git/bad-request` | `reason: 'path-outside-repository' \| 'option-like-revision'` | 本服务在运行 git 之前就拒绝的路径或修订。 |
| `git/command-failed` | `command` | 某条 git 命令以非零退出，原因本服务不再细分。 |
| `workspace/not-found` | `workspaceId` | 没有 Workspace 注册携带该标识。 |

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

单一命令运行器（`src/git.ts`）通过 `ctx.subprocess` 启动进程，`argv` 从不经 shell 解释，每条命令用 `AbortSignal.timeout` 与调用方信号合并，stderr 只保留 16 KiB 尾部，并设置 git 的非交互环境：`GIT_CONFIG_COUNT=0` 让环境里带索引的配置失效，`GIT_TERMINAL_PROMPT=0` 让子进程不会等待无人可答的凭据提示，`GIT_OPTIONAL_LOCKS=0` 阻止 git 在用户背后刷新索引，`LC_ALL=C` 是「不是仓库」判定的依据。非零退出是数据，由服务分类。`src/porcelain.ts` 为每条命令保存一个纯解析器，因此解析无需 git 即可测试，而进程处理归控制器所有。

Workspace 注册是唯一的路径权威：请求给出 `WorkspaceId`，`ctx.workspaceRegistry.get` 解析出它的规范目录，`git rev-parse --show-toplevel` 定位所在的仓库。随后路径都相对该根目录传输。

历史装饰来自 `refs` 所服务的同一次 `for-each-ref` 读取，在 Host 上按提交 id 连接，而不是来自 git 的 `--decorate` 文本。因此引用数超过 `maxRefs` 的仓库只会装饰那次读取返回的引用。提交的文件类型来自 `diff-tree --raw`，行数来自 `diff-tree --numstat`，按路径连接，因为两种形式都不单独报告全部信息。

一个插件生命周期的 `AbortController` 在释放时取消每条命令；可执行文件每个生命周期解析一次并使用该信号，因自身原因失败的解析不会被缓存。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Subprocess](../../subprocess/subprocess/README.zh.md) — 每条 git 命令经过的接缝。
- [Workspace 实体](../../workspace/workspace/README.zh.md) — 本服务据此解析目录的注册。
- [API Gateway](../../../docs/api-gateway.zh.md) — `@Remote` 方法如何成为 `ctx.remote.git`。
- [workspace-changes](../../deliverables/workspace-changes/README.zh.md) — 本仓库中另一个 git 消费者，它快照一轮而非描述一个仓库。

<a id="model-experience"></a>
## 模型体验

None, as this package serves the web client's repository panel and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading repository state does not alter model requests already in flight.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **只读。** 这里不做暂存、提交、分支、检出，也不联网；需要这些操作的面板要求新增方法并审查其权限。
- **合并提交的文件列表是与第一父提交的比较。** `diff-tree --numstat` 对合并提交不报告任何内容，因此 `commit` 对它不列出文件；图仍显示它及其父提交。
- **提交对比针对第一父提交。** `side: 'commit'` 的 `diff` 使用 `git show`，它对合并提交不打印补丁。
- **装饰与对比可能不完整。** `maxRefs` 限制装饰读取，`outputMaxBytes` 限制单条命令的标准输出；此时 `diff` 报告 `truncated`，`filesTruncated` 报告文件上限。
- **未跟踪文件没有对比。** `diff` 报告 `untracked: true` 且不带 hunk，而不是读取文件内容。
- **没有进行中的操作状态。** 进行中的合并、rebase、cherry-pick 或 bisect 不会被报告；面板还无法在会与之冲突的操作前给出警告。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

服务键是 `gitController`，线上命名空间是 `git`，因此客户端读取 `ctx.remote.git`。本包只提供 Host 面：`api-remotes` 挂载生成的 `/remote` 贡献，消费它的面板位于 `@deepseek-ai/dsh-client-ui-git`。

</details>

**Runtime invariant:** 不发布伴随文件。此处可观察的关系——命令在配置的截止时间与上限下运行，以及路径来自 Workspace 注册——已由本包针对真实 git 的测试断言，且没有独立观察者能与之分歧。
