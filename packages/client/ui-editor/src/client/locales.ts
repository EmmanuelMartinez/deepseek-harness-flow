/** Editor panel interface copy. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  panel: '编辑器',
  title: '编辑器',
  empty: '没有打开的文档。',
  close: '关闭',
  save: '保存',
  saving: '正在保存…',
  unsaved: '未保存',
  saved: '已保存',
  reload: '重新加载',
  autosave: '自动保存',
  conflict: '该文件在你打开期间已被改动。',
  conflictKeep: '你的改动仍在缓冲区里；重新加载会丢弃它们。',
  failed: '无法读取或写入该文档。',
  edit: '编辑',
  diff: '差异',
  loading: '正在读取…',
  noRepository: '该文件不在 git 仓库内。',
  noChanges: '此文件相对仓库没有改动。',
  workingTree: '工作树改动',
  staged: '已暂存改动',
  untrackedFile: '未跟踪文件',
  binary: '二进制文件没有可显示的行。',
  truncated: '已按配置的上限截断。',
} satisfies Record<string, string>

/** Editor panel locale key union. */
export type EditorLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  panel: 'Editor',
  title: 'Editor',
  empty: 'No document is open.',
  close: 'Close',
  save: 'Save',
  saving: 'Saving…',
  unsaved: 'Unsaved',
  saved: 'Saved',
  reload: 'Reload',
  autosave: 'Autosave',
  conflict: 'This file changed while you had it open.',
  conflictKeep: 'Your edit is still in the buffer; reloading discards it.',
  failed: 'The document could not be read or written.',
  edit: 'Edit',
  diff: 'Diff',
  loading: 'Reading…',
  noRepository: 'This file is not inside a git repository.',
  noChanges: 'This file has no change against the repository.',
  workingTree: 'Working tree changes',
  staged: 'Staged changes',
  untrackedFile: 'Untracked file',
  binary: 'A binary file has no lines to show.',
  truncated: 'Cut at the configured limit.',
} satisfies Record<EditorLocaleKey, string>
