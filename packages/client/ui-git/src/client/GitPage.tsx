/**
 * The Git page: one Workspace's repository as a single working surface.
 *
 * The history graph owns the column; the changed paths sit above it in a
 * collapsible section, and selecting a commit opens its detail beside them. The
 * page draws only what its props carry: repository state through the hook the
 * renderer binds, selections and refresh through the injected face, and the
 * Workspace rows through the panel's own source.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconCloseOutlineRegular, IconRefreshOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitCommitDetailView, GitCommitView, GitStatusEntry, GitStatusKind } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { assignLanes } from './lanes.ts'
import type { GraphRow } from './lanes.ts'
import type { GitPanelInjected } from './slots.ts'
import css from './GitPage.module.css'

/** Full component props assembled by the main slot renderer. */
export type GitPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'git'>
  & InjectFace<GitPanelInjected>

/** git's own status letter for one side of a change; a space means no change. */
const STATUS_LETTER: Record<GitStatusKind, string> = {
  unmodified: ' ',
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unmerged: 'U',
  untracked: '?',
}

/** Lane column width in pixels; the stylesheet and the gutter agree on it. */
const LANE_STEP = 14

/** Ref pills one history row draws before it counts the rest. */
const REF_PILLS = 3

/**
 * One path, split so its file name always stays readable while the directory gives way first.
 * @param props - the repository-relative path to render.
 * @returns the two text runs.
 */
function PathText({ path }: { readonly path: string }): ReactNode {
  const cut = path.lastIndexOf('/')
  return (
    <span className={css.path}>
      {cut !== -1 && <span className={css.pathDir}>{path.slice(0, cut + 1)}</span>}
      <span className={css.pathName}>{cut === -1 ? path : path.slice(cut + 1)}</span>
    </span>
  )
}

/**
 * One status letter.
 * @param props - the state this side of the change holds.
 * @returns the letter chip.
 */
function Letter({ kind }: { readonly kind: GitStatusKind }): ReactNode {
  return <span className={css.letter} data-kind={kind} aria-hidden="true">{STATUS_LETTER[kind]}</span>
}

/**
 * The graph gutter: the rails carried through this row and the commit's dot.
 * @param props - one history row's geometry.
 * @returns the gutter drawing.
 */
function Gutter({ row }: { readonly row: GraphRow }): ReactNode {
  const columns = row.rails.reduce((widest, rail) => Math.max(widest, rail.lane + 1), row.lane + 1)
  const width = columns * LANE_STEP
  const centre = (lane: number): number => lane * LANE_STEP + LANE_STEP / 2
  return (
    <svg className={css.gutter} width={width} height={28} viewBox={`0 0 ${String(width)} 28`} aria-hidden="true">
      {row.rails.map(rail => (
        <line
          key={rail.lane}
          className={css.rail}
          data-color={rail.color}
          x1={centre(rail.lane)}
          x2={centre(rail.lane)}
          y1={rail.from}
          y2={rail.to}
        />
      ))}
      <circle className={css.dot} data-color={row.color} cx={centre(row.lane)} cy={14} r={4} />
    </svg>
  )
}

/**
 * One history row.
 * @param props - the row's geometry, its selection, and the selection callback.
 * @returns the row.
 */
function CommitRow({ row, selected, onSelect }: {
  readonly row: GraphRow
  readonly selected: boolean
  readonly onSelect: (oid: string) => void
}): ReactNode {
  const commit: GitCommitView = row.commit
  const extra = commit.refs.length - REF_PILLS
  return (
    <li className={css.commitRow} data-selected={selected}>
      <button type="button" className={css.commitButton} onClick={() => { onSelect(commit.oid) }}>
        <Gutter row={row} />
        <span className={css.subject}>{commit.subject}</span>
        <span className={css.pills}>
          {commit.refs.slice(0, REF_PILLS).map(ref => <span key={ref} className={css.pill}>{ref}</span>)}
          {extra > 0 && <span className={css.pill}>{`+${String(extra)}`}</span>}
        </span>
        <span className={css.rowMeta}>{commit.authorName}</span>
        <time className={css.rowMeta} dateTime={commit.authoredAt}>{commit.authoredAt.slice(0, 10)}</time>
      </button>
    </li>
  )
}

