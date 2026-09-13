import { DESCENT_RAIL_INSET, DESCENT_RAIL_STEP, DESCENT_RAIL_LEVELS } from './layout'
import type { FamilyEdge, FamilyNode } from './types'

/**
 * Keeping one family's branch from joining the next one's.
 *
 * Every edge arriving at a row puts its horizontal run at the same height
 * by default, which is exactly what makes a parent's own child edges
 * coincide into a single bracket. The same agreement between DIFFERENT
 * parents is the problem: two couples whose children sit side by side get
 * two brackets on one line, and if their spans touch at all the eye reads
 * one rule running across the tree joining families that have nothing to
 * do with each other.
 *
 * So branches that overlap horizontally are given different heights
 * within the gap between the generations. Branches that do not overlap
 * keep the same height and stay visually consistent, because there is
 * nothing for them to be confused with.
 *
 * This is the ordinary greedy colouring of overlapping intervals: sort
 * the branches across the row, and give each the lowest level no branch
 * it touches is already using. Two or three levels are almost always
 * enough for a family; beyond that the levels repeat, which is still
 * better than every branch sharing one line.
 */

/** One branch: a parent (or a couple's marker) and the children below it. */
interface Branch {
  key: string
  row: number
  left: number
  right: number
  level: number
}

export function assignDescentRails(edges: FamilyEdge[], nodes: FamilyNode[]): FamilyEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  // Gather the horizontal extent of each branch, keyed by the parent it
  // descends from and the row it lands on.
  const branches = new Map<string, Branch>()
  for (const edge of edges) {
    if (edge.data?.kind !== 'parentChild') continue
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue

    const key = `${target.position.y}:${edge.source}`
    const left = Math.min(source.position.x, target.position.x)
    const right = Math.max(source.position.x, target.position.x)
    const found = branches.get(key)
    if (!found) branches.set(key, { key, row: target.position.y, left, right, level: 0 })
    else {
      found.left = Math.min(found.left, left)
      found.right = Math.max(found.right, right)
    }
  }

  // Colour each row independently: a branch only ever has to avoid the
  // branches it shares a row with.
  const byRow = new Map<number, Branch[]>()
  for (const branch of branches.values()) {
    const list = byRow.get(branch.row) ?? []
    list.push(branch)
    byRow.set(branch.row, list)
  }

  for (const list of byRow.values()) {
    const sorted = list.sort((a, b) => a.left - b.left || (a.key < b.key ? -1 : 1))
    const placed: Branch[] = []
    for (const branch of sorted) {
      const taken = new Set(
        placed
          // Touching counts as overlapping: two brackets that merely meet
          // still read as one line.
          .filter((other) => other.right >= branch.left - RAIL_CLEARANCE)
          .map((other) => other.level),
      )
      let level = 0
      while (level < DESCENT_RAIL_LEVELS && taken.has(level)) level += 1
      branch.level = level % DESCENT_RAIL_LEVELS
      placed.push(branch)
    }
  }

  return edges.map((edge) => {
    if (edge.data?.kind !== 'parentChild') return edge
    const target = nodeById.get(edge.target)
    if (!target) return edge
    const branch = branches.get(`${target.position.y}:${edge.source}`)
    if (!branch) return edge
    return {
      ...edge,
      data: {
        ...edge.data,
        railInset: DESCENT_RAIL_INSET + branch.level * DESCENT_RAIL_STEP,
      } as FamilyEdge['data'],
    }
  })
}

/**
 * How far apart two branches must be before they are allowed to share a
 * height. A little wider than the gap the layout leaves between separate
 * family units, so "these two only just miss" still gets its own line.
 */
const RAIL_CLEARANCE = 24
