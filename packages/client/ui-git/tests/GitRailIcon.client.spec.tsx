// @vitest-environment jsdom
/**
 * The rail glyph's badge: the number of changed files the panel publishes, and
 * the ceiling it reads at, drawn only while the repository has changes.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GitRailIcon, type GitRailIconProps, type GitRailInjected } from '../src/client/GitRailIcon.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** The seats the frame hands this glyph, with a scripted count. */
function glyph(count: number) {
  const seats: InjectFace<GitRailInjected> & PropsLocale<'git'> = {
    useChangeCount: bindSnapshotSelector<number>({
      getSnapshot: () => count,
      subscribe: () => () => undefined,
    }),
    t: makeTranslate(zh),
  }
  return render(<GitRailIcon {...seats as GitRailIconProps} />)
}

describe('GitRailIcon', () => {
  it('draws no badge while the repository has no changes', () => {
    const { container } = glyph(0)
    expect(container.textContent).toBe('')
  })

  it('draws the changed-file count, and its ceiling', () => {
    expect(glyph(26).container.textContent).toBe('26')
    cleanup()
    // The accessible name is the localized sentence, not the bare number.
    expect(glyph(26).container.querySelector('[aria-label]')?.getAttribute('aria-label'))
      .toBe(zh['rail.count'].replace('{count}', '26'))
    cleanup()
    expect(glyph(4103).container.textContent).toBe('99+')
  })
})
