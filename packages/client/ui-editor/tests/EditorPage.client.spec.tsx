// @vitest-environment jsdom
/**
 * The Editor page's rendering: its empty state, the buffer it edits, the save
 * it reports, the conflict banner with its reload, and the tab strip.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { EditorPage, type EditorPageProps } from '../src/client/EditorPage.tsx'
import type { EditorDocument, EditorState } from '../src/client/model.ts'
import type { EditorInjected } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** The seats this spec drives: the panel's injected face and the page's locale. */
type PageSeats = InjectFace<EditorInjected> & PropsLocale<'editor'>

/** A bare observable over one fixed snapshot. */
function source<T>(snapshot: T): HostObservable<T> {
  return { getSnapshot: () => snapshot, subscribe: () => () => undefined }
}

/** One open document. */
function document(change: Partial<EditorDocument> = {}): EditorDocument {
  return {
    id: 'ws\u0000dir/notes.txt',
    workspaceId: 'ws-one' as EditorDocument['workspaceId'],
    path: 'dir/notes.txt',
    name: 'notes.txt',
    saved: 'first\n',
    text: 'first\n',
    version: 'v1',
    bytes: 6,
    dirty: false,
    busy: false,
    mode: 'edit',
    ...change,
  }
}

/** The page over one state, with scripted operations. */
function page(state: Omit<EditorState, 'gitAvailable'> & { readonly gitAvailable?: boolean }) {
  const activate = vi.fn()
  const close = vi.fn()
  const edit = vi.fn()
  const save = vi.fn(async () => undefined)
  const reload = vi.fn(async () => undefined)
  const toggleAutosave = vi.fn()
  const showDiff = vi.fn()
  const showEdit = vi.fn()
  const select = vi.fn()
  const seats: PageSeats = {
    useEditor: bindSnapshotSelector(source({ gitAvailable: false, ...state })),
    activate,
    close,
    edit,
    save,
    reload,
    toggleAutosave,
    showDiff,
    showEdit,
    select,
    t: makeTranslate(zh),
  }
  return {
    view: render(<EditorPage {...seats as EditorPageProps} />),
    activate, close, edit, save, reload, toggleAutosave, showDiff, showEdit,
  }
}

describe('EditorPage', () => {
  it('says so when no document is open', () => {
    const { view } = page({ documents: [], autosave: false })
    expect(view.getByText(zh.empty)).toBeTruthy()
  })

  it('shows the open buffer, its path, and its saved state', () => {
    const { view } = page({ documents: [document()], active: document().id, autosave: false })
    expect(view.getByRole('tab', { name: /notes\.txt/ }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('textbox').getAttribute('aria-label')).toBe('notes.txt')
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('first\n')
    expect(view.getByText('dir/notes.txt')).toBeTruthy()
    expect(view.getByText(zh.saved)).toBeTruthy()
  })

  it('reports typing, tab activation, closing, and the autosave switch', () => {
    const open = document()
    const { view, edit, activate, close, toggleAutosave } = page({
      documents: [open, document({ id: 'ws\u0000other.txt', path: 'other.txt', name: 'other.txt' })],
      active: open.id,
      autosave: false,
    })
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'second\n' } })
    expect(edit).toHaveBeenCalledWith(open.id, 'second\n')
    fireEvent.click(view.getByRole('tab', { name: /other\.txt/ }))
    expect(activate).toHaveBeenCalledWith('ws\u0000other.txt')
    fireEvent.click(view.getByRole('button', { name: `${zh.close} notes.txt` }))
    expect(close).toHaveBeenCalledWith(open.id)
    fireEvent.click(view.getByRole('button', { name: zh.autosave }))
    expect(toggleAutosave).toHaveBeenCalledTimes(1)
  })

  it('saves on the save control and on its keyboard shortcut', () => {
    const open = document({ text: 'second\n', dirty: true })
    const { view, save } = page({ documents: [open], active: open.id, autosave: false })
    expect(view.getByText(zh.unsaved)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: zh.save }))
    expect(save).toHaveBeenCalledWith(open.id)
    save.mockClear()
    fireEvent.keyDown(view.getByRole('textbox'), { key: 's', metaKey: true })
    expect(save).toHaveBeenCalledWith(open.id)
  })

  it('keeps the save control unavailable while the buffer matches the file', () => {
    const open = document()
    const { view } = page({ documents: [open], active: open.id, autosave: false })
    expect((view.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a conflict with the reload that reads the file again', () => {
    const open = document({ text: 'mine\n', dirty: true, conflict: { current: 'v2' } })
    const { view, reload } = page({ documents: [open], active: open.id, autosave: false })
    expect(view.getByRole('alert').textContent).toContain(zh.conflict)
    expect(view.getByRole('alert').textContent).toContain(zh.conflictKeep)
    fireEvent.click(view.getByRole('button', { name: zh.reload }))
    expect(reload).toHaveBeenCalledWith(open.id)
  })

  it('shows a read or write failure with its message', () => {
    const open = document({
      failure: new RemoteError('workspace-editor/not-found', 'no entry at "dir/notes.txt"', { path: 'dir/notes.txt' }),
    })
    const { view } = page({ documents: [open], active: open.id, autosave: false })
    expect(view.getByRole('alert').textContent).toContain(zh.failed)
    expect(view.getByRole('alert').textContent).toContain('no entry')
  })

  it('switches between the buffer and the comparison when git is mounted', () => {
    const open = document()
    const { view, showDiff, showEdit } = page({
      documents: [open],
      active: open.id,
      autosave: false,
      gitAvailable: true,
    })
    expect(view.getByRole('button', { name: zh.edit }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: zh.diff }))
    expect(showDiff).toHaveBeenCalledWith(open.id)
    fireEvent.click(view.getByRole('button', { name: zh.edit }))
    expect(showEdit).toHaveBeenCalledWith(open.id)
  })

  it('offers no comparison in a composition without git', () => {
    const open = document()
    const { view } = page({ documents: [open], active: open.id, autosave: false })
    expect(view.queryByRole('button', { name: zh.diff })).toBeNull()
  })

  it('draws the changed lines of the comparison', () => {
    const open = document({
      mode: 'diff',
      diff: {
        kind: 'ready',
        side: 'worktree',
        path: 'dir/notes.txt',
        binary: false,
        untracked: false,
        truncated: false,
        hunks: [{
          header: '@@ -1,2 +1,3 @@',
          lines: [
            { kind: 'context', text: 'a' },
            { kind: 'delete', text: 'b' },
            { kind: 'add', text: 'B' },
            { kind: 'add', text: 'c' },
          ],
        }],
      },
    })
    const { view } = page({ documents: [open], active: open.id, autosave: false, gitAvailable: true })
    // The comparison replaces the buffer rather than sitting beside it.
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.getByText(zh.workingTree)).toBeTruthy()
    expect(view.getByText('@@ -1,2 +1,3 @@')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-kind="add"]')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-kind="delete"]')).toHaveLength(1)
  })

  it('names a comparison that has nothing to show', () => {
    const unchanged = document({ mode: 'diff', diff: { kind: 'unchanged' } })
    const first = page({ documents: [unchanged], active: unchanged.id, autosave: false, gitAvailable: true })
    expect(first.view.getByText(zh.noChanges)).toBeTruthy()
    cleanup()
    const unavailable = document({ mode: 'diff', diff: { kind: 'unavailable' } })
    const second = page({ documents: [unavailable], active: unavailable.id, autosave: false, gitAvailable: true })
    expect(second.view.getByText(zh.noRepository)).toBeTruthy()
  })
})
