/**
 * Wire types of the `git` Remote namespace. Types only: the generated Remote
 * client consumes this module, and the Client panel reads it without Host
 * runtime code.
 *
 * Every path here is relative to the repository's top level and `/`-separated,
 * because the panel renders one repository's rows and never composes a host
 * path of its own. The Host resolves the repository from the Workspace
 * registration, so no request carries a directory.
 *
 * @module @deepseek-ai/dsh-api-git-controller/types
 */

// Import the protocol module so the declaration at the end of this file
// augments its error map rather than defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

// The Workspace identity is the one directory authority a Client names, so the
// domain's client-safe vocabulary carries it rather than making every consumer
// import the Workspace package.
export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** What the repository's HEAD names. */
export type GitHead =
  | {
    /** HEAD names a born branch. */
    readonly kind: 'branch'
    /** Short branch name, for example `main`. */
    readonly branch: string
    /** Commit the branch points at. */
    readonly oid: string
  }
  | {
    /** HEAD names a commit directly. */
    readonly kind: 'detached'
    readonly oid: string
  }
  | {
    /** HEAD names a branch with no commit yet, so the repository has no history. */
    readonly kind: 'unborn'
    readonly branch: string
  }

/** How the checked-out branch diverges from the branch it tracks. */
export interface GitUpstream {
  /** Short name of the tracked ref, for example `origin/main`. */
  readonly ref: string
  /** Commits the local branch has that the upstream does not. */
  readonly ahead: number
  /** Commits the upstream has that the local branch does not. */
  readonly behind: number
}

/** One repository located from a Workspace path. */
export interface GitRepositoryView {
  /**
   * Absolute top level of the working tree, with symlinks resolved. Not
   * necessarily the Workspace path: a Workspace inside a repository reports the
   * repository that contains it.
   */
  readonly root: string
  /** Display name: the final path segment of {@link root}. */
  readonly name: string
  readonly head: GitHead
  /** Present only while the checked-out branch tracks another ref. */
  readonly upstream?: GitUpstream
}

/** Whether a Workspace path belongs to a repository. */
export type GitRepositoryResult =
  | { readonly kind: 'repository'; readonly repository: GitRepositoryView }
  | { readonly kind: 'not-a-repository' }

/**
 * One side of a file's state. `unmodified` is the absence of a change on that
 * side, which is what a staged-only or working-tree-only change reports on the
 * other side.
 */
export type GitStatusKind =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unmerged'
  | 'untracked'

/** One changed path, with its two sides reported independently. */
export interface GitStatusEntry {
  /** Current path relative to the repository root. */
  readonly path: string
  /** Path the entry had before a rename or copy. */
  readonly from?: string
  /** Staged state: what the index holds against HEAD. */
  readonly index: GitStatusKind
  /** Unstaged state: what the working tree holds against the index. */
  readonly worktree: GitStatusKind
}

/** The working tree's complete changed-path set. */
export interface GitStatusView {
  /** Entries in git's own order, cut to the configured entry cap. */
  readonly entries: readonly GitStatusEntry[]
  /** Whether the entry cap dropped entries. */
  readonly truncated: boolean
}

/** One branch, remote-tracking ref, or tag. */
export interface GitRefView {
  /** Full refname, for example `refs/heads/main`. */
  readonly name: string
  /** Display name: `main`, `origin/main`, or the tag name. */
  readonly shortName: string
  readonly kind: 'local' | 'remote' | 'tag'
  /** Commit the ref resolves to; an annotated tag reports the commit it peels to. */
  readonly oid: string
  /** Whether the checked-out branch is this ref. */
  readonly head: boolean
  /** Subject of the commit the ref points at. */
  readonly subject: string
  /** ISO-8601 committer instant of that commit. */
  readonly committedAt: string
}

/** Every ref the repository holds. */
export interface GitRefsView {
  /** Refs in git's own order, cut to the configured ref cap. */
  readonly refs: readonly GitRefView[]
  /** Whether the ref cap dropped refs. */
  readonly truncated: boolean
}

