/**
 * The Source control entry on the frame's right rail: the branch glyph with the
 * number of changed files beside it.
 *
 * The frame owns the button and its label; this glyph adds the one fact the
 * panel cannot show while it is closed.
 */
import type { ReactNode } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GitPage.module.css'

/** What this glyph reads beyond the frame's own share. */
export interface GitRailInjected {
  readonly hooks: {
    /** Changed files as the panel last read them. */
    readonly changeCount: HostObservable<number>
  }
}

/** Counts above this many changes read as that ceiling. */
const BADGE_CEILING = 99

/** Full component props assembled by the frame's rail renderer. */
export type GitRailIconProps =
  PropsRuntime<'rightrail'>
  & PropsLocale<'git'>
  & InjectFace<GitRailInjected>

/**
 * Render the branch glyph and, when the repository has changes, their count.
 * @param props - the rail's icon edge, the shared count, and the translator.
 * @returns the glyph with its badge.
 */
export function GitRailIcon({ size, useChangeCount, t }: GitRailIconProps): ReactNode {
  const count = useChangeCount(value => value)
  return (
    <span className={css.railIcon}>
      <IconBranchOutlineRegular size={size} />
      {count > 0 && (
        <span className={css.railBadge} aria-label={t('rail.count', { count })}>
          {count > BADGE_CEILING ? `${BADGE_CEILING}+` : count}
        </span>
      )}
    </span>
  )
}
