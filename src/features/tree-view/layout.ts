import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api'
import type { FamilyEdge, FamilyNode } from './types'

const elk = new ELK()

const PERSON_NODE_WIDTH = 160
const PERSON_NODE_HEIGHT = 72
const JUNCTION_NODE_SIZE = 14
/**
 * Wider than a person card (it holds a name plus a meta line), but
 * deliberately the SAME height — row geometry, and therefore the
 * generation bands derived from it, must stay unchanged whether a group
 * is collapsed or not.
 */
const FAMILY_GROUP_NODE_WIDTH = 200
const LAYER_SPACING = 90
const ROW_HEIGHT = PERSON_NODE_HEIGHT + LAYER_SPACING

/** Node types are sized explicitly — a type this doesn't know about would otherwise silently inherit person dimensions. */
function nodeWidthFor(node: FamilyNode): number {
  if (node.type === 'unionJunction') return JUNCTION_NODE_SIZE
  if (node.type === 'familyGroup') return FAMILY_GROUP_NODE_WIDTH
  return PERSON_NODE_WIDTH
}

function nodeHeightFor(node: FamilyNode): number {
  if (node.type === 'unionJunction') return JUNCTION_NODE_SIZE
  if (node.type === 'familyGroup') return familyGroupNodeHeight(node.data.minRank, node.data.maxRank)
  return PERSON_NODE_HEIGHT
}

/**
 * A collapsed group is drawn as a container reaching from the top of its
 * shallowest member's row to the bottom of its deepest one — so a family
 * spanning four generations looks like it spans four generations, instead
 * of being flattened onto a single fake row.
 */
export function familyGroupNodeHeight(minRank: number, maxRank: number): number {
  return (Math.max(maxRank, minRank) - minRank) * ROW_HEIGHT + PERSON_NODE_HEIGHT
}

/** Gap between two nodes that belong to the same family unit (siblings, or a partner beside their union junction). */
const SAME_UNIT_GAP = 20
/** Gap between two different family units/branches in the same row. */
const CROSS_UNIT_GAP = 64

/**
 * Genealogy-aware layout — Phase 4D.
 *
 * Phase 4B/4C already established that Y must come from our own rank
 * computation, never ELK's. Phase 4D adds the other half: X must reflect
 * FAMILY STRUCTURE, not ELK's raw node order — which was computed under
 * ELK's own (wrong, by Phase 4B's own findings) automatic y-layering,
 * and has no notion of "these three people are a family unit" at all.
 *
 * Root cause, confirmed against the real "abi" data before writing this:
 * a row can contain a dozen+ nodes (13 in the real Gen 3) that are
 * flatly, uniformly spaced regardless of which parent/junction they
 * belong to — producing both the excessive horizontal spread and the
 * long edges (a child's X was essentially arbitrary relative to its
 * parents' X, so the connecting edge could span most of the canvas).
 *
 * Fix, applied per row, top-down (each row depends on the row above's
 * FINAL positions, so rows are processed in ascending rank order):
 *
 *   1. Union-find merges every node connected by a Union-segment edge
 *      into one cluster (partnerA + junction + partnerB) — and, for a
 *      person with multiple unions in the same row (remarriage at one
 *      generation depth), this transitively merges both marriages into
 *      one cluster, since the shared person is a member of both.
 *   2. A child's position pulls toward the AVERAGE center-x of ALL of
 *      their recorded parents that have already been placed (row
 *      above) — not just one arbitrarily-picked parent. This is what
 *      directly shortens edges like habee's, who has two recorded
 *      parents (khassin, sheeba) with no Union between them: habee now
 *      lands between them instead of wherever ELK's unrelated ordering
 *      put it.
 *   3. Clusters are ordered left-to-right by that same parent-average
 *      signal (falling back to ELK's x only when no parent position is
 *      resolvable, e.g. the top generation, or a married-in partner with
 *      no recorded parents of their own).
 *   4. Spacing is NOT a single constant: SAME_UNIT_GAP within a cluster,
 *      CROSS_UNIT_GAP between clusters/branches — family-aware spacing
 *      rather than a blanket reduction, so cohesive units visibly
 *      tighten while unrelated branches stay clearly separated.
 *
 * ELK is still run once, over the full graph including Union edges —
 * it remains genuinely useful for the top generation's initial order and
 * as a fallback signal for any node with no resolvable family anchor,
 * and its component-separation still keeps disconnected branches apart.
 * What changed is that ELK's x is now a FALLBACK/tiebreak, never the
 * primary signal, for any node whose family position we can derive
 * ourselves.
 */
