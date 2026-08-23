import type { ParentRelationship } from '../../types'
import type { FamilyEdge, FamilyGraph, FamilyNode } from './types'
import type { ProjectedFamilyView, ViewEmphasis } from './viewTypes'

/**
 * The Lineage view — Phase 5C-6.
 *
 * Answers one question and refuses to be distracted from it: where did I
 * come from? It keeps the focal person and everyone they descend from, and
 * leaves out siblings, cousins, aunts, uncles and descendants — all of whom
 * belong to My Family, not to a line of descent.
 *
 * Pure: no React, no Dexie, no storage, no clock. It reads the canonical
 * graph and a focal person id and returns a projection. It never modifies
 * genealogy and never re-ranks — canonical ranks arrive computed and leave
 * by the same reference, exactly as in the other views.
 *
 *
 * WHICH LINKS COUNT AS ANCESTRY
 * ─────────────────────────────
 * Biological and adoptive only. An adopted child's grandparents really are
 * their grandparents; walking a step link would quietly turn a step-parent's
 * mother into a plain great-grandmother, which is a claim the records do not
 * support.
 *
 * That rule already exists — relationshipResolver.ts applies exactly this set
 * when it measures lineage distance. It is restated here rather than imported
 * because it is not exported from that module, and this phase may not change
 * it. The two must stay in step; see the phase report on giving the rule a
 * single home.
 *
 * The walk reads `parentId` off the edge rather than following the edge's
 * source, so routing is irrelevant: a ParentLink whose two parents share a
 * union is drawn from their junction, but the recorded parent is still named
 * on the edge. No genealogy is re-derived here.
 */

/** Mirrors LINEAGE_SUBTYPES in relationshipResolver.ts. Keep the two in step. */
const LINEAGE_SUBTYPES: ReadonlySet<ParentRelationship> = new Set(['biological', 'adopted'])

/**
 * Generations up at which a forebear stops reading at full strength, and
 * then stops reading as a near relation at all.
 *
 * The focal person and their parents anchor the view; grandparents and
 * great-grandparents are its substance; beyond that is deep history and
 * steps back so the recent generations stay legible. Nothing is hidden by
 * these — they only set how loudly each generation is drawn.
 */
const PRIMARY_WITHIN_GENERATIONS = 1
const SECONDARY_WITHIN_GENERATIONS = 3

function emphasisForGenerationsUp(up: number): ViewEmphasis {
  if (up <= PRIMARY_WITHIN_GENERATIONS) return 'primary'
  if (up <= SECONDARY_WITHIN_GENERATIONS) return 'secondary'
  return 'context'
}

/**
 * Every forebear of the focal person, with how many generations up they
 * are. The shortest route wins where somebody is reachable by more than
 * one, which happens in families that intermarry.
 *
 * Breadth-first, O(V + E), each person settled once.
 */
export function ancestorsOf(graph: FamilyGraph, focalPersonId: string): Map<string, number> {
  const parentsOf = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const data = edge.data
    if (data?.kind !== 'parentChild') continue
    if (!LINEAGE_SUBTYPES.has(data.relationship)) continue
    const list = parentsOf.get(data.childId)
    if (list) list.push(data.parentId)
    else parentsOf.set(data.childId, [data.parentId])
  }

  const generationsUp = new Map<string, number>([[focalPersonId, 0]])
  let frontier = [focalPersonId]
  let depth = 0

  while (frontier.length > 0) {
    const next: string[] = []
    for (const personId of frontier) {
      for (const parentId of parentsOf.get(personId) ?? []) {
        if (generationsUp.has(parentId)) continue
        generationsUp.set(parentId, depth + 1)
        next.push(parentId)
      }
    }
    frontier = next
    depth += 1
  }

  return generationsUp
}

/**
 * Projects the canonical graph as the focal person's line of descent.
 *
 * Kept: the focal person, every forebear, and — for context — the union
 * junctions those forebears partnered at together with the partner on the
 * other side. Usually both of those partners are ancestors anyway; the case
 * that matters is a forebear whose spouse is not, where showing the couple
 * explains the shape of the family instead of leaving a parent standing
 * alone for no visible reason. Junctions also have to survive for their own
 * sake: a ParentLink between two partnered parents is drawn from the
 * junction, so dropping it would strand the edge.
 *
 * Everyone else — siblings, cousins, descendants, the unconnected — is
 * recorded in `hiddenNodeIds` rather than quietly dropped, so the view can
 * say the family continues beyond the frame.
 *
 * With no focal person, or one who is not in the graph, the whole graph
 * comes back untouched. An empty screen would be a worse answer than the
 * view the user already had.
 */
export function projectLineage(
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

  const generationsUp = ancestorsOf(graph, focalPersonId)

  // Partners of forebears, and the junctions joining them. Union segments
  // are the only edges that describe a partnership.
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

  const includedIds = new Set<string>(generationsUp.keys())
  const contextPartnerIds = new Set<string>()
  for (const [junctionId, partners] of partnersOfJunction) {
    // A FOREBEAR's partner, not the focal person's own. Your spouse
    // contributed nothing to where you came from, and this view is only
    // about that — they belong to My Family. So generation zero, which is
    // the focal person themselves, does not qualify a union for context.
    if (!partners.some((partnerId) => (generationsUp.get(partnerId) ?? 0) >= 1)) continue
    includedIds.add(junctionId)
    for (const partnerId of partners) {
      if (generationsUp.has(partnerId)) continue
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
    // are part of the line, so they never outrank a forebear.
    const tier = contextPartnerIds.has(node.id)
      ? 'context'
      : emphasisForGenerationsUp(generationsUp.get(node.id) ?? 0)
    // Sparse, as in the other views: an absent entry means primary.
    if (tier !== 'primary') emphasis.set(node.id, tier)
  }

  const nodes: FamilyNode[] = graph.nodes.filter((node) => includedIds.has(node.id))
  // Both ends must be present or the edge would point at nothing. The edges
  // themselves are the originals, never rebuilt.
  const edges: FamilyEdge[] = graph.edges.filter(
    (edge) => includedIds.has(edge.source) && includedIds.has(edge.target),
  )

  return {
    nodes,
    edges,
    ranks,
    emphasis,
    hiddenNodeIds,
    // Deliberately none. The household rail marks the families the focal
    // person lives among, and lineage has removed most of their members —
    // siblings, partner, children. A rail around what little remains would
    // describe half a household and read as noise in a view whose whole
    // point is one uncluttered line.
    familyUnits: new Map(),
  }
}
