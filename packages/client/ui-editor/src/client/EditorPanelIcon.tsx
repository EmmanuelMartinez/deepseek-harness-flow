/** The sidebar's Editor entry icon; the sidebar owns the button, its label, and its selected state around it. */

import type { ReactNode } from 'react'
import { IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the edit glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge in pixels and whether the panel is selected.
 * @returns the icon element.
 */
export function EditorPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconEditOutlineRegular size={size} />
}
