---
description: "经 `workspaceEditor` Remote 命名空间提供的工作区文档编辑器：读取、stat，以及限定在已注册 Workspace 内的带版本校验写入，让人在 Harness 里而不是别的应用里审阅并编辑文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-editor

[English](README.md) | 中文

## Summary

当编辑文件的是人而不是模型时使用本包。它读取一个 Workspace 文档并同时给出保存时必须回传的版本令牌，按需再次报告该身份，并且只在文件仍持有调用方读到的版本时才写入完整文本。路径相对已注册的 Workspace，越界即拒绝。`writeMode` 选择写入所用的沙箱策略，默认取用户自身的权限，因为本服务已经把目标限定在它点名的 Workspace 内。

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

把本包与 `dsh-fs`、`dsh-sandbox-policy` 和 Workspace 注册表挂载在一起；Web 组合包把它紧接在 Git Controller 之后挂载。每个方法都给出 `WorkspaceId` 与 Workspace 相对路径，因此客户端调用 `remote.workspaceEditor.read(workspaceId, path, signal)`、`stat(workspaceId, path, signal)` 或 `write(workspaceId, path, text, expected, signal)`，从不给出目录。

| 方法 | 返回 | 用途 |
|---|---|---|
| `read` | `WorkspaceDocumentView` | 文档的完整文本、绝对路径、字节大小，以及保存时必须回传的版本。 |
| `stat` | `WorkspaceDocumentStatView` | 同样的身份但不含文本，用于保存前的新鲜度检查。 |
| `write` | `WorkspaceDocumentStatView` | 在调用方的期望之下替换文档并报告新版本；调用方要求创建时创建它。 |

期望值是让编辑可以安全提供的关键：

| 期望 | 含义 |
|---|---|
| `{ kind: 'replaceIfVersion', version }` | 仅在文件仍持有该版本时写入。被底下改动过的文件——被 Agent、被另一个标签页、被构建——会被拒绝，且失败会携带它当前持有的版本。 |
| `{ kind: 'createIfAbsent' }` | 创建该文件，路径上已有任何东西时拒绝。 |

| Config | 默认值 | 用途 |
|---|---|---|
| `maxFileBytes` | `4194304` | 单个文档的包含式字节上限，读取与写入同样适用。超出即拒绝，绝不截断。 |
| `writeMode` | `danger-full-access` | 用户自身编辑所用的沙箱策略。`read-only` 拒绝每一次写入，读取不受影响。 |

### Failures

| 错误码 | 细节 | 含义 |
|---|---|---|
| `workspace-editor/not-found` | `path` | 该路径上没有任何条目。 |
| `workspace-editor/not-regular-file` | `path`, `kind` | 该路径是目录、符号链接或其他没有文本的东西。 |
| `workspace-editor/outside-workspace` | `path` | 路径是绝对路径，或走出了 Workspace 根目录。 |
| `workspace-editor/too-large` | `path`, `limit` | 文档超过 `maxFileBytes`。 |
| `workspace-editor/not-text` | `path` | 内容不是可解码的 UTF-8，或带有 NUL 字节。 |
| `workspace-editor/stale` | `path`, `current?` | 文件自调用方读到的版本之后已被改动；`current` 是它当前持有的版本。 |
| `workspace-editor/not-observed` | `path` | 仅创建的写入发现该路径上已有东西。 |
| `workspace-editor/write-failed` | `path`, `code` | 文件系统以本服务不再细分的原因拒绝了这次写入。 |
| `workspace/not-found` | `workspaceId` | 没有 Workspace 注册携带该标识。 |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Workspace 注册是唯一的路径权威。`ctx.workspaceRegistry.get` 解析根目录，`ctx.fs.resolve` 相对它解析目标，`ctx.fs.contains` 拒绝任何越界；绝对路径、带 `..` 段的路径或含 NUL 字节的路径在解析之前就被拒绝。

读取与写入共用一个上限。读取先检查 stat 大小，读出完整文本，并在检查的两侧都对超过 `maxFileBytes` 的情况拒绝；NUL 字节作为二进制被拒绝。写入在触碰文件之前检查内容的字节长度，因此过大的保存会被拒绝而不是被切短。

版本校验由文件系统自己完成：`writeText` 接受 `replaceIfVersion` 或 `createIfAbsent`，本地提供方以 `FS_STALE_VERSION` 拒绝不匹配，以 `FS_NOT_OBSERVED` 拒绝已占用的路径。本服务把它们映射到线上词汇，并且对过期写入报告文件当前持有的版本，使客户端能提供重新加载而不是盲目覆盖。错误码按结构读取，因为错误类属于提供方加载的那个文件系统实例。

`writeMode` 存在是因为这是人在编辑自己的机器，而不是一次 Agent 工具调用：该值属于部署选择，因此是经过校验的 Config 字段而不是常量。`read-only` 让每个浏览器界面变为只读，且不影响读取。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [文件系统](../../fs/fs/README.zh.md) — 每次读取与写入经过的服务，以及本包依赖的写入意图。
- [沙箱策略](../../sandbox/sandbox-policy/README.zh.md) — 写入所运行的已解析策略。
- [Workspace 实体](../../workspace/workspace/README.zh.md) — 本服务据此解析根目录的注册。
- [workspace-files](../workspace-files/README.zh.md) — 本包刻意没有扩展的只读姊妹包。

## Model Experience

None, as this package serves a person editing their own files and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading or writing a document does not alter model requests already in flight.

## Known Limitations and Deferred Work

- **没有轮次记账。** 用户的编辑不会记录为 Session 事件，与终端一致：日志是 Agent 的记录，不是击键日志。因此一轮的改动文件卡片报告的是 git 在自己快照点看到的内容，而不是谁写的。
- **只报告冲突，绝不合并。** 过期的保存会带着当前版本被拒绝；合并两个文本版本是调用方的决定。
- **只支持整文件写入。** 没有范围写入或补丁写入，因此每次保存都会完整发送大文档。
- **写入上限小于其姊妹包的读取上限。** `maxFileBytes` 默认 4 MiB，因为浏览器编辑器会把整份文档放在内存里。
- **部署策略较粗。** Host 上所有 Workspace 共用一个 `writeMode`；按 Workspace 的策略需要更丰富的请求。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

服务键与线上命名空间都是 `workspaceEditor`，因此客户端读取 `ctx.remote.workspaceEditor`。本包只提供 Host 面：`api-remotes` 挂载生成的 `/remote` 贡献，消费它的浏览器界面注册自己的面板。

</details>

**Runtime invariant:** 不发布伴随文件。本包可能与之分歧的内容——写入只落在调用方读到的版本上，且没有任何路径走出 Workspace——由它针对真实文件系统的测试以及一次真实 Loader 组合断言，两者都没有独立观察者能与之分歧。
