/**
 * Graph lane and colour assignment: a linear history, a merge that opens and
 * closes a line, and a page that starts mid-history. The algorithm reads only a
 * page's commits and their parents, so a fixture is the whole input.
 */
import { describe, expect, it } from 'vitest'
import type { GitCommitView } from '@deepseek-ai/dsh-api-remotes/client'
import { LANE_COLORS, assignLanes } from '../src/client/lanes.ts'

/** One commit fixture: id, parents, and nothing else the lanes read. */
function commit(oid: string, parents: string[] = []): GitCommitView {
  return { oid, parents, subject: oid, authorName: 'a', authorEmail: 'a@b', authoredAt: '', refs: [] }
}

describe('assignLanes', () => {
  it('keeps a linear history in one lane of one colour, ending at the root dot', () => {
    const rows = assignLanes([commit('c', ['b']), commit('b', ['a']), commit('a')])
    expect(rows.map(row => row.lane)).toEqual([0, 0, 0])
    expect(rows.map(row => row.rails.map(rail => rail.lane))).toEqual([[0], [0], [0]])
    expect(new Set(rows.map(row => row.color)).size).toBe(1)
    expect(rows[0]?.rails[0]).toMatchObject({ from: 14, to: 28 })
    expect(rows[2]?.rails[0]).toMatchObject({ from: 0, to: 14 })
  })

  it('opens a second line for a second parent and closes it where the branches meet', () => {
    const rows = assignLanes([
      commit('m', ['p', 's']),
      commit('p', ['a']),
      commit('s', ['a']),
      commit('a'),
    ])
    expect(rows.map(row => row.lane)).toEqual([0, 0, 1, 0])
    expect(rows[0]?.rails.map(rail => rail.lane)).toEqual([0, 1])
    // The merge's new line takes a colour of its own from the row it opens in.
    expect(rows[0]?.rails[1]?.color).not.toBe(rows[0]?.rails[0]?.color)
    expect(rows[0]?.rails[1]).toMatchObject({ from: 14, to: 28 })
    // Its colour is stable while the line runs.
    expect(rows[2]?.color).toBe(rows[0]?.rails[1]?.color)
    // Both lines reach the commit that closes them, and neither continues below.
    expect(rows[3]?.rails.map(rail => rail.to)).toEqual([14, 14])
  })

  it('gives the newest row no line from above', () => {
    const rows = assignLanes([commit('x', ['y']), commit('y')])
    expect(rows[0]?.rails[0]).toMatchObject({ from: 14, to: 28 })
  })

  it('deduplicates a parent two lanes already wait for', () => {
    const rows = assignLanes([commit('m', ['a', 'a']), commit('a')])
    expect(rows[0]?.rails.map(rail => rail.lane)).toEqual([0])
    expect(rows[1]?.lane).toBe(0)
  })

  it('never leaves the palette', () => {
    // A page whose lanes open together: every colour index stays within the palette.
    const rows = assignLanes([commit('m', ['a', 'b', 'c', 'd', 'e', 'f', 'g'])])
    expect(rows[0]?.rails.every(rail => rail.color >= 0 && rail.color < LANE_COLORS)).toBe(true)
  })
})
