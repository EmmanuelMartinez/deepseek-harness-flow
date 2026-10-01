/**
 * The terminal's rail glyph: a prompt mark drawn with `currentColor`, so the
 * frame's rail can light it like any other tool.
 *
 * The guide keeps the coloured `PluginArtworkTerminal`: an illustration carries
 * its own blue, which a selected state cannot change.
 */

import type { ReactNode } from 'react'

/** The prompt glyph's edge when a caller asks for none. */
const DEFAULT_SIZE = 16

/**
 * Render the terminal prompt at the rail's requested edge.
 * @param props - the requested edge in pixels and an optional placement class.
 * @returns the glyph element.
 */
export function TerminalRailIcon({ size = DEFAULT_SIZE, className }: {
  readonly size?: number | undefined
  readonly className?: string | undefined
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2.2" stroke="currentColor" />
      <path d="M4.4 6.2L6.6 8L4.4 9.8" stroke="currentColor" />
      <path d="M7.6 10H11.2" stroke="currentColor" />
    </svg>
  )
}
