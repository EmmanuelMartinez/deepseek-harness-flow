---
description: "「个性化配置」设置面板的只读 Skills 与 MCP 清单，经 `customizations` Remote 命名空间提供：已组合 Agent 预设的技能目录合并结果，以及每个 MCP Loader 行与其注册的工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-customizations-controller

[English](README.md) | 中文

## 概述

用本包展示一个部署作为*个性化配置*提供给 agent 的内容：会话可以加载的技能，以及它可以调用的 MCP 服务器。它合并已组合的 agent 预设与全局层的技能目录，读取每个模块为 MCP 客户端的 Loader 行，并投射这些行注册的工具。本服务不修改任何状态，也不写入任何配置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包与 `dsh-tools` 及 Loader 一起挂载；Web bundle 在 `workspace-editor` 之后挂载它。浏览器调用一次 `remote.customizations.snapshot()`，并用该结果渲染整个页面。

| 字段 | 含义 |
|---|---|
| `skillsAvailable` | 该组合是否挂载了技能注册表。为 false 时面板如实说明，而不是显示空目录。 |
| `presets` | 已合并其目录的 agent 预设 id，按名册顺序排列。 |
| `skills` | 合并后的目录，按名称排序。 |
| `skillsTruncated` | `maxSkills` 是否隐藏了部分目录。 |
| `mcpServers` | 每个 MCP Loader 行及其实时事实。 |

每个技能携带其名称、描述、`whenToUse`、指令文件路径、发现 `source`、`provider`、模型与用户是否可调用它，以及其组合暴露该技能的预设 id。

每个 MCP 服务器携带其 Loader `entryId`、协议 `serverName`、`transport`、其配置指定的 `target`（stdio 为命令行，streamable-http 为端点 URL）、生效的 `enabled`、实时 `fiberPhase`、该 profile 是否可为启用状态变更寻址该行（`manageable`），以及当前注册在 `mcp__<serverName>__` 下的 `tools`。

| 配置 | 默认值 | 用途 |
|---|---|---|
| `maxSkills` | `500` | 一次快照返回的技能数；更大的目录会被截断并报告为已截断。 |
| `maxMcpServers` | `100` | 一次快照返回的 MCP 服务器数。 |
| `maxMcpTools` | `200` | 每个 MCP 服务器列出的工具数。 |

每个字段都必须是正的安全整数；否则插件在加载时抛出。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

技能目录按 scope 分层，因此在随包发布的 Web 组合中，仅读全局层无法回答任何预设：该组合中基础 `skill-filesystem` 行被禁用，各预设自行拥有发现逻辑。因此本读取会遍历 `agentPresets.compositionInventory()`，逐个获取预设 scope（与会话技能目录相同的冷读路径，它挂载一代预设而不创建 agent），按该 scope 列出，然后释放租约。条目按名称合并：最先看到的元数据胜出，后续 scope 只补充其预设 id，因此所有预设都提供的技能会报告全部预设。无法挂载的预设不贡献任何内容并被记录日志；其同级预设仍会列出。

MCP 行直接从 Loader 读取，而不是从某个服务读取，因为 `dsh-mcp-client` 不发布任何服务，并把连接状态保存在闭包中。该行的 config 是被收窄的、而非被信任的：Loader 保存的是 YAML 写下的内容，不会应用插件的 schema 默认值，因此既未指定 stdio 命令也未指定 HTTP 端点的行不贡献任何服务器。工具归属通过 `mcp__<serverName>__` 名称前缀恢复，这是该事实唯一存在的位置——`ctx.tools` 不记录注册插件。

第一个已注册 Workspace 的目录会作为技能查找的 `cwd` 传入，因为项目技能根目录按目录发现。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Skills 子系统](../../../docs/subsystems/skills.zh.md) — 注册表、其分层 scope 与发现优先级。
- [mcp-client](../../mcp/mcp-client/README.zh.md) — 此处每一行所挂载的插件。
- [Agent preset registry](../../preset/agent-preset-registry/README.zh.md) — 本读取获取的名册与 scope 租约。
- [API Gateway](../../../docs/api-gateway.zh.md) — `@Remote` 方法如何成为 `ctx.remote.customizations`。
- [ui-settings-customizations](../../client/ui-settings-customizations/README.zh.md) — 渲染此快照的面板。

<a id="model-experience"></a>
## 模型体验

None, as this package serves a settings pane and registers no prompt, tool, or session event. It reports what other plugins made model-visible; it adds nothing to a request.

#### KV Cache 影响

No direct effect; a read changes no model request.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **只读。** 本包不启用、停用、添加或编辑任何服务器；需要这些操作的面板要求新方法与相应的权限评审。
- **没有 MCP 连接状态。** `dsh-mcp-client` 不发布 `connected`、`reconnecting` 或 `gaveUp` 信号，因此正在运行但没有注册工具的行会被报告为可能不可达，而不是已连接。
- **工具归属由名称前缀推断。** 恰好命名为 `mcp__<server>__…` 的非 MCP 工具会被计入，而被限制离开全局视图的 MCP 服务器会报告没有工具。
- **预设 scope 读取会挂载一代预设。** 列出目录可能激活并随后释放各预设的插件；拥有昂贵预设行的部署会在每次读取时付出该代价。
- **技能是合并的，而非按预设归属。** 两个预设以不同方式定义的同一技能会报告最先看到的元数据，以及预设 id 的并集。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

服务键与线上命名空间都是 `customizations`，因此客户端读取 `ctx.remote.customizations.snapshot()`。本包只提供 Host 面：`api-remotes` 挂载生成的 `/remote` 贡献，消费它的面板位于 `@deepseek-ai/dsh-client-ui-settings-customizations`。

</details>

**Runtime invariant:** No companion is published. The relationships here — a skill's scope chain and an MCP row's tool prefix — are read from their owning services on every call, so no second cache can diverge from them.
