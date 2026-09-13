import { nodeWidth } from './layout'
import type { FamilyEdge, FamilyNode } from './types'

/**
 * One line per branch, not one line per record.
 *
 * When a child's two parents are a couple, both of their ParentLinks are
 * routed to the same union marker — so the graph holds two edges with the
 * same source, the same target and the same meaning, and the canvas drew
 * the identical path twice. On a fifty-person family that was thirty
 * strokes laid exactly on top of thirty others: no extra information, a
 * heavier line than intended, and twice the work.
 *
 * This collapses them at render time only. Both ParentLinks remain in the
 * graph, in the projections and in the database; what changes is how many
 * times the same branch is painted. The surviving edge keeps the id of the
 * first of them and records the ids it now stands for, so nothing
 * downstream has to guess.
 *
 * Two links are only ever collapsed when they would draw the SAME line in
 * the SAME way. A child adopted by one parent and biological to the other
 * keeps both edges, because those are two different facts drawn
 * differently, and merging them would silently drop one.
 */
export function collapseSharedDescent(edges: FamilyEdge[]): FamilyEdge[] {
  const seen = new Map<string, FamilyEdge>()
  const out: FamilyEdge[] = []

  for (const edge of edges) {
    if (edge.data?.kind !== 'parentChild') {
      out.push(edge)
      continue
    }

    // Same ends, same relationship, same label, same dash: the same line.
    const key = [
      edge.source,
      edge.target,
      edge.data.relationship,
      edge.label ?? '',
      String(edge.style?.strokeDasharray ?? ''),
    ].join(' ')

    const existing = seen.get(key)
    if (!existing) {
      const copy = { ...edge }
      seen.set(key, copy)
      out.push(copy)
      continue
    }

    // Provenance: which ParentLinks this one stroke now stands for.
    const already = Array.isArray(existing.data?.mergedParentLinkIds)
      ? (existing.data.mergedParentLinkIds as string[])
      : [existing.data?.parentLinkId as string]
    existing.data = {
      ...existing.data,
      mergedParentLinkIds: [...already, edge.data.parentLinkId],
    } as FamilyEdge['data']
  }

  return out
}


/**
 * Which side of a card the couple's bond leaves from.
 *
 * The bond is drawn partner -> marker -> partner through side handles, so
 * that it runs horizontally at the height of the portraits. That assumes
 * the marker sits BETWEEN the two, which is what the layout aims for and
 * usually achieves — but a remarriage, or a partner pulled sideways by
 * their own children, can leave the marker on the far side of somebody.
 * With fixed handles the line then doubles back and crosses straight
 * through a face.
 *
 * So the sides are chosen from where the two actually ended up. Nothing
 * moves; the line just leaves by the nearer edge and arrives at the
 * nearer edge, and a bond between two people never passes over either of
 * them.
 */
export function orientUnionSegments(edges: FamilyEdge[], nodes: FamilyNode[]): FamilyEdge[] {
  const centreX = new Map<string, number>()
  for (const node of nodes) {
    centreX.set(node.id, node.position.x + nodeWidth(node) / 2)
  }

  return edges.map((edge) => {
    if (edge.data?.kind !== 'unionSegment') return edge
    const from = centreX.get(edge.source)
    const to = centreX.get(edge.target)
    if (from === undefined || to === undefined) return edge

    const leftToRight = from <= to
    return {
      ...edge,
      sourceHandle: leftToRight ? 'right-out' : 'left-out',
      targetHandle: leftToRight ? 'left-in' : 'right-in',
    }
  })
}
