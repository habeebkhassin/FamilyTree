import type { FamilyGroup, FamilyGroupMember } from '../../types'
import { computeRanks } from './rank'
import type { FamilyEdge, FamilyGraph, FamilyGroupNode, FamilyNode } from './types'

export interface ProjectedFamilyGraph extends FamilyGraph {
  /**
   * The rank of every node in the projected graph. Real people and
   * junctions carry the rank they had in the GENEALOGY graph, unchanged —
   * see the invariant note on projectFamilyGroups.
   */
  ranks: Map<string, number>
}

/** Namespaced the same way junction ids are — a group node can never collide with a Person id. */
export function familyGroupNodeId(familyGroupId: string): string {
  return `group:${familyGroupId}`
}

/** Separator for dedupe keys. Safe because every id is a UUID or a `prefix:uuid`, neither of which contains a pipe. */
const KEY_SEPARATOR = '|'

/**
 * Projects collapsed FamilyGroups onto an already-built family graph —
 * Phase 4E-3a.
 *
 * This is a PURE transformation and the only place collapse is modelled:
 * it reads its arguments, writes nothing, and touches no storage. React
 * Flow nodes produced here are never persisted, and no ParentLink, Union,
 * Person, or FamilyGroupMember record is created, modified, or deleted by
 * collapsing. Expanding a group simply means calling this again with the
 * id removed from `collapsedGroupIds`, which restores the original graph
 * verbatim — that is why nothing about collapse needs to be stored.
 *
 * It deliberately runs AFTER buildFamilyGraph rather than inside it, so
 * the adapter (and its union-selection/junction-routing rules) stays
 * exactly as it was and keeps its own test suite valid.
 *
 * ── The absorption rule ────────────────────────────────────────────────
 * A person is absorbed into a collapsed group (i.e. hidden, and stood in
 * for by that group's node) IF AND ONLY IF they belong to exactly one
 * FamilyGroup in total and that group is collapsed.
 *
 * The consequences, which are the whole design:
 *
 *  - Internal members (all their edges stay inside the group) vanish, and
 *    so do those edges. Nothing is lost.
 *  - Boundary members (in the group, but with relationships reaching
 *    outside it) ALSO vanish, but every edge that crossed the boundary is
 *    re-pointed onto the group node, so no relationship disappears. This
 *    is what makes collapsing worth doing: in any realistically connected
 *    tree, keeping every externally-linked person visible would leave most
 *    of the group on screen and collapse nothing.
 *  - Bridge people — anyone belonging to two or more groups — are NEVER
 *    absorbed. If both their groups are collapsed there is no non-arbitrary
 *    way to choose which one swallows them, and they are precisely the
 *    person connecting the two; if one of their groups is expanded, hiding
 *    them would contradict the request to show that group's members. They
 *    stay rendered as their own PersonNode, with edges to each collapsed
 *    group they belong to. A person is never duplicated to make this work.
 *
 * ── THE RANK INVARIANT (Phase 4E-3c) ──────────────────────────────────
 * COLLAPSING OR EXPANDING A FAMILY GROUP NEVER CHANGES THE GENEALOGICAL
 * RANK OF ANY REAL PERSON.
 *
 * This is guaranteed structurally, not by tuning: ranks are computed ONCE
 * from the genealogy graph — Persons, Junctions, ParentLinks and Unions
 * only — BEFORE any group is projected, and are then carried through
 * untouched. A collapsed group's node and its boundary edges simply do
 * not exist at the moment ranks are decided, so they cannot influence
 * them. The rank of `habee` is the same number whether five groups are
 * collapsed or none, because it is literally the same computation.
 *
 * The earlier approach — projecting first and ranking the projected graph
 * — put a whole multi-generation lineage into a single node and then let
 * ordinary parent<child relaxation run over it. Real data showed the
 * damage: collapsing one group moved `shoo`/`habee` from Gen 3 to Gen 5
 * and invented a fifth generation, because the group node inherited the
 * rank forced by its deepest member and passed that on to its external
 * children. A FamilyGroup is a visualization container, not a person, so
 * it must not take part in genealogical rank propagation at all.
 *
 * Boundary edges therefore need no special `kind`: they are rank-neutral
 * because nothing ranks them. They keep their original kind purely so the
 * Phase 4D family-unit clustering can still read them for X placement.
 *
 * A collapsed group has no single generation. It is given the rank SPAN
 * of the members it absorbed (`minRank`..`maxRank`) so the canvas can draw
 * it as a container reaching across those rows, rather than flattening
 * four generations into one fake one.
 */
