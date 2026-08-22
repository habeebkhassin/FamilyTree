import { nodeWidth } from './layout'
import type { FamilyNode } from './types'

/**
 * Centring the focal person's household — Phase 5C-4.
 *
 * A uniform translation applied AFTER layout. It shifts every node by the
 * same amount, so every relative position, every gap and every edge route
 * that layout.ts worked out is preserved exactly — the family is moved as
 * one piece, not rearranged.
 *
 * That is deliberate. Phase 4D's layout already clusters couples, keeps
 * sibling sets together and pulls children toward the average x of their
 * parents; it does the spatial work well and there is no reason to
 * relitigate it here. What it has no notion of is a viewpoint, so the
 * focal household can end up anywhere across the canvas. Putting it at the
 * origin means ancestors and descendants visibly radiate from the person
 * you are standing on, and branches still spread naturally to either side.
 *
 * Nothing about generation changes: y is untouched, so ranks continue to
 * mean exactly what they meant.
 */

/** Horizontal centre of a node, accounting for the width layout gave it. */
function centreX(node: FamilyNode): number {
  return node.position.x + nodeWidth(node) / 2
}

/**
 * Translates `nodes` so that the household's centre of mass sits at x = 0.
 *
 * Falls back to the focal person alone when the household is not on
 * screen, and returns the nodes untouched when neither is — a view with
 * nobody to centre on is better left where the layout put it.
 */
export function centreOnHousehold(
  nodes: FamilyNode[],
  focalPersonId: string | null | undefined,
  householdMemberIds: ReadonlyMap<string, string> | undefined,
): FamilyNode[] {
  if (!focalPersonId || nodes.length === 0) return nodes

  const anchors = nodes.filter(
    (node) => node.id === focalPersonId || householdMemberIds?.has(node.id) === true,
  )
  // The focal person's own household is the anchor, not the whole frame:
  // centring on the graph's midpoint would drift as distant branches grow.
  const measured = anchors.length > 0 ? anchors : nodes.filter((node) => node.id === focalPersonId)
  if (measured.length === 0) return nodes

  const offset = measured.reduce((sum, node) => sum + centreX(node), 0) / measured.length
  if (offset === 0) return nodes

  return nodes.map((node) => ({
    ...node,
    position: { x: node.position.x - offset, y: node.position.y },
  }))
}
