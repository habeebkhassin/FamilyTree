import { isAncestralParentLink } from '../../lib/relationships/relationshipSemantics'
import type { FamilyEdge, FamilyGraph, FamilyNode } from './types'
import type { ProjectedFamilyView, ViewEmphasis } from './viewTypes'

/**
 * The Descendants view — Phase 5C-8.
 *
 * The mirror of Lineage, and the answer to the other half of the same
 * question. Lineage asks where did I come from; this asks WHO COMES FROM
 * ME. It keeps the focal person and everyone descended from them, and
 * leaves out parents, siblings, cousins, aunts and uncles — all of whom
 * belong to My Family rather than to a line of descent.
 *
 * Pure: no React, no Dexie, no storage, no clock. It reads the canonical
 * graph and a focal person id and returns a projection. It never modifies
 * genealogy and never re-ranks — canonical ranks arrive computed and leave
 * by the same reference, exactly as in the other views.
 *
 *
 * WHICH LINKS CARRY DESCENT
 * ─────────────────────────
 * Biological and adoptive only, which is the same rule Lineage walks
 * upward and the relationship resolver measures along. An adopted child is
 * a descendant in every sense that matters here; a step-child is not
 * somebody who came FROM you, however much they are family, and drawing
 * them as descent would make a claim the records do not contain.
 *
 * The rule is not defined here. It lives in
 * lib/relationships/relationshipSemantics.ts — see Phase 5C-7 — so the
 * two directions of the same line can never disagree about which links
 * count. A step-child excluded here still appears in My Family, which asks
 * about proximity rather than descent, and that disagreement is deliberate.
 *
 * The walk reads `parentId` and `childId` off the edge rather than
 * following the edge's source and target, so routing is irrelevant: a
 * ParentLink between two partnered parents is drawn from their junction,
 * but the recorded parent and child are still named on the edge. No
 * genealogy is re-derived here.
 *
 *
 * A MAP, NOT A CHAIN
 * ──────────────────
 * Descent fans OUT. A line of ancestors narrows to a point at the top,
 * whereas a line of descendants widens with every generation, so this is
 * the first view where several branches genuinely compete for horizontal
 * room. Nothing here orders, ranks or flattens anything — the projection
 * hands layout.ts a graph and the existing layered layout spreads sibling
 * branches across the canvas as it already does elsewhere. Turning a
 * family into a column would answer the question far worse than the
 * screen it replaced.
 */

/**
 * Generations down at which a descendant stops reading at full strength,
 * and then stops reading as a near relation at all.
 *
 * The focal person and their children anchor the view; grandchildren are
 * its supporting substance; great-grandchildren and beyond step back so
 * the near generations stay legible in a shape that keeps widening.
 * Nothing is hidden by these — they only set how loudly a generation is
 * drawn.
 *
 * Tighter than Lineage's, which reaches to great-grandparents at
 * secondary. Deliberate: ancestors halve with each generation up and
 * stay few, while descendants multiply going down, so the same numbers
 * would make a large family read as uniformly loud.
 */
const PRIMARY_WITHIN_GENERATIONS = 1
const SECONDARY_WITHIN_GENERATIONS = 2

function emphasisForGenerationsDown(down: number): ViewEmphasis {
  if (down <= PRIMARY_WITHIN_GENERATIONS) return 'primary'
  if (down <= SECONDARY_WITHIN_GENERATIONS) return 'secondary'
  return 'context'
}

/**
 * Every descendant of the focal person, with how many generations down
 * they are. The shortest route wins where somebody is reachable by more
 * than one, which happens in families that intermarry.
 *
 * Breadth-first, O(V + E), each person settled once. The focal person is
 * generation 0, their children 1, grandchildren 2, and so on.
 */
export function descendantsOf(graph: FamilyGraph, focalPersonId: string): Map<string, number> {
  const childrenOf = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const data = edge.data
    if (data?.kind !== 'parentChild') continue
    if (!isAncestralParentLink(data.relationship)) continue
    const list = childrenOf.get(data.parentId)
    if (list) list.push(data.childId)
    else childrenOf.set(data.parentId, [data.childId])
  }

  const generationsDown = new Map<string, number>([[focalPersonId, 0]])
  let frontier = [focalPersonId]
  let depth = 0

  while (frontier.length > 0) {
    const next: string[] = []
    for (const personId of frontier) {
      for (const childId of childrenOf.get(personId) ?? []) {
        if (generationsDown.has(childId)) continue
        generationsDown.set(childId, depth + 1)
        next.push(childId)
      }
    }
    frontier = next
    depth += 1
  }

  return generationsDown
}

