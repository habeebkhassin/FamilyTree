import type { FamilyEdge, FamilyNode } from './types'

/**
 * Deterministic rank (generation) assignment, computed purely from the
 * already-built React Flow graph shape (never from raw Dexie records) —
 * this is what feeds ELK's partitioning, so ELK's own automatic layered
 * ranking (which has no concept of "these two nodes must share a rank")
 * never gets the final say on generation placement.
 *
 * Two structural rules:
 *   - parentChild edge: target's rank must be strictly greater than
 *     source's rank (a child is one generation below its parent, or
 *     below the Union junction standing in for both parents).
 *   - unionSegment edge: source and target must share the SAME rank
 *     (a partner and their Union's junction are peers, not parent/child).
 *
 * Implementation: union-find groups every node connected purely by
 * unionSegment edges into one same-rank class. This correctly chains
 * through remarriage too — if A has separate Unions with both B and C,
 * A/B/C and both junctions all land in one class, which matches how
 * genealogy charts conventionally draw a person's current and former
 * partners on the same row as them and each other.
 *
 * A bounded Bellman-Ford-style relaxation over parentChild edges (by
 * class) then computes the longest path from every root — "parent rank
 * < child rank". The relaxation is capped at `nodes.length` iterations,
 * so even a malformed/cyclic input (Phase 3 already rejects ParentLink
 * cycles among people, but this function makes no assumption about
 * that) can never loop forever; it just stops refining. Rank values are
 * a fixed point of the constraints, independent of edge iteration order
 * — so this is deterministic regardless of array ordering.
 */
export function computeRanks(nodes: FamilyNode[], edges: FamilyEdge[]): Map<string, number> {
  const parent = new Map<string, string>()
  for (const node of nodes) parent.set(node.id, node.id)

  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) {
      root = parent.get(root) as string
    }
    let current = id
    while (parent.get(current) !== root) {
      const next = parent.get(current) as string
      parent.set(current, root)
      current = next
    }
    return root
  }

  function union(a: string, b: string): void {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  for (const edge of edges) {
    if (edge.data?.kind === 'unionSegment') {
      union(edge.source, edge.target)
    }
  }

  const parentChildEdges = edges.filter((edge) => edge.data?.kind === 'parentChild')

  const groupRank = new Map<string, number>()
  for (const node of nodes) groupRank.set(find(node.id), 0)

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let changed = false
    for (const edge of parentChildEdges) {
      const sourceGroup = find(edge.source)
      const targetGroup = find(edge.target)
      if (sourceGroup === targetGroup) continue
      const candidateRank = (groupRank.get(sourceGroup) ?? 0) + 1
      if (candidateRank > (groupRank.get(targetGroup) ?? 0)) {
        groupRank.set(targetGroup, candidateRank)
        changed = true
      }
    }
    if (!changed) break
  }

  const rankByNodeId = new Map<string, number>()
  for (const node of nodes) {
    rankByNodeId.set(node.id, groupRank.get(find(node.id)) ?? 0)
  }
  return rankByNodeId
}
