import type { FamilyEdge } from './types'
import type { ProjectedFamilyView, ViewEmphasis } from './viewTypes'
import { emphasisFor } from './viewProjection'

/**
 * Turning emphasis into visual weight — Phase 5C-3.
 *
 * Pure: takes the edges and the view's emphasis map, returns restyled
 * edges. No React, no layout, no genealogy. Applied at render time exactly
 * as the boundary-edge styling already was, so nothing here reaches the
 * adapter, the ranks, or the positions — the same tree is drawn, with the
 * part you are standing in brought forward.
 *
 *
 * WHY WEIGHT AND NOT COLOUR
 * ─────────────────────────
 * The tree was hard to read not because it lacked colours but because
 * everything was drawn at the same strength: every card identical, every
 * edge 1.5px of the same grey. With nothing louder than anything else the
 * eye has nowhere to start.
 *
 * So the hierarchy is built from opacity, stroke weight and card contrast
 * — properties that stack with the existing palette instead of competing
 * with it. Adding a fourth and fifth colour would have made the canvas
 * busier while still leaving no focal point.
 *
 *
 * WHY UNIONS ARE DRAWN HEAVIER THAN DESCENT
 * ─────────────────────────────────────────
 * A parent-child edge and a marriage edge previously looked identical
 * whenever the common case applied — biological child, married couple —
 * which is most of a real tree. Two different kinds of fact drawn the same
 * way is the reason connections were hard to follow.
 *
 * A union is now a visibly heavier, shorter bond between two people on one
 * row; descent stays a lighter line falling between rows. That reads as
 * "these two are together, and this line goes down to their children"
 * without a legend, and it holds up when the labels are too small to read.
 */

/** Opacity per tier. The floor stays legible rather than hiding anyone. */
const NODE_OPACITY: Record<ViewEmphasis, number> = {
  primary: 1,
  secondary: 0.78,
  context: 0.55,
}

const EDGE_OPACITY: Record<ViewEmphasis, number> = {
  primary: 1,
  secondary: 0.6,
  context: 0.32,
}

/**
 * A union bond is heavier than a line of descent, at every tier.
 *
 * `primary` deliberately matches the 1.5px the adapter has always used, so
 * a tree with nobody focused is drawn exactly as it was before this phase.
 * All the contrast is bought by making unions heavier and distant kin
 * lighter, not by thickening what was already there.
 */
const PARENT_CHILD_WIDTH: Record<ViewEmphasis, number> = {
  primary: 1.5,
  secondary: 1.2,
  context: 1,
}

const UNION_WIDTH: Record<ViewEmphasis, number> = {
  primary: 3,
  secondary: 2.2,
  context: 1.6,
}

const TIER_ORDER: Record<ViewEmphasis, number> = { primary: 0, secondary: 1, context: 2 }

export function nodeOpacityFor(emphasis: ViewEmphasis): number {
  return NODE_OPACITY[emphasis]
}

/**
 * An edge is drawn at the strength of its QUIETER end.
 *
 * A line from the focal person out to a distant cousin belongs to the
 * distance, not to the focus: letting the louder end win would draw bright
 * spokes radiating into the background and undo the hierarchy.
 */
export function edgeEmphasis(edge: FamilyEdge, view: ProjectedFamilyView): ViewEmphasis {
  const source = emphasisFor(view, edge.source)
  const target = emphasisFor(view, edge.target)
  return TIER_ORDER[source] >= TIER_ORDER[target] ? source : target
}

/**
 * Restyles every edge for the current view.
 *
 * Absorbs the boundary-edge treatment that used to live in the canvas. A
 * boundary edge stands for a relationship belonging to someone inside a
 * collapsed group, not to the group itself — so it is drawn in the same
 * vocabulary as the real edge it came from, just quieter, halved in
 * opacity on top of whatever tier it is in. Deliberately no label: Phase
 * 4D removed per-instance edge text because it became noise.
 *
 * Its routing is still forced to smoothstep. A union segment is normally a
 * short straight line between two partners standing side by side, but once
 * one of them is absorbed the other end can be most of the canvas away,
 * and a straight line across that distance reads as a long diagonal slash
 * through unrelated people. Orthogonal routing keeps it in the same
 * right-angled language as every other edge — React Flow's own edge type,
 * no custom router, and it touches neither the relationship nor its rank.
 */
export function styleEdgesForView(edges: FamilyEdge[], view: ProjectedFamilyView): FamilyEdge[] {
  return edges.map((edge) => {
    const tier = edgeEmphasis(edge, view)
    const isUnion = edge.data?.kind === 'unionSegment'
    const width = isUnion ? UNION_WIDTH[tier] : PARENT_CHILD_WIDTH[tier]
    const opacity = EDGE_OPACITY[tier] * (edge.data?.boundary ? 0.5 : 1)

    return {
      ...edge,
      // Boundary edges keep the softened routing they already had.
      ...(edge.data?.boundary ? { type: 'smoothstep' as const } : {}),
      style: {
        ...edge.style,
        strokeWidth: width,
        opacity,
      },
    }
  })
}
