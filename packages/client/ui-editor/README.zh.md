---
description: "Web 客户端的编辑器面板：带标签页、显式或自动保存、带版本校验写入的全局文档界面，让人在 Harness 内审阅并编辑文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-editor

[English](README.md) | 中文

## Summary

Web 客户端的文档界面：一个侧边栏入口，配一个已打开文档的面板，每份文档都是某个 Workspace 文件上的可编辑缓冲区。保存是显式的——⌘S 或「保存」控件——而「自动保存」开关让保存改为跟随输入停顿发生。每次保存都回传缓冲区读到的版本，因此期间被 Agent 或另一个窗口改动的文件会报告为冲突，并提供重新读取，而不是被覆盖。

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

把本包挂载到同时具备侧边栏、框架 `rightrail` 座位、布局 `main` keyed slot 与 `workspaceEditor` Remote 命名空间的客户端组合中；Web 组合包在 `ui-git` 之后挂载它。侧边栏的**编辑器**入口与面板共用同一个 id，因此选中入口即打开面板，而侧边栏绘制自己的选中态。第二处注册把同一个工具放到框架的右轨上，由框架拥有那个按钮与它的切换：按一次打开面板，再按当前项则重新关闭。

| 区域 | 展示内容 |
|---|---|
| 标签页 | 每份打开的文档一个标签，显示其名称、缓冲区与文件不一致时的圆点，以及关闭控件。 |
| 状态栏 | Workspace 相对路径、已保存/未保存状态、编辑/差异切换、「自动保存」开关、「重新加载」与「保存」。 |
| 横幅 | 冲突——文件在缓冲区之下被改动——或阻止读取/写入的失败，各带应对方式。 |
| 主体 | 文档的完整文本，可编辑，Tab 插入两个空格；或它与仓库的对比，新增行绿色、删除行红色。 |

对比不需要额外的包：组合挂载了 `git` 命名空间时面板才会向它询问，并且只在那时提供「差异」开关。工作树中有改动的文件显示该改动；改动已经暂存的文件显示索引相对 HEAD；仓库中没有任何改动的文件会直接说明，而不是显示空视图。

### Opening a document from another plugin

面板发布 `editorNavigation` 供把文件交给它的插件使用，调用方无需导入本包的值：

```ts
const editor = ctx.get('editorNavigation')
if (editor?.open('/home/me/project/packages/app/src/main.ts') !== true) {
  // No Workspace contains that path: open it another way.
}
```

`open` 解析包含该绝对路径的 Workspace，选中编辑器面板并打开该文档，已打开时直接显示它。没有 Workspace 包含该路径时返回 `false`，版本控制面板与文件树因此退回各自的只读预览。

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/model.ts` 是无 React 的状态：已打开的文档、当前文档，以及自动保存是否开启。每份文档保留它读到的文本（`saved`）、缓冲区（`text`）以及该文本来自的版本；`dirty` 恰是 `text !== saved`，因此是推导而来而非另行跟踪。模型为每份文档维护一个请求世代，因此竞争失败的重新加载不会覆盖更新的缓冲区；释放它会作废所有待处理的保存。

面板渲染的是 `<textarea>` 而不是代码编辑器：缓冲区就是文档，光标交给浏览器，面板保持受控值，因此保存写入的正是用户看到的内容。Tab 通过同一个值设置器插入两个空格，并在渲染后恢复光标位置。

对比是对 `git` 命名空间的一次读取，而不是第二个 remote：`loadDiff` 解析 Workspace 背后的仓库，把文档的绝对路径映射为仓库相对路径，读取该文件的状态条目，并请求持有改动的那一侧——文件在工作树中有差异时取工作树，改动已暂存时取索引。结果是可判别值（`ready`、`unchanged`、`unavailable`），因此面板给出原因而不是空视图；写入成功后对比会被丢弃，因为文件已经移动。

冲突保留用户的缓冲区并提供「重新加载」，它会重读文件并替换缓冲区。这里没有合并：两个文本版本应由用户自己协调，诚实的默认是同时给出事实与出路，而不是替用户选一个。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [workspace-editor](../../api/workspace-editor/README.zh.md) — 本面板读写所经的 Host 命名空间。
- [ui-sidebar](../ui-sidebar/README.zh.md) — 拥有入口按钮、标签与选中态的外壳。
- [ui-layout](../ui-layout/README.zh.md) — 页面占据的 `main` keyed slot。
- [ui-git](../ui-git/README.zh.md) — 把改动文件打开到这里的面板。

## Model Experience

None, as this package renders a browser panel and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; a person's edit reaches the filesystem, not a model request.

## Known Limitations and Deferred Work

- **纯文本缓冲区。** 没有语法高亮、补全或多光标；Tab 缩进两个空格，没有其他重排。共享高亮器已存在，留待后续版本。
- **冲突时不合并。** 「重新加载」会丢弃本地缓冲区；协调两个版本是用户的工作。
- **关闭标签页会丢弃未保存文本**，且没有提示。
- **面板只编辑 Workspace 之内的文件。** 其外的文件在只读预览中打开，因为 Host 命名空间限定于 Workspace。
- **对比会替换缓冲区。** 它是带行号的统一视图，不是并排编辑器，改动行不能在其中编辑；切换回「编辑」即回到缓冲区。
- **一次只有一种对比。** 同时存在已暂存与未暂存改动的文件显示持有工作树改动的那一侧，因此已暂存的部分不会在旁边显示。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

面板 id 与词典命名空间都是 `editor`；Host 服务键是 `workspaceEditor`。面板是 `main` 条目而不是右栏标签，因为右栏属于屏幕上那个 Session，而全局面板必须在没有 Session 时也能工作。

</details>

**Runtime invariant:** 不发布伴随文件。本包可能与之分歧的内容——两处注册共用同一 id 且一起离开，以及 `editorNavigation` 会选中面板并打开交给它的文档——由它自己的客户端测试断言，而浏览器侧的 slot 贡献没有独立观察者。