/**
 * One section of changed paths.
 * @param props - the section's label, its entries, and the file-opening callback.
 * @returns the section, or nothing when it holds no entries.
 */
function ChangeGroup({ label, entries, onOpen }: {
  readonly label: string
  readonly entries: readonly GitStatusEntry[]
  readonly onOpen: (path: string) => void
}): ReactNode {
  if (entries.length === 0) return null
  return (
    <div className={css.group}>
      <p className={css.groupLabel}>{label}<span className={css.count}>{entries.length}</span></p>
      <ul className={css.files}>
        {entries.map(entry => (
          <li key={`${entry.path}:${entry.from ?? ''}`} className={css.fileRow}>
            <button type="button" className={css.fileButton} onClick={() => { onOpen(entry.path) }}>
              <Letter kind={entry.worktree === 'unmodified' ? entry.index : entry.worktree} />
              <span className={css.fileText}>
                <PathText path={entry.path} />
                {entry.from !== undefined && <span className={css.renamedFrom}>{entry.from}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One commit's detail pane.
 * @param props - the commit, the translator, and the close callback.
 * @returns the pane.
 */
function CommitDetail({ commit, t, onClose, onOpen }: {
  readonly commit: GitCommitDetailView
  readonly t: (key: 'author' | 'date' | 'parents' | 'refs' | 'files' | 'binary' | 'close' | 'truncated') => string
  readonly onClose: () => void
  readonly onOpen: (path: string) => void
}): ReactNode {
  return (
    <aside className={css.detail}>
      <header className={css.detailHead}>
        <span className={css.oid}>{commit.oid.slice(0, 10)}</span>
        <Tooltip label={t('close')}>
          <button type="button" className={css.iconButton} aria-label={t('close')} onClick={onClose}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </Tooltip>
      </header>
      <h3 className={css.detailSubject}>{commit.subject}</h3>
      {commit.body !== '' && <pre className={css.body}>{commit.body}</pre>}
      <dl className={css.facts}>
        <dt>{t('author')}</dt>
        <dd>{commit.authorName}</dd>
        <dt>{t('date')}</dt>
        <dd>{commit.authoredAt.slice(0, 10)}</dd>
        <dt>{t('parents')}</dt>
        <dd className={css.mono}>{commit.parents.map(parent => parent.slice(0, 8)).join(' ') || '-'}</dd>
        {commit.refs.length > 0 && (
          <>
            <dt>{t('refs')}</dt>
            <dd>{commit.refs.join(', ')}</dd>
          </>
        )}
      </dl>
      <p className={css.groupLabel}>{t('files')}<span className={css.count}>{commit.files.length}</span></p>
      <ul className={css.files}>
        {commit.files.map(file => (
          <li key={file.path} className={css.fileRow}>
            <button type="button" className={css.fileButton} onClick={() => { onOpen(file.path) }}>
              <Letter kind={file.kind} />
              <span className={css.fileText}><PathText path={file.path} /></span>
              <span className={css.counts}>
                {file.binary ? t('binary') : `+${String(file.insertions)} -${String(file.deletions)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {commit.filesTruncated && <p className={css.note}>{t('truncated')}</p>}
    </aside>
  )
}

/**
 * Render the Git panel.
 * @param props - the main slot's runtime currency, the panel's injected face, and the translator.
 * @returns the page element.
 */
export function GitPage({
  useGitPanel, useGitWorkspaces, selectWorkspace, selectCommit, clearCommit, openFile, refresh, t,
}: GitPageProps): ReactNode {
  const state = useGitPanel(snapshot => snapshot)
  const workspaces = useGitWorkspaces(snapshot => snapshot.items)
  const [changesOpen, setChangesOpen] = useState(true)
  useEffect(() => {
    if (state.workspaceId !== undefined) return
    const first: WorkspaceView | undefined = workspaces[0]
    if (first === undefined) return
    selectWorkspace(first.workspaceId)
  }, [state.workspaceId, workspaces, selectWorkspace])

  const repository = state.repository
  const entries = state.status?.entries ?? []
  const branch = repository === undefined
    ? ''
    : repository.head.kind === 'branch' || repository.head.kind === 'unborn'
      ? repository.head.branch
      : t('detached')
  const staged = entries.filter(entry => entry.index !== 'unmodified')
  const unstaged = entries.filter(entry =>
    entry.index === 'unmodified' && entry.worktree !== 'unmodified' && entry.worktree !== 'untracked')
  const untracked = entries.filter(entry => entry.worktree === 'untracked')
  const rows = assignLanes(state.commits)
  const ready = state.failure === undefined && repository !== undefined

  return (
    <div className={css.page}>
      <header className={css.head}>
        <span className={css.identity}>
          <IconBranchOutlineRegular size={15} />
          <span className={css.branch}>{branch}</span>
          {repository?.upstream !== undefined && <span className={css.upstream}>{repository.upstream.ref}</span>}
          {repository?.upstream !== undefined && (
            <span className={css.mono}>
              {`+${String(repository.upstream.ahead)} -${String(repository.upstream.behind)}`}
            </span>
          )}
          {repository !== undefined && <span className={css.repoName}>{repository.name}</span>}
        </span>
        <span className={css.tools}>
          {workspaces.length > 1 && (
            <span className={css.workspaces}>
              {workspaces.map(workspace => (
                <button
                  key={workspace.workspaceId}
                  type="button"
                  className={css.workspaceButton}
                  data-active={workspace.workspaceId === state.workspaceId}
                  onClick={() => { selectWorkspace(workspace.workspaceId) }}
                >
                  {workspace.title}
                </button>
              ))}
            </span>
          )}
          <Tooltip label={t('refresh')}>
            <button type="button" className={css.iconButton} aria-label={t('refresh')} onClick={() => { refresh() }}>
              <IconRefreshOutlineRegular size={15} />
            </button>
          </Tooltip>
        </span>
      </header>

      {state.failure !== undefined && (
        <p className={css.notice}>
          {state.failure.code === 'git/unavailable' ? t('unavailable') : t('failed')}
          <span className={css.noticeDetail}>{state.failure.message}</span>
        </p>
      )}
      {state.failure === undefined && state.workspaceId === undefined && (
        <p className={css.notice}>{t('noWorkspace')}</p>
      )}
      {state.failure === undefined && state.workspaceId !== undefined && state.phase === 'loading'
        && repository === undefined && <p className={css.notice}>{t('loading')}</p>}
      {state.failure === undefined && state.notARepository && <p className={css.notice}>{t('notARepository')}</p>}

      {ready && (
        <div className={css.body} data-detail={state.commit !== undefined}>
          <div className={css.main}>
            <button
              type="button"
              className={css.sectionToggle}
              aria-expanded={changesOpen}
              onClick={() => { setChangesOpen(!changesOpen) }}
            >
              {changesOpen ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
              {t('changes')}
              {entries.length > 0 && <span className={css.count}>{entries.length}</span>}
              {state.status?.truncated === true && <span className={css.note}>{t('truncated')}</span>}
            </button>
            {changesOpen && (entries.length === 0
              ? <p className={css.note}>{t('noChanges')}</p>
              : (
                <div className={css.changes}>
                  <ChangeGroup label={t('staged')} entries={staged} onOpen={openFile} />
                  <ChangeGroup label={t('unstaged')} entries={unstaged} onOpen={openFile} />
                  <ChangeGroup label={t('untracked')} entries={untracked} onOpen={openFile} />
                </div>
              ))}
            <p className={css.groupLabel}>
              {t('history')}
              {rows.length > 0 && <span className={css.count}>{rows.length}</span>}
            </p>
            {rows.length === 0
              ? <p className={css.note}>{t('noCommits')}</p>
              : (
                <ul className={css.graph}>
                  {rows.map(row => (
                    <CommitRow
                      key={row.commit.oid}
                      row={row}
                      selected={row.commit.oid === state.selected}
                      onSelect={selectCommit}
                    />
                  ))}
                </ul>
              )}
            {state.more && <p className={css.note}>{t('moreCommits')}</p>}
          </div>
          {state.commit !== undefined && (
            <CommitDetail commit={state.commit} t={t} onClose={clearCommit} onOpen={openFile} />
          )}
        </div>
      )}
    </div>
  )
}
