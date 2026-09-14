import type { FamilyEdge, FamilyGraph, FamilyNode } from './types'
import type { ProjectedFamilyView, ViewEmphasis } from './viewTypes'

/**
 * One family group's own tree.
 *
 * What you see after following a marriage across to the other family: the
 * people recorded as belonging to that family, drawn the way every other
 * view is drawn, by the same layout and the same renderer.
 *
 * A CAMERA, NOT A COPY. Nobody is moved, duplicated or re-parented to
 * appear here. This frames the canonical graph around one group's
 * membership and records everyone it leaves out in `hiddenNodeIds`, so
 * the tree can say honestly that the family continues past the edge of
 * the frame rather than implying it stops there.
 *
 * Ranks arrive computed and leave by the same reference, as in every
 * other projection — a view that re-ranked would put people in the wrong
 * generation the moment the frame changed.
 */

/**
 * The two people a junction marries, and only those two.
 *
 * Identified by the edge's own kind rather than by its direction: a union
 * segment runs A→junction and junction→B, so direction says nothing,
 * while the descent edge down to their children is a different kind
 * entirely. Reading direction instead of kind pulls the couple's children
 * into the frame as though they had married in.
 */
function partnersOf(node: FamilyNode, graph: FamilyGraph): string[] {
  return graph.edges
    .filter(
      (edge) =>
        (edge.source === node.id || edge.target === node.id) &&
        (edge.data as { kind?: string } | undefined)?.kind === 'unionSegment',
    )
    .map((edge) => (edge.source === node.id ? edge.target : edge.source))
    .filter((id) => !id.startsWith('junction:'))
}

/** Junctions survive when at least one partner does, so a couple keeps its bond. */
function junctionSurvives(
  node: FamilyNode,
  keptPeople: ReadonlySet<string>,
  graph: FamilyGraph,
): boolean {
  // At least one partner in the family, which keeps the marriage that
  // brought somebody in from outside it visible — that marriage is the
  // whole reason this screen exists.
  return partnersOf(node, graph).some((id) => keptPeople.has(id))
}

export function projectFamilyGroupView(
  graph: FamilyGraph,
  ranks: ReadonlyMap<string, number>,
  memberIds: ReadonlySet<string>,
  /** The partner whose marriage brought the visitor here, if any. */
  connectingPersonId?: string | null,
): Omit<ProjectedFamilyView, 'view'> {
  const keptPeople = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'person') continue
    if (memberIds.has(node.id)) keptPeople.add(node.id)
  }

  /*
    A spouse who married in is kept even though they belong to the other
    family. Dropping them would show a marriage with nobody on the far
    side of it, which is exactly the connection this screen is about.
  */
  const spouses = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'unionJunction') continue
    if (!junctionSurvives(node, keptPeople, graph)) continue
    for (const partner of partnersOf(node, graph)) {
      if (!keptPeople.has(partner)) spouses.add(partner)
    }
  }

  const visible = new Set<string>([...keptPeople, ...spouses])

  const nodes: FamilyNode[] = []
  const hiddenNodeIds = new Set<string>()
  const emphasis = new Map<string, ViewEmphasis>()

  for (const node of graph.nodes) {
    if (node.type === 'unionJunction') {
      if (junctionSurvives(node, keptPeople, graph)) nodes.push(node)
      else hiddenNodeIds.add(node.id)
      continue
    }
    if (visible.has(node.id)) {
      nodes.push(node)
      // Somebody who married in reads as context: they belong to the
      // family you came from, and this is not their tree.
      if (!keptPeople.has(node.id)) emphasis.set(node.id, 'secondary')
    } else {
      hiddenNodeIds.add(node.id)
    }
  }

  const shown = new Set(nodes.map((node) => node.id))
  const edges: FamilyEdge[] = graph.edges.filter(
    (edge) => shown.has(edge.source) && shown.has(edge.target),
  )

  // The person whose marriage is the bridge is why the visitor is here,
  // so they are not played down even if they married in.
  if (connectingPersonId && shown.has(connectingPersonId)) {
    emphasis.delete(connectingPersonId)
  }

  return { nodes, edges, ranks, emphasis, hiddenNodeIds, familyUnits: new Map() }
}