export function projectFamilyGroups(
  graph: FamilyGraph,
  familyGroups: FamilyGroup[],
  members: FamilyGroupMember[],
  collapsedGroupIds: ReadonlySet<string>,
  /**
   * Ranks of the underlying genealogy graph. Defaults to computing them
   * from `graph` — which is the only correct source — so a caller cannot
   * accidentally hand in ranks derived from an already-projected graph.
   */
  genealogyRanks: ReadonlyMap<string, number> = computeRanks(graph.nodes, graph.edges),
): ProjectedFamilyGraph {
  const groupById = new Map(familyGroups.map((group) => [group.id, group]))

  // --- 1. Membership index -------------------------------------------
  // Sets rather than arrays: the DB's unique [familyGroupId+personId]
  // index already rules out duplicate rows, but this function must stay
  // correct for any input it is handed, and a duplicated row would
  // otherwise inflate the membership count past 1 and wrongly spare a
  // person from absorption. Rows pointing at a group that no longer
  // exists are ignored for the same reason.
  const groupIdsByPersonId = new Map<string, Set<string>>()
  const personIdsByGroupId = new Map<string, Set<string>>()
  for (const member of members) {
    if (!groupById.has(member.familyGroupId)) continue

    const groupIds = groupIdsByPersonId.get(member.personId) ?? new Set<string>()
    groupIds.add(member.familyGroupId)
    groupIdsByPersonId.set(member.personId, groupIds)

    const personIds = personIdsByGroupId.get(member.familyGroupId) ?? new Set<string>()
    personIds.add(member.personId)
    personIdsByGroupId.set(member.familyGroupId, personIds)
  }

  /** The group a person disappears into, or undefined if they stay visible. See the absorption rule above. */
  function absorbingGroupIdFor(personId: string): string | undefined {
    const groupIds = groupIdsByPersonId.get(personId)
    // No memberships, or two-plus (a bridge) — either way, never absorbed.
    if (!groupIds || groupIds.size !== 1) return undefined
    const onlyGroupId = [...groupIds][0]
    if (onlyGroupId === undefined) return undefined
    return collapsedGroupIds.has(onlyGroupId) ? onlyGroupId : undefined
  }

  // --- 2. Junction absorption ----------------------------------------
  // A junction has no membership of its own; it inherits one only under
  // unanimity. If its partners are absorbed into two DIFFERENT groups the
  // junction survives and becomes the meeting point between them, which
  // is exactly how two collapsed families read as joined by a marriage.
  const partnerIdsByJunction = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edge.data?.kind !== 'unionSegment') continue
    const junctionId = edge.data.segment === 'a' ? edge.target : edge.source
    const partnerId = edge.data.segment === 'a' ? edge.source : edge.target
    const partners = partnerIdsByJunction.get(junctionId) ?? []
    partners.push(partnerId)
    partnerIdsByJunction.set(junctionId, partners)
  }

  function absorbingGroupIdForJunction(junctionId: string): string | undefined {
    const partners = partnerIdsByJunction.get(junctionId)
    if (!partners || partners.length === 0) return undefined
    const first = absorbingGroupIdFor(partners[0] as string)
    if (first === undefined) return undefined
    return partners.every((partnerId) => absorbingGroupIdFor(partnerId) === first) ? first : undefined
  }

  // --- 3. Representative of every node in the graph -------------------
  // The node an original node is drawn as: itself, or the group node that
  // now stands in for it.
  const representativeOf = new Map<string, string>()
  const absorbedPersonIdsByGroupId = new Map<string, string[]>()

  for (const node of graph.nodes) {
    let absorbingGroupId: string | undefined
    if (node.type === 'person') {
      absorbingGroupId = absorbingGroupIdFor(node.id)
      if (absorbingGroupId !== undefined) {
        const absorbed = absorbedPersonIdsByGroupId.get(absorbingGroupId) ?? []
        absorbed.push(node.id)
        absorbedPersonIdsByGroupId.set(absorbingGroupId, absorbed)
      }
    } else if (node.type === 'unionJunction') {
      absorbingGroupId = absorbingGroupIdForJunction(node.id)
    }

    representativeOf.set(
      node.id,
      absorbingGroupId === undefined ? node.id : familyGroupNodeId(absorbingGroupId),
    )
  }

  /** Unknown ids map to themselves so a malformed edge can never silently vanish. */
  function representative(nodeId: string): string {
    return representativeOf.get(nodeId) ?? nodeId
  }

  // --- 4. Node emission ----------------------------------------------
  // Surviving nodes keep their original object and id, in their original
  // order, so with nothing collapsed the output is identical to the input.
  const projectedNodes: FamilyNode[] = graph.nodes.filter((node) => representative(node.id) === node.id)

  // Every collapsed group gets a node, even one with nothing absorbed
  // (an empty group, or one whose members are all bridges) — it is a real
  // thing the user created, and they need something to click to expand it.
  // Sorted by id so output order never depends on the caller's array order.
  const collapsedGroups = familyGroups
    .filter((group) => collapsedGroupIds.has(group.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  // Every real node keeps the genealogical rank it already had. Nothing
  // below recomputes or adjusts them — that is the whole invariant.
  const ranks = new Map<string, number>()
  for (const node of projectedNodes) {
    const rank = genealogyRanks.get(node.id)
    if (rank !== undefined) ranks.set(node.id, rank)
  }

  for (const group of collapsedGroups) {
    const absorbedPersonIds = [...(absorbedPersonIdsByGroupId.get(group.id) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    )
    // The span of real generations this container covers. An empty group
    // (or one whose members are all bridges) absorbs nobody and has no
    // span of its own, so it sits on a single row at the top.
    const absorbedRanks = absorbedPersonIds
      .map((personId) => genealogyRanks.get(personId))
      .filter((rank): rank is number => rank !== undefined)
    const minRank = absorbedRanks.length > 0 ? Math.min(...absorbedRanks) : 0
    const maxRank = absorbedRanks.length > 0 ? Math.max(...absorbedRanks) : minRank

    const groupNode: FamilyGroupNode = {
      id: familyGroupNodeId(group.id),
      type: 'familyGroup',
      position: { x: 0, y: 0 },
      selectable: false,
      data: {
        familyGroup: group,
        memberCount: personIdsByGroupId.get(group.id)?.size ?? 0,
        absorbedPersonIds,
        minRank,
        maxRank,
      },
    }
    projectedNodes.push(groupNode)
    // Drawn from the top of its span; the container's height covers the rest.
    ranks.set(groupNode.id, minRank)
  }

  // --- 5. Edge projection --------------------------------------------
  const projectedEdges: FamilyEdge[] = []
  // Only re-pointed edges are ever merged, keyed by where they now run
  // between. Untouched edges must NOT be deduped: two ParentLinks between
  // the same pair with different relationship types (biological + adopted)
  // are two distinct records, and buildFamilyGraph's guarantee that every
  // ParentLink renders as exactly one edge has to survive this pass.
  const boundaryEdgeIndexByKey = new Map<string, number>()

  for (const edge of graph.edges) {
    const source = representative(edge.source)
    const target = representative(edge.target)

    // Both ends now resolve to the same node: the relationship is entirely
    // inside one collapsed group and has nothing left to say on screen.
    if (source === target) continue

    if (source === edge.source && target === edge.target) {
      projectedEdges.push(edge)
      continue
    }

    const key = [source, target, edge.data?.kind ?? edge.id].join(KEY_SEPARATOR)
    const existingIndex = boundaryEdgeIndexByKey.get(key)

    if (existingIndex !== undefined) {
      // Same two endpoints, same kind — e.g. both of a child's parents were
      // absorbed into one group. One line, two underlying records.
      const existing = projectedEdges[existingIndex] as FamilyEdge
      const underlying = existing.data?.underlyingEdgeIds
      if (underlying) underlying.push(edge.id)
      continue
    }

    boundaryEdgeIndexByKey.set(key, projectedEdges.length)
    projectedEdges.push({
      ...edge,
      id: `groupEdge:${key}`,
      source,
      target,
      data: edge.data && { ...edge.data, boundary: true, underlyingEdgeIds: [edge.id] },
    } as FamilyEdge)
  }

  // Stable provenance regardless of edge iteration order.
  for (const edge of projectedEdges) {
    edge.data?.underlyingEdgeIds?.sort((a, b) => a.localeCompare(b))
  }

  return { nodes: projectedNodes, edges: projectedEdges, ranks }
}