/**
 * Projects the canonical graph as the focal person's line of descent
 * downward.
 *
 * Kept: the focal person, every descendant, and — for context — the union
 * junctions they partnered at together with the partner on the other side.
 *
 * That partner is context and never a route. Descent is only ever walked
 * through recorded parent links, so a descendant's spouse can never add
 * their own side of the family: the spouse's parents, siblings and
 * children by someone else all stay out. They are drawn so a couple reads
 * as a couple rather than leaving a parent standing alone for no visible
 * reason.
 *
 * The focal person's OWN union is included here, which is where this view
 * parts company with Lineage. There the focal person's spouse is dropped,
 * having contributed nothing to where that person came from. Here the
 * opposite holds, and structurally so: when two partnered parents share a
 * union, their children's edges are DRAWN FROM THE JUNCTION, so removing
 * it would strand every child edge and leave the descendants floating
 * unattached. The co-parent of the people this view exists to show cannot
 * be the person it omits.
 *
 * Everyone else — parents, siblings, cousins, the unconnected — is
 * recorded in `hiddenNodeIds` rather than quietly dropped, so the view can
 * say the family continues beyond the frame.
 *
 * With no focal person, or one who is not in the graph, the whole graph
 * comes back untouched. An empty screen would be a worse answer than the
 * view the user already had. A focal person with no descendants at all is
 * a different case and NOT an empty one: they are still shown, with their
 * partner beside them, which is the honest answer to the question.
 */
export function projectDescendants(
  graph: FamilyGraph,
  ranks: ReadonlyMap<string, number>,
  focalPersonId: string | null | undefined,
): Omit<ProjectedFamilyView, 'view'> {
  const focalIsPresent =
    Boolean(focalPersonId) && graph.nodes.some((node) => node.id === focalPersonId)

  if (!focalPersonId || !focalIsPresent) {
    return {
      nodes: graph.nodes,
      edges: graph.edges,
      ranks,
      emphasis: new Map(),
      hiddenNodeIds: new Set(),
      familyUnits: new Map(),
    }
  }

  const generationsDown = descendantsOf(graph, focalPersonId)

  // Partners, and the junctions joining them. Union segments are the only
  // edges that describe a partnership.
  const partnersOfJunction = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const data = edge.data
    if (data?.kind !== 'unionSegment') continue
    const junctionId = data.segment === 'a' ? edge.target : edge.source
    const partnerId = data.segment === 'a' ? edge.source : edge.target
    const list = partnersOfJunction.get(junctionId)
    if (list) list.push(partnerId)
    else partnersOfJunction.set(junctionId, [partnerId])
  }

  const includedIds = new Set<string>(generationsDown.keys())
  const contextPartnerIds = new Set<string>()
  for (const [junctionId, partners] of partnersOfJunction) {
    // Generation zero qualifies, unlike in Lineage: the focal person's own
    // union is the point the children hang off, so it has to survive.
    if (!partners.some((partnerId) => generationsDown.has(partnerId))) continue
    includedIds.add(junctionId)
    for (const partnerId of partners) {
      if (generationsDown.has(partnerId)) continue
      includedIds.add(partnerId)
      contextPartnerIds.add(partnerId)
    }
  }

  const emphasis = new Map<string, ViewEmphasis>()
  const hiddenNodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (!includedIds.has(node.id)) {
      hiddenNodeIds.add(node.id)
      continue
    }
    // A married-in partner is here to explain a couple, not because they
    // are descended from anyone, so they never outrank a descendant.
    const tier = contextPartnerIds.has(node.id)
      ? 'context'
      : emphasisForGenerationsDown(generationsDown.get(node.id) ?? 0)
    // Sparse, as in the other views: an absent entry means primary.
    if (tier !== 'primary') emphasis.set(node.id, tier)
  }

  const nodes: FamilyNode[] = graph.nodes.filter((node) => includedIds.has(node.id))
  // Both ends must be present or the edge would point at nothing. The edges
  // themselves are the originals, never rebuilt. This is also what keeps a
  // step-child out: their parent link is drawn from the same junction as
  // their half-siblings, but they are not in `includedIds`, so the edge
  // goes with them.
  const edges: FamilyEdge[] = graph.edges.filter(
    (edge) => includedIds.has(edge.source) && includedIds.has(edge.target),
  )

  return {
    nodes,
    edges,
    ranks,
    emphasis,
    hiddenNodeIds,
    // Deliberately none, as in Lineage. The household rail marks the
    // families the focal person lives among, and this view has removed
    // most of one of them — their parents and siblings. A rail here would
    // also compete with the Family Groups that do belong on this canvas.
    familyUnits: new Map(),
  }
}
