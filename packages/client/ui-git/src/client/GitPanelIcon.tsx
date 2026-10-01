/** The sidebar's Git entry icon; the sidebar owns the button, its label, and its selected state around it. */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the branch glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge in pixels and whether the panel is selected.
 * @returns the icon element.
 */
export function GitPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconBranchOutlineRegular size={size} />
}
