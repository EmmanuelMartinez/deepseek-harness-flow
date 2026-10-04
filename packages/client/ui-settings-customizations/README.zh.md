---
description: "dsh Web 客户端设置中的「个性化配置」分区：本部署的 Skills 及其发现来源，以及 MCP 服务器及其实时状态与已注册工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-customizations

[English](README.md) | 中文

## 概述

打开**设置**并选择**个性化配置**，即可查看本部署除内置工具之外提供给 agent 的内容：会话可以加载的技能，以及它可以调用的 MCP 服务器。页面从 Host 读取一份快照，并将其拆成两个视图，各自在名称、描述、路径与工具名上独立搜索。它不做任何修改。

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

**Skills** 视图把每个技能显示为一张卡片：名称、它来自的发现根目录、模型与用户是否可调用它、暴露它的 agent 预设，以及它拥有的指令文件路径。**MCP 服务器**视图列出每个服务器及其启用状态、传输方式、其配置指定的命令行或端点，以及它当前注册的工具；带有工具的服务器可按需展开它们。

服务器的状态行只报告 Host 能证实的事实。被禁用的行显示**未运行**，启动失败的行显示**启动失败**，仍在加载的行显示**正在连接**，而已在运行却没有注册工具的行会提示服务器可能不可达，而不是声称已连接。已运行且带有工具的行报告其数量。

两个视图各自保留搜索词，因此在它们之间切换不会改写另一个列表的筛选条件。**刷新**会再次读取 Host；读取进行期间按钮被禁用，被更新的读取取代的旧结果会被丢弃。

该分区以上述 id `customizations`、顺序 12 注册到 `settings.section`，因此在设置导航中出现在**模型**与**插件**之间，并使用技能图标。插件激活期间不读取 Remote：首次选择该分区时才挂载组件并调用 `customizations.snapshot()`。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

Host 面是一个空的 `apply`，仅用于让本包持有 Loader 行，以便客户端模块系统为其提供浏览器半部分。浏览器半部分通过 `ctx.slots.inject` 注册一个 `settings.section` 贡献，注册的 inject 面闭包持有生成的 `customizations` Remote 命名空间：调用失败时抛出错误，组件渲染自己的错误状态与「重试」，而不是暴露传输错误码。

组件持有唯一的读取状态——加载中、错误或就绪快照——并以代际保护它，因此更慢的旧结果永远不会替换更新的结果。两个视图始终挂载但被隐藏，因此各自保留其搜索与展开状态。

卡片布局、加载骨架、空状态与失败行都是本包基于 `ui-primitives` 控件（`SegmentedTabs`、`Input`、`Button`、`Tag`、`StateDot`、`IconChevronDownOutlineRegular`）与共享设置卡片材质的本地标记；目录中没有任何可复用的控件可供本页面提升。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [api-customizations-controller](../../api/customizations-controller/README.zh.md) — 本分区渲染的 Host 清单。
- [ui-settings](../ui-settings/README.zh.md) — `settings.section` 槽位类型与设置域。
- [ui-settings-plugins](../ui-settings-plugins/README.zh.md) — 相邻的「插件」分区。
- [ui-primitives](../ui-primitives/README.zh.md) — 本页面组合的控件与设置卡片样式。

<a id="model-experience"></a>
## 模型体验

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache 影响

None; this package neither assembles nor sends a provider request.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **只读。** 页面不启用、停用、添加或编辑任何内容；MCP 管理需要它自己的 Host 方法与权限评审。
- **没有连接状态。** MCP 客户端不发布存活信号，因此状态行报告插件阶段与已注册工具，而不是连接状态。
- **每次读取只有一份快照。** 页面不流式更新，因此在读取之后才连上的服务器，只有再次**刷新**后才会显示其新工具。
- **技能目录是合并的，而非按预设划分。** 多个预设都提供的技能只出现一次，并列出它们的全部 id。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

字典命名空间是 `settings.customizations`。该面板读取由 `@deepseek-ai/dsh-api-remotes` 挂载的生成的 `customizations` 命名空间；服务本身是 `@deepseek-ai/dsh-api-customizations-controller`，在 `packages/bundle/web-app/cordis.patch.yml` 中作为 `customizations-controller` 行挂载。

</details>

**Runtime invariant:** No companion is published. The pane holds no owned relationship of its own: everything it shows derives from one Host read, and nothing it does writes configuration.
