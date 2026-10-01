---
description: "dsh Web 客户端的 git 界面：侧边栏的「版本控制」入口，以及它经 `git` Remote 命名空间打开的仓库页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git

[English](README.md) | 中文

## 概述

Web 客户端的版本控制界面：一个侧边栏入口，以及它选中的仓库页面。页面展示某个 Workspace 的仓库——分支与上游分叉、带已暂存与未暂存两侧的改动文件、带引用的历史图，以及所选提交的消息与改动文件。它通过 `git` Remote 命名空间读取，在用户另选之前选中第一个 Workspace，并且从不修改仓库。

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

把本包挂载到同时具备侧边栏、框架 `rightrail` 座位、布局 `main` keyed slot 与 `git` Remote 命名空间的客户端组合中；Web 组合包在 `ui-goal` 之后挂载它。侧边栏的**版本控制**入口与页面共用同一个 id（`git`），因此选中该入口即打开页面，而侧边栏绘制该入口自己的选中态。第二处注册把同一个工具放到框架的右轨上，由框架拥有那个按钮与它的切换：按一次打开页面，再按当前项则重新关闭。该条目的图标显示改动文件数，数字发布到本包自己持有的来源，因此页面关闭后仍然保留；组合中恰好只有一个 Workspace 时先读取一次 status 作为初值，页面在每次 status 结算后保持它最新。

| 区域 | 展示内容 |
|---|---|
| 顶部 | 仓库名、当前分支（或 `detached`）、上游分叉 `+ahead -behind`、Workspace 选择器与「刷新」。 |
| 更改 | 每条改动路径一行，带 git 的两个状态字母（索引侧在前）与未跟踪标记。 |
| 历史 | `--date-order` 下的一页历史，每条分支线一个图道，附提交主题、提交 id、作者、日期与指向该提交的引用。选中一行即读取该提交。 |
| 提交 | 所选提交的消息正文、作者、父提交、引用，以及带行数的改动文件。 |

每次读取都以一个 Workspace 为单位，面板一次只展示一个。在顶部选择 Workspace 会替换整个面板；「刷新」重新读取当前 Workspace 并保留所选提交。 面板是实时的：它跟随该 Workspace 的 `git.watch` 流，因此在任何地方产生的提交、切换分支或索引写入都会重新读取图谱与工作树，无需手动刷新。事件会在一段短暂的静默期后合并，因为一次提交会写入许多文件。框架右轨上的改动文件徽标在面板打开时跟随同一条流，面板关闭时则自行读取。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/model.ts` 是无 React 的状态：一个可观察快照，加上 `selectWorkspace`、`selectCommit`、`refresh` 与 `dispose`。它持有一个请求世代，因此切换 Workspace 会丢弃更慢的旧答复而不是发布它。它的 `git` 命名空间类型来自 `api-remotes` 门面；它从不导入 Gateway。

`src/client/lanes.ts` 仅凭一页提交分配图道。每个图道持有它等待的提交 id；提交占用已在等待它的图道或一个空闲图道，合并掉等待同一提交的其他图道，并把第一父提交留在自己的图道，其余父提交占用更靠后的图道。

`src/client/index.ts` 在一个 fiber 中注册两处贡献：以面板 id 命名的 `main` keyed 条目及其注入面，以及同一 id 下的 `sidebar.panellist` 图标。注入面通过注册者私有的 `hooks` 舱携带状态模型与 Workspace 列表，渲染器把它们绑定为 `useGitPanel` 与 `useGitWorkspaces`。模型的存活期与 `main` 注册完全一致，卸载后不留下任何东西。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [git-controller](../../api/git-controller/README.zh.md) — 本页面读取的 Host Remote 命名空间。
- [ui-sidebar](../ui-sidebar/README.zh.md) — 拥有入口按钮、标签与选中态的外壳。
- [ui-layout](../ui-layout/README.zh.md) — 页面占据的 `main` keyed slot。
- [ui-primitives](../ui-primitives/README.zh.md) — 入口绘制的分支图标。

<a id="model-experience"></a>
## 模型体验

None, as this package renders a browser panel and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading repository state does not alter model requests already in flight.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **只读。** 不提供暂存、提交、分支、检出或网络操作；它们会随所需的 Host 方法一起到来。
- **面板以 Workspace 为单位，而非 Session。** 除 `conversation` 之外的 `main` 条目不会获得 Session 绑定，因此页面选择 Workspace，而不是读取当前 Session 的。
- **一页历史，没有过滤。** 页面只请求一页并报告存在更早的提交；它没有搜索、路径过滤或无限滚动。
- **图是展示性近似。** 图道仅凭这一页的父提交合并与延续，因此在历史中途被截断的一页会把截断画成延续的图道。
- **还没有差异查看器。** 提交的文件列表只报告行数；打开单个文件的对比需要文件与差异界面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

面板 id 与词典命名空间都是 `git`；Host 服务键是 `gitController`，线上命名空间是 `git`。Workspace 行作为第二个注册者私有来源到达，而不是通过该 slot 的标准 `useWorkspaces` 座位——`main` slot 的类型化 props 并不携带它。

</details>

**Runtime invariant:** 不发布伴随文件。本包可能与之分歧的内容——两处注册共用同一 id 及其释放——由它自己的客户端测试断言，而浏览器侧的 slot 贡献没有独立观察者。
