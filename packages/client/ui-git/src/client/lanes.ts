/**
 * Graph lane assignment for one history page.
 *
 * A lane holds the commit id it is waiting for and the line it belongs to, so a
 * line keeps its colour from the tip that started it down to where it merges.
 * Walking the page newest first, a commit takes the lane already waiting for it
 * or a free one, merges away the lanes that waited for it, and leaves its first
 * parent in its own lane while later parents take further lanes.
 *
 * The output is display geometry only: it needs the page's commits and their
 * parents, no repository access.
 */
import type { GitCommitView } from '@deepseek-ai/dsh-api-remotes/client'

/** Palette entries a graph line can take; the stylesheet maps each index to a theme token. */
export const LANE_COLORS = 5

/** One rail a row draws for a lane that carries history through it. */
export interface GraphRail {
  /** Lane column, 0-based from the left. */
  readonly lane: number
  /** Palette index, stable for as long as the line holds together. */
  readonly color: number
  /** Where the rail starts in the row's 28px box: 0 from the row above, 14 at this commit. */
  readonly from: number
  /** Where the rail ends: 14 at this commit, 28 continuing into the row below. */
  readonly to: number
}

/** One history row with the geometry the graph gutter draws. */
export interface GraphRow {
  readonly commit: GitCommitView
  /** Lane the commit's dot occupies. */
  readonly lane: number
  /** Lanes this row draws, ascending, including the commit's own. */
  readonly rails: readonly GraphRail[]
  /** Palette index of the commit's own line. */
  readonly color: number
}

/** One lane slot: the commit it waits for and the line it belongs to. */
interface Lane {
  readonly oid: string
  readonly line: string
}

/** One lane's identity at a moment in the walk: where it sits and which colour it carries. */
interface LaneMark {
  readonly lane: number
  readonly color: number
}

/**
 * Assign a lane and a colour to every commit of one page.
 * @param commits - commits in the order the history walk returned them, newest first.
 * @returns one row per commit, in the same order.
 */
export function assignLanes(commits: readonly GitCommitView[]): GraphRow[] {
  const waiting: Array<Lane | undefined> = []
  const colors = new Map<string, number>()
  const colorOf = (line: string): number => {
    const known = colors.get(line)
    if (known !== undefined) return known
    const next = colors.size % LANE_COLORS
    colors.set(line, next)
    return next
  }
  const snapshot = (): Array<LaneMark | undefined> =>
    waiting.map((entry, index) => entry === undefined ? undefined : { lane: index, color: colorOf(entry.line) })
  const rows: GraphRow[] = []
  for (const commit of commits) {
    let lane = waiting.findIndex(entry => entry?.oid === commit.oid)
    if (lane === -1) {
      const free = waiting.indexOf(undefined)
      lane = free === -1 ? waiting.length : free
      waiting[lane] = { oid: commit.oid, line: commit.oid }
    }
    const own = waiting[lane]
    if (own === undefined) continue
    // Rails from above are captured before the merge clears them: a lane that
    // closes at this row still has to reach its dot. The page's newest row has
    // no row above it, so its lines start at its own dot.
    const incoming = rows.length === 0 ? [] : snapshot()
    // Lanes that were also waiting for this commit merge into the one drawn.
    for (let index = 0; index < waiting.length; index += 1) {
      if (index !== lane && waiting[index]?.oid === commit.oid) waiting[index] = undefined
    }
    const [first, ...rest] = commit.parents
    waiting[lane] = first === undefined ? undefined : { oid: first, line: own.line }
    for (const parent of rest) {
      if (waiting.some(entry => entry?.oid === parent)) continue
      const free = waiting.indexOf(undefined)
      const next = { oid: parent, line: parent }
      if (free === -1) waiting.push(next)
      else waiting[free] = next
    }
    while (waiting.length > 0 && waiting[waiting.length - 1] === undefined) waiting.pop()
    const outgoing = snapshot()
    const width = Math.max(incoming.length, outgoing.length, lane + 1)
    const rails: GraphRail[] = []
    for (let index = 0; index < width; index += 1) {
      const above = incoming[index]
      const below = outgoing[index]
      const rail = below ?? above
      if (rail === undefined) continue
      rails.push({
        lane: index,
        color: rail.color,
        from: above === undefined ? 14 : 0,
        to: below === undefined ? 14 : 28,
      })
    }
    rows.push({ commit, lane, rails, color: colorOf(own.line) })
  }
  return rows
}
