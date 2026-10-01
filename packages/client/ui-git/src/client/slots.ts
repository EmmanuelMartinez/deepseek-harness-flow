/**
 * The Git page's injected face: the registrant-private observable the renderer
 * binds to `useGitPanel`, plus the selections and the refresh verb.
 */
import type { GitPanelState } from './model.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Injected business face of the Git page. */
export interface GitPanelInjected {
  readonly hooks: {
    /** The panel's repository state. */
    readonly gitPanel: HostObservable<GitPanelState>
    /** Host-authoritative Workspace rows, so the panel can offer a picker. */
    readonly gitWorkspaces: HostObservable<WorkspaceSnapshot>
  }
  /**
   * Show another Workspace's repository.
   * @param workspaceId - Workspace to read.
   */
  readonly selectWorkspace: (workspaceId: WorkspaceId) => void
  /**
   * Read one commit's detail.
   * @param oid - commit id from the history page.
   */
  readonly selectCommit: (oid: string) => void
  /** Drop the selected commit's detail, leaving the history in place. */
  readonly clearCommit: () => void
  /**
   * Show one changed file in the right column's preview.
   * @param path - path relative to the repository root.
   */
  readonly openFile: (path: string) => void
  /** Re-read the current selection. */
  readonly refresh: () => void
}