/** One commit as the graph renders it, without its file changes. */
export interface GitCommitView {
  readonly oid: string
  /** Commit's parents in order; empty for a root commit. */
  readonly parents: readonly string[]
  /** First line of the commit message. */
  readonly subject: string
  readonly authorName: string
  readonly authorEmail: string
  /** ISO-8601 author instant. */
  readonly authoredAt: string
  /**
   * Short names of the refs that point at this commit. Decorations come from
   * the same ref read `refs` serves, so a repository whose refs exceeded the
   * configured cap decorates only the refs that read returned.
   */
  readonly refs: readonly string[]
}

/** One page of a history walk. */
export interface GitLogRequest {
  /** Revision to walk from; defaults to HEAD. */
  readonly rev?: string
  /** Commits to skip from the walk's tip. Defaults to 0. */
  readonly skip?: number
  /** Commits to return. Defaults to, and may not exceed, the configured page cap. */
  readonly limit?: number
  /** Restrict the walk to one repository-relative path. */
  readonly path?: string
}

/** One page of commits, newest first within the walk's order. */
export interface GitLogPage {
  readonly commits: readonly GitCommitView[]
  /** Whether the walk stopped short of the history's end. */
  readonly more: boolean
}

/** One file a commit changed, with its line counts. */
export interface GitFileChangeView {
  /** Path after the change. */
  readonly path: string
  /** Path before a rename or copy. */
  readonly from?: string
  readonly kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange'
  /** Lines the change added; `0` for a binary change. */
  readonly insertions: number
  /** Lines the change removed; `0` for a binary change. */
  readonly deletions: number
  /** Whether git reported the change as binary, so the counts carry no lines. */
  readonly binary: boolean
}

/** One commit with its message body and complete file list. */
export interface GitCommitDetailView extends GitCommitView {
  /** Commit message without its subject line; empty for a one-line message. */
  readonly body: string
  /** Changed files in git's own order, cut to the configured file cap. */
  readonly files: readonly GitFileChangeView[]
  /** Whether the file cap dropped files. */
  readonly filesTruncated: boolean
}

/** Which two states one file comparison reports. */
export type GitDiffSide =
  | { readonly kind: 'worktree' }
  | { readonly kind: 'index' }
  | { readonly kind: 'commit'; readonly oid: string }

/** One file comparison request. */
export interface GitDiffRequest {
  /** Path relative to the repository root, as `status` or `commit` reported it. */
  readonly path: string
  /** Path before a rename, so the comparison follows it across the rename. */
  readonly from?: string
  readonly side: GitDiffSide
}

/** How one compared line changed. */
export type GitDiffLineKind = 'add' | 'delete' | 'context'

/** One compared line, without its diff prefix. */
export interface GitDiffLine {
  readonly kind: GitDiffLineKind
  /** Line content, including a marker-less empty line. */
  readonly text: string
}

/** One contiguous change region. */
export interface GitDiffHunk {
  /** The hunk's `@@ … @@` header, including any trailing section heading. */
  readonly header: string
  /** Hunk body in file order. */
  readonly lines: readonly GitDiffLine[]
}

/** One file's comparison as the panel renders it. */
export interface GitFileDiffView {
  readonly path: string
  readonly from?: string
  /** Hunk bodies in file order; empty for a binary, untracked, or unchanged file. */
  readonly hunks: readonly GitDiffHunk[]
  /** One side is binary, so git reports no lines to compare. */
  readonly binary: boolean
  /**
   * The working-tree side has no index entry, so git reports no comparison for
   * it. The panel presents the file as new from its own preview.
   */
  readonly untracked: boolean
  /** The configured byte cap cut the comparison, so the hunks are incomplete. */
  readonly truncated: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No usable git executable is available to this Host. */
    'git/unavailable': {
      readonly reason: 'missing' | 'developer-tools'
    }
    /** The Workspace path belongs to no git working tree. */
    'git/not-a-repository': {
      readonly workspaceId: WorkspaceId
    }
    /** The requested revision does not exist in this repository. */
    'git/unknown-revision': {
      readonly revision: string
    }
    /** A request named a path outside the repository or a revision that looks like an option. */
    'git/bad-request': {
      readonly reason: 'path-outside-repository' | 'option-like-revision'
    }
    /** A git command this service ran exited nonzero for a reason it does not classify further. */
    'git/command-failed': {
      readonly command: string
    }
  }
}