export async function layoutFamilyGraph(
  nodes: FamilyNode[],
  edges: FamilyEdge[],
  /**
   * Ranks to lay out with — REQUIRED, and deliberately so.
   *
   * These must be the ranks of the GENEALOGY graph, computed before any
   * family group was projected (projectFamilyGroups returns exactly that,
   * carried through untouched). Layout must never derive them itself:
   * ranking an already-projected graph is precisely the mistake that let
   * a collapsed multi-generation container drag outside people into other
   * generations, and an optional parameter with an internal fallback
   * would let a future caller reintroduce it silently. Making it required
   * turns that into a compile error instead of a subtle visual bug.
   */
  ranks: ReadonlyMap<string, number>,
): Promise<FamilyNode[]> {
  if (nodes.length === 0) return []
  const widthByNodeId = new Map(nodes.map((node) => [node.id, nodeWidthFor(node)]))

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_SPACING),
      'elk.spacing.nodeNode': String(CROSS_UNIT_GAP),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: widthByNodeId.get(node.id) ?? PERSON_NODE_WIDTH,
      height: nodeHeightFor(node),
    })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
  const layouted = await elk.layout(elkGraph)
  const elkXById = new Map<string, number>()
  for (const child of layouted.children ?? []) elkXById.set(child.id, child.x ?? 0)

  // Every recorded parent source for a child (a child can have more than
  // one, and they need not share a Union — see habee/shoo in the real
  // data) — used to pull a child toward the average of its parents.
  const parentAnchorIdsByChild = new Map<string, string[]>()
  // Each junction's two partner ids, in either segment order.
  const partnerIdsByJunction = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.data?.kind === 'parentChild') {
      const list = parentAnchorIdsByChild.get(edge.target) ?? []
      list.push(edge.source)
      parentAnchorIdsByChild.set(edge.target, list)
    } else if (edge.data?.kind === 'unionSegment') {
      const junctionId = edge.data.segment === 'a' ? edge.target : edge.source
      const partnerId = edge.data.segment === 'a' ? edge.source : edge.target
      const list = partnerIdsByJunction.get(junctionId) ?? []
      list.push(partnerId)
      partnerIdsByJunction.set(junctionId, list)
    }
  }

  const nodesByRank = new Map<number, FamilyNode[]>()
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0
    const row = nodesByRank.get(rank) ?? []
    row.push(node)
    nodesByRank.set(rank, row)
  }
  const sortedRanks = [...nodesByRank.keys()].sort((a, b) => a - b)

  const finalX = new Map<string, number>()
  const finalCenterX = new Map<string, number>()
  /** Columns claimed by multi-row group containers, so lower rows can step around them. */
  const spanReservations: { minRank: number; maxRank: number; left: number; right: number }[] = []

  function resolveParentAverageX(personId: string): number | undefined {
    const anchors = parentAnchorIdsByChild.get(personId)
    if (!anchors || anchors.length === 0) return undefined
    const resolved = anchors.map((id) => finalCenterX.get(id)).filter((x): x is number => x !== undefined)
    if (resolved.length === 0) return undefined
    return resolved.reduce((sum, x) => sum + x, 0) / resolved.length
  }

  for (const rank of sortedRanks) {
    const rowNodes = nodesByRank.get(rank) ?? []
    const rowIds = new Set(rowNodes.map((node) => node.id))

    // --- 1. Union-find: merge nodes connected by a Union edge into clusters ---
    const clusterParent = new Map<string, string>()
    for (const node of rowNodes) clusterParent.set(node.id, node.id)
    function find(id: string): string {
      let root = id
      while (clusterParent.get(root) !== root) root = clusterParent.get(root) as string
      let current = id
      while (clusterParent.get(current) !== root) {
        const next = clusterParent.get(current) as string
        clusterParent.set(current, root)
        current = next
      }
      return root
    }
    function mergeCluster(a: string, b: string): void {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) clusterParent.set(rootA, rootB)
    }
    for (const node of rowNodes) {
      if (node.type !== 'unionJunction') continue
      for (const partnerId of partnerIdsByJunction.get(node.id) ?? []) {
        if (rowIds.has(partnerId)) mergeCluster(node.id, partnerId)
      }
    }
    // Siblings cluster together too, even when their shared parent(s)
    // aren't themselves Union-connected (e.g. two directly-recorded
    // parents with no recorded Union between them) — without this, full
    // and half siblings would each land in their own singleton cluster
    // and get the wide cross-branch gap from each other despite sharing
    // a parent.
    const rowIdsByParentAnchor = new Map<string, string[]>()
    for (const node of rowNodes) {
      if (node.type !== 'person') continue
      for (const anchorId of parentAnchorIdsByChild.get(node.id) ?? []) {
        const siblings = rowIdsByParentAnchor.get(anchorId) ?? []
        siblings.push(node.id)
        rowIdsByParentAnchor.set(anchorId, siblings)
      }
    }
    for (const siblingIds of rowIdsByParentAnchor.values()) {
      for (let i = 1; i < siblingIds.length; i += 1) {
        mergeCluster(siblingIds[0] as string, siblingIds[i] as string)
      }
    }

    // --- 2. Local key per node: children pull toward their parents' average x; junctions pull toward their partners' average key ---
    const localKey = new Map<string, number>()
    for (const node of rowNodes) {
      // Everything except a junction is pulled toward its parents — a
      // collapsed group node inherits the same treatment as a person, so
      // it lands under whoever its members descend from rather than
      // wherever ELK's unrelated ordering happened to put it. No-op when
      // nothing is collapsed.
      if (node.type !== 'unionJunction') {
        localKey.set(node.id, resolveParentAverageX(node.id) ?? elkXById.get(node.id) ?? 0)
      }
    }
    for (const node of rowNodes) {
      if (node.type !== 'unionJunction') continue
      const allPartners = partnerIdsByJunction.get(node.id) ?? []
      const partners = allPartners.filter((id) => rowIds.has(id))
      if (partners.length > 0) {
        const avg = partners.reduce((sum, id) => sum + (localKey.get(id) ?? elkXById.get(id) ?? 0), 0) / partners.length
        localKey.set(node.id, avg)
        continue
      }
      // No partner on this row. Normally impossible — rank.ts puts
      // partners and their junction on the same rank — but a collapsed
      // group container is drawn at the top of its span, so a junction
      // joining two collapsed families can end up a row or more below
      // both of them. Pull it toward wherever those containers were
      // actually placed instead of stranding it on ELK's unrelated x,
      // which otherwise flings it to the far side of the graph.
      const placedPartnerXs = allPartners
        .map((id) => finalCenterX.get(id))
        .filter((x): x is number => x !== undefined)
      localKey.set(
        node.id,
        placedPartnerXs.length > 0
          ? placedPartnerXs.reduce((sum, x) => sum + x, 0) / placedPartnerXs.length
          : (elkXById.get(node.id) ?? 0),
      )
    }

    // --- 3. Group into clusters, compute each cluster's row-level sort key ---
    const clusters = new Map<string, FamilyNode[]>()
    for (const node of rowNodes) {
      const root = find(node.id)
      const members = clusters.get(root) ?? []
      members.push(node)
      clusters.set(root, members)
    }

    const clusterEntries = [...clusters.values()].map((members) => {
      const resolvedMemberKeys = members
        .filter((member) => member.type !== 'unionJunction')
        .map((member) => resolveParentAverageX(member.id))
        .filter((x): x is number => x !== undefined)
      const sortKey =
        resolvedMemberKeys.length > 0
          ? resolvedMemberKeys.reduce((sum, x) => sum + x, 0) / resolvedMemberKeys.length
          : // Falls back to each member's own local key, which already
            // degrades to ELK's x when nothing better is known — so this
            // is unchanged behaviour except for a junction that learned
            // its position from collapsed partners above it.
            members.reduce((sum, member) => sum + (localKey.get(member.id) ?? elkXById.get(member.id) ?? 0), 0) /
            members.length
      const tiebreak = members.reduce((sum, member) => sum + (elkXById.get(member.id) ?? 0), 0) / members.length
      const ordered = [...members].sort((a, b) => (localKey.get(a.id) ?? 0) - (localKey.get(b.id) ?? 0))
      return { sortKey, tiebreak, members: ordered }
    })
    clusterEntries.sort((a, b) => (a.sortKey !== b.sortKey ? a.sortKey - b.sortKey : a.tiebreak - b.tiebreak))

    // --- 4. Assign cumulative x: SAME_UNIT_GAP within a cluster, CROSS_UNIT_GAP between clusters ---
    // A collapsed group container occupies several rows at once, so the
    // rows it reaches into must step around the column it already claimed
    // in the row where it was placed. Rows are processed top-down, so a
    // container's column is always known before the rows below need it.
    const bandsInThisRow = spanReservations.filter(
      (reservation) => reservation.minRank < rank && reservation.maxRank >= rank,
    )
    // Clears by SAME_UNIT_GAP rather than the full cross-branch gap so a
    // narrow node can still settle in the space BETWEEN two containers —
    // which is exactly where the junction joining two collapsed families
    // belongs. Anything too wide to fit there simply collides again on the
    // next pass and keeps moving right.
    function skipReservedColumns(candidateX: number, width: number): number {
      let x = candidateX
      let movedThisPass = true
      while (movedThisPass) {
        movedThisPass = false
        for (const band of bandsInThisRow) {
          if (x < band.right && x + width > band.left) {
            x = band.right + SAME_UNIT_GAP
            movedThisPass = true
          }
        }
      }
      return x
    }

    let cursorX = 0
    let isFirstCluster = true
    for (const cluster of clusterEntries) {
      if (!isFirstCluster) cursorX += CROSS_UNIT_GAP
      let isFirstMember = true
      for (const member of cluster.members) {
        if (!isFirstMember) cursorX += SAME_UNIT_GAP
        const width = widthByNodeId.get(member.id) ?? PERSON_NODE_WIDTH
        cursorX = skipReservedColumns(cursorX, width)
        finalX.set(member.id, cursorX)
        finalCenterX.set(member.id, cursorX + width / 2)
        if (member.type === 'familyGroup' && member.data.maxRank > member.data.minRank) {
          spanReservations.push({
            minRank: member.data.minRank,
            maxRank: member.data.maxRank,
            left: cursorX,
            right: cursorX + width,
          })
        }
        cursorX += width
        isFirstMember = false
      }
      isFirstCluster = false
    }
  }

  return nodes.map((node) => ({
    ...node,
    position: { x: finalX.get(node.id) ?? 0, y: (ranks.get(node.id) ?? 0) * ROW_HEIGHT },
  })) as FamilyNode[]
}

export const PERSON_NODE_SIZE = { width: PERSON_NODE_WIDTH, height: PERSON_NODE_HEIGHT }
export const JUNCTION_SIZE = JUNCTION_NODE_SIZE
export const GENERATION_ROW_HEIGHT = ROW_HEIGHT
/** Single source of truth for a node's rendered width — the canvas reuses this so generation bands stay in step with layout. */
export const nodeWidth = nodeWidthFor
