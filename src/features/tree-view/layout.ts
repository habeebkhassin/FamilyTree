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

/**
 * How many down-then-up rounds the placement refinement runs — Phase
 * 5C-11b.
 *
 * Fixed rather than run to convergence: the cost stays predictable on a
 * large family and the output cannot depend on a tolerance.
 *
 * Two, because that is where the realistic fixtures stop moving. On the
 * fifty-person family the My Family view reaches a mean parent-child
 * distance of 328px and edges over 400px of 22 at the second pass and is
 * byte-identical at three, four, six and ten. Further passes only widen
 * the graph — 31528px at two against 33102px at ten — without improving
 * any gap measure.
 */
const REFINEMENT_PASSES = 2

/**
 * How much say a block with no family above or below it gets in where the
 * row settles. Small, but not zero — it keeps such a block near where the
 * ordering pass put it rather than letting it be shoved by its neighbours.
 */
const UNANCHORED_WEIGHT = 0.05

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
  /**
   * One row's worth of blocks, in the order stage one resolved, with
   * everything stage two needs to slide them along the row: how wide the
   * block is, how much clear space must precede it, and where each member
   * sits inside it.
   */
  interface PlacedBlock {
    members: FamilyNode[]
    width: number
    gapBefore: number
    centreOffset: Map<string, number>
    left: number
    /**
     * Where stage one put this block, kept fixed for the whole of stage
     * two.
     *
     * A block with no family above or below it is pulled back to this
     * rather than to wherever it currently sits. Targeting its current
     * position instead made it ratchet: a heavier anchored neighbour
     * pushes it right, that becomes its new target, and the next sweep
     * pushes it further. On the full view — the only one that contains the
     * disconnected couple — the graph grew from 3853px to 9099px as the
     * pass count rose, purely from that drift.
     */
    originLeft: number
  }
  const rowBlocks = new Map<number, PlacedBlock[]>()
  /**
   * Columns claimed by multi-row group containers, so lower rows can step
   * around them.
   *
   * `ownerId` is what lets stage two ask where the container actually is
   * now. Holding only the left/right recorded during stage one left the
   * column behind when the container moved, and a person in a lower row
   * could then be placed inside a container that was no longer there —
   * invisible to the diagnostic, which only looks for overlaps within one
   * row and so never compares a person against a container two rows up.
   */
  const spanReservations: {
    minRank: number; maxRank: number; left: number; right: number; ownerId: string
  }[] = []

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

    // --- 1. Rigid couple blocks: Union connectivity ONLY ---------------
    //
    // A couple is partnerA + junction + partnerB, and nothing may be
    // placed between them. Union-find runs over union segments alone, so
    // the block stays rigid; remarriage still chains correctly, because a
    // person married twice is a member of both unions and merges them.
    //
    // Phase 4D also merged siblings into this same structure, which is
    // what broke it: union-find is transitive, so in any row holding two
    // sibling couples every node collapsed into a single cluster, and the
    // partners inside it were then reordered by a key that had nothing to
    // do with their partner. Siblings are handled at the next level down
    // instead, as a SOFT grouping that cannot pull a couple apart.
    const blockParent = new Map<string, string>()
    for (const node of rowNodes) blockParent.set(node.id, node.id)
    function findBlock(id: string): string {
      let root = id
      while (blockParent.get(root) !== root) root = blockParent.get(root) as string
      let current = id
      while (blockParent.get(current) !== root) {
        const next = blockParent.get(current) as string
        blockParent.set(current, root)
        current = next
      }
      return root
    }
    function mergeBlock(a: string, b: string): void {
      const rootA = findBlock(a)
      const rootB = findBlock(b)
      if (rootA !== rootB) blockParent.set(rootA, rootB)
    }
    for (const node of rowNodes) {
      if (node.type !== 'unionJunction') continue
      for (const partnerId of partnerIdsByJunction.get(node.id) ?? []) {
        if (rowIds.has(partnerId)) mergeBlock(node.id, partnerId)
      }
    }

    // --- 2. Which family each person is ordered by ----------------------
    //
    // A child can hang off more than one anchor - two recorded parents
    // with no Union between them, or a half-sibling belonging to two
    // marriages. The choice must be structural and repeatable, never a
    // reading of where something happened to be drawn.
    //
    // The rule: join the anchor you share with the most other people in
    // this row, and break ties on the lower anchor id. Sharing more
    // siblings is the stronger claim on where somebody belongs, and both
    // halves of the rule depend only on the graph, so the same family
    // always produces the same answer.
    const rowChildCountByAnchor = new Map<string, number>()
    for (const node of rowNodes) {
      if (node.type === 'unionJunction') continue
      for (const anchorId of parentAnchorIdsByChild.get(node.id) ?? []) {
        rowChildCountByAnchor.set(anchorId, (rowChildCountByAnchor.get(anchorId) ?? 0) + 1)
      }
    }
    /** Picks the winner by (most shared children, then lowest id). */
    function pickAnchor(candidates: Iterable<string>, weight: (id: string) => number): string | undefined {
      let best: string | undefined
      let bestWeight = -1
      for (const id of [...candidates].sort()) {
        const w = weight(id)
        if (w > bestWeight) {
          bestWeight = w
          best = id
        }
      }
      return best
    }
    function chosenAnchorFor(personId: string): string | undefined {
      const anchors = parentAnchorIdsByChild.get(personId) ?? []
      if (anchors.length === 0) return undefined
      return pickAnchor(anchors, (id) => rowChildCountByAnchor.get(id) ?? 0)
    }

    // --- 3. Assemble the blocks, and order their members ---------------
    const blockMembers = new Map<string, FamilyNode[]>()
    for (const node of rowNodes) {
      const root = findBlock(node.id)
      const members = blockMembers.get(root) ?? []
      members.push(node)
      blockMembers.set(root, members)
    }

    /**
     * Members of a block, left to right.
     *
     * A block is a chain of partners linked by junctions, so this walks
     * that chain from one end rather than sorting by a numeric key - which
     * is what used to strand a junction away from the couple it joins. The
     * end to start from, and every branch on the way, is chosen by
     * parent-average first and node id second, so the walk is total and
     * deterministic.
     */
    function orderedMembersOf(members: FamilyNode[]): FamilyNode[] {
      if (members.length <= 1) return members
      const memberIds = new Set(members.map((member) => member.id))
      const byId = new Map(members.map((member) => [member.id, member]))
      const adjacency = new Map<string, string[]>()
      for (const member of members) adjacency.set(member.id, [])
      for (const member of members) {
        if (member.type !== 'unionJunction') continue
        for (const partnerId of partnerIdsByJunction.get(member.id) ?? []) {
          if (!memberIds.has(partnerId)) continue
          adjacency.get(member.id)?.push(partnerId)
          adjacency.get(partnerId)?.push(member.id)
        }
      }
      const compare = (a: string, b: string): number => {
        const keyA = resolveParentAverageX(a) ?? Number.POSITIVE_INFINITY
        const keyB = resolveParentAverageX(b) ?? Number.POSITIVE_INFINITY
        if (keyA !== keyB) return keyA < keyB ? -1 : 1
        return a < b ? -1 : a > b ? 1 : 0
      }
      // An endpoint of the chain - a partner married once. A ring would
      // have none, which genealogy does not produce, but the fallback
      // keeps the walk total rather than trusting that.
      const ends = members
        .map((member) => member.id)
        .filter((id) => (adjacency.get(id)?.length ?? 0) <= 1)
        .sort(compare)
      const ordered: FamilyNode[] = []
      const visited = new Set<string>()
      let current: string | undefined = ends[0] ?? [...memberIds].sort(compare)[0]
      while (current !== undefined) {
        visited.add(current)
        const node = byId.get(current)
        if (node) ordered.push(node)
        current = (adjacency.get(current) ?? []).filter((id) => !visited.has(id)).sort(compare)[0]
      }
      // Anything the walk could not reach still has to be drawn.
      for (const member of members) if (!visited.has(member.id)) ordered.push(member)

      // A chain has two orientations and the walk only produced one of
      // them. Choose the one whose anchored members read left to right in
      // the same order as the families they came from.
      //
      // This is what a remarriage needs. Harold married Edith and Nancy,
      // so the block is Edith-Harold-Nancy or Nancy-Harold-Edith; Edith's
      // own parents sit at the right-hand end of the row above, so putting
      // her on the left drags her edge across the whole graph. Starting
      // from whichever end happened to be anchored gets this wrong half
      // the time, and it is decided here on anchor values alone — no
      // reading of where anything was drawn.
      const anchorInversions = (list: FamilyNode[]): number => {
        const anchors = list
          .map((member) => resolveParentAverageX(member.id))
          .filter((x): x is number => x !== undefined)
        let count = 0
        for (let i = 0; i < anchors.length; i += 1) {
          for (let j = i + 1; j < anchors.length; j += 1) {
            if ((anchors[i] as number) > (anchors[j] as number)) count += 1
          }
        }
        return count
      }
      const reversed = [...ordered].reverse()
      const forwardScore = anchorInversions(ordered)
      const reverseScore = anchorInversions(reversed)
      if (reverseScore < forwardScore) return reversed
      // A tie leaves the orientation undetermined, so settle it on the id
      // of the end member and keep the same family drawn the same way.
      if (reverseScore === forwardScore) {
        const head = ordered[0]?.id ?? ''
        const tail = reversed[0]?.id ?? ''
        if (tail < head) return reversed
      }
      return ordered
    }

    /**
     * Where a block wants to sit, from the family above it.
     *
     * Only members whose own parents are known contribute. A married-in
     * partner has no parents in the tree, so including them would move the
     * couple toward wherever that person's fallback position happened to
     * be rather than toward the family the block descends from - the
     * signal Phase 5C-10 found poisoning the row below.
     */
    function signalOf(members: FamilyNode[]): number | undefined {
      const resolved = members
        .filter((member) => member.type !== 'unionJunction')
        .map((member) => resolveParentAverageX(member.id))
        .filter((x): x is number => x !== undefined)
      if (resolved.length > 0) {
        return resolved.reduce((sum, x) => sum + x, 0) / resolved.length
      }
      // A junction whose partners are not on this row at all - a collapsed
      // group container is drawn at the top of its span, so the junction
      // joining two collapsed families can fall a row below both. Follow
      // the partners to wherever they were actually placed.
      const placed = members
        .filter((member) => member.type === 'unionJunction')
        .flatMap((member) => partnerIdsByJunction.get(member.id) ?? [])
        .map((id) => finalCenterX.get(id))
        .filter((x): x is number => x !== undefined)
      if (placed.length > 0) return placed.reduce((sum, x) => sum + x, 0) / placed.length
      return undefined
    }

    const elkMean = (members: FamilyNode[]): number =>
      members.reduce((sum, member) => sum + (elkXById.get(member.id) ?? 0), 0) / members.length

    const blocks = [...blockMembers.values()].map((members) => {
      const ordered = orderedMembersOf(members)
      const signal = signalOf(ordered)
      return {
        members: ordered,
        signal,
        // ELK still decides where a block with no family anchor goes -
        // the top generation, and disconnected branches, which is also
        // what keeps separate components from interleaving.
        sortKey: signal ?? elkMean(ordered),
        tiebreak: elkMean(ordered),
        id: ordered.map((member) => member.id).sort()[0] as string,
      }
    })

    // --- 4. Soft sibling groups ----------------------------------------
    //
    // Blocks that descend from the same family sit together, separated by
    // the same small gap as members of one block, while unrelated families
    // get the wider cross-branch gap. Grouping is soft precisely because
    // it is applied to whole blocks: it can place two couples side by
    // side, and it can never reach inside one.
    //
    // A block takes the anchor held by most of its members, ties on the
    // lower id - the same rule as an individual, applied one level up, so
    // a couple who are each other's second cousins still lands somewhere
    // predictable.
    const groupKeyOf = new Map<string, string>()
    for (const block of blocks) {
      const counts = new Map<string, number>()
      for (const member of block.members) {
        if (member.type === 'unionJunction') continue
        const anchorId = chosenAnchorFor(member.id)
        if (anchorId !== undefined) counts.set(anchorId, (counts.get(anchorId) ?? 0) + 1)
      }
      const anchorId = pickAnchor(counts.keys(), (id) => counts.get(id) ?? 0)
      // No anchor at all means this block is its own group, which is what
      // keeps unrelated families apart rather than lumping them together.
      groupKeyOf.set(block.id, anchorId !== undefined ? 'anchor:' + anchorId : 'block:' + block.id)
    }

    const groupsInRow = new Map<string, typeof blocks>()
    for (const block of blocks) {
      const key = groupKeyOf.get(block.id) as string
      const list = groupsInRow.get(key) ?? []
      list.push(block)
      groupsInRow.set(key, list)
    }

    /**
     * Order by family first, and never by ELK once family has spoken.
     *
     * Siblings all descend from the same place, so they tie on `sortKey`
     * by construction. Letting ELK break that tie put them in an order
     * derived from a layout computed under a different layering — three
     * children of one couple came out c3, c1, c2 for no reason a reader
     * could see. ELK is still the right answer for a block with no family
     * above it at all, which is the only case it is consulted in now.
     */
    const compareByKey = (
      a: { sortKey: number; tiebreak: number; id: string; signal: number | undefined },
      b: { sortKey: number; tiebreak: number; id: string; signal: number | undefined },
    ): number => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
      if (a.signal === undefined || b.signal === undefined) {
        if (a.tiebreak !== b.tiebreak) return a.tiebreak - b.tiebreak
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }

    const groupEntries = [...groupsInRow.entries()].map(([key, members]) => {
      const sorted = [...members].sort(compareByKey)
      // A group is ordered by the families that actually have a parent
      // above them; a group of entirely unanchored blocks falls back to
      // ELK, as its blocks already do individually.
      const anchored = sorted.filter((block) => block.signal !== undefined)
      const source = anchored.length > 0 ? anchored : sorted
      return {
        blocks: sorted,
        sortKey: source.reduce((sum, block) => sum + block.sortKey, 0) / source.length,
        tiebreak: sorted.reduce((sum, block) => sum + block.tiebreak, 0) / sorted.length,
        id: key,
        // Anchored if any block in it is, so a sibling group is ordered by
        // its family rather than by ELK, exactly as its blocks are.
        signal: anchored.length > 0 ? anchored[0]?.signal : undefined,
      }
    })
    groupEntries.sort(compareByKey)

    // --- 5. Assign cumulative x ----------------------------------------
    // A collapsed group container occupies several rows at once, so the
    // rows it reaches into must step around the column it already claimed
    // in the row where it was placed. Rows are processed top-down, so a
    // container's column is always known before the rows below need it.
    const bandsInThisRow = spanReservations.filter(
      (reservation) => reservation.minRank < rank && reservation.maxRank >= rank,
    )
    // Clears by SAME_UNIT_GAP rather than the full cross-branch gap so a
    // narrow node can still settle in the space BETWEEN two containers -
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
    let isFirstGroup = true
    const rowPlacement: PlacedBlock[] = []
    for (const groupEntry of groupEntries) {
      const groupGap = isFirstGroup ? 0 : CROSS_UNIT_GAP
      if (!isFirstGroup) cursorX += CROSS_UNIT_GAP
      let isFirstBlock = true
      for (const block of groupEntry.blocks) {
        // Siblings sit as close together as the members of one couple do;
        // the wider gap is reserved for a change of family.
        const gapBefore = isFirstBlock ? groupGap : SAME_UNIT_GAP
        if (!isFirstBlock) cursorX += SAME_UNIT_GAP

        // The whole block steps around a reserved column, never part of
        // it. Testing each member separately let a container's column fall
        // between two partners and split them — which is the exact defect
        // Phase 5C-11a exists to remove, arriving by a different route. A
        // block is rigid against collapsed groups too, or it is not rigid.
        const blockWidth = block.members.reduce(
          (sum, member, index) =>
            sum + (widthByNodeId.get(member.id) ?? PERSON_NODE_WIDTH) + (index > 0 ? SAME_UNIT_GAP : 0),
          0,
        )
        cursorX = skipReservedColumns(cursorX, blockWidth)

        const centreOffset = new Map<string, number>()
        const blockLeft = cursorX
        let isFirstMember = true
        for (const member of block.members) {
          if (!isFirstMember) cursorX += SAME_UNIT_GAP
          const width = widthByNodeId.get(member.id) ?? PERSON_NODE_WIDTH
          finalX.set(member.id, cursorX)
          finalCenterX.set(member.id, cursorX + width / 2)
          centreOffset.set(member.id, cursorX + width / 2 - blockLeft)
          if (member.type === 'familyGroup' && member.data.maxRank > member.data.minRank) {
            spanReservations.push({
              minRank: member.data.minRank,
              maxRank: member.data.maxRank,
              left: cursorX,
              right: cursorX + width,
              ownerId: member.id,
            })
          }
          cursorX += width
          isFirstMember = false
        }
        rowPlacement.push({
          members: block.members,
          width: blockWidth,
          gapBefore,
          centreOffset,
          left: blockLeft,
          originLeft: blockLeft,
        })
        isFirstBlock = false
      }
      isFirstGroup = false
    }
    // The order this row was resolved into is frozen here. Stage two moves
    // blocks along the row; it never reorders them and never opens one.
    rowBlocks.set(rank, rowPlacement)
  }

  refineHorizontalPlacement()

  return nodes.map((node) => ({
    ...node,
    position: { x: finalX.get(node.id) ?? 0, y: (ranks.get(node.id) ?? 0) * ROW_HEIGHT },
  })) as FamilyNode[]

  /**
   * Stage two — bidirectional horizontal placement, Phase 5C-11b.
   *
   * Stage one decides WHO goes where in a row and packs each row from
   * zero. That is why a child could sit far from its parent even with the
   * order correct: two rows of different widths both starting at zero have
   * no horizontal registration with each other, and a strictly top-down
   * pass can never move a parent toward its children — for one parent with
   * four children, moving the parent is the whole answer.
   *
   * So this pass leaves the order alone and only slides blocks along their
   * row. It alternates direction: a downward sweep pulls each block toward
   * the family above it, an upward sweep pulls each block toward the
   * children below it, and the two are averaged, which is the balancing
   * idea from Brandes-Köpf without any of its machinery. Bounded
   * iterations, no convergence test, so the cost is fixed and the result
   * is deterministic.
   *
   * Every sweep ends in the same feasibility step, so ordering, minimum
   * separation, couple rigidity and reserved columns are re-established
   * from scratch each time rather than assumed. A block is moved as one
   * object throughout — stage two has no way to place anything between two
   * partners.
   */
  function refineHorizontalPlacement(): void {
    const ranksAscending = sortedRanks
    if (ranksAscending.length < 2) return

    /** Where a block sits now, by the centre of one of its members. */
    const centreOfMember = (block: PlacedBlock, id: string): number =>
      block.left + (block.centreOffset.get(id) ?? block.width / 2)

    const blockOfMember = new Map<string, PlacedBlock>()
    for (const row of rowBlocks.values()) {
      for (const block of row) for (const member of block.members) blockOfMember.set(member.id, block)
    }

    /**
     * Feasible positions closest to what a sweep asked for.
     *
     * Fixed order plus a minimum separation is an isotonic regression once
     * the separations are subtracted out, so pool-adjacent-violators
     * solves it exactly in one linear pass. Blocks nobody has an opinion
     * about carry a small weight and their current position as a target,
     * which keeps them where the ordering put them instead of letting them
     * drift or collapse together.
     */
    function settleRow(row: PlacedBlock[], desiredLeft: (number | undefined)[]): void {
      const n = row.length
      if (n === 0) return

      // left_{i+1} - left_i must be at least this.
      const separation: number[] = []
      for (let i = 0; i + 1 < n; i += 1) {
        separation.push((row[i] as PlacedBlock).width + (row[i + 1] as PlacedBlock).gapBefore)
      }
      const prefix: number[] = [0]
      for (let i = 0; i + 1 < n; i += 1) {
        prefix.push((prefix[i] as number) + (separation[i] as number))
      }

      // z must be non-decreasing, which is exactly the ordering and
      // separation constraints rewritten.
      const target: number[] = []
      const weight: number[] = []
      for (let i = 0; i < n; i += 1) {
        const want = desiredLeft[i]
        target.push((want ?? (row[i] as PlacedBlock).originLeft) - (prefix[i] as number))
        weight.push(want === undefined ? UNANCHORED_WEIGHT : 1)
      }

      const pool: { value: number; weight: number; count: number }[] = []
      for (let i = 0; i < n; i += 1) {
        let value = target[i] as number
        let w = weight[i] as number
        let count = 1
        while (pool.length > 0 && (pool[pool.length - 1] as { value: number }).value > value) {
          const previous = pool.pop() as { value: number; weight: number; count: number }
          const combined = previous.weight + w
          value = combined === 0
            ? (previous.value + value) / 2
            : (previous.value * previous.weight + value * w) / combined
          w = combined
          count += previous.count
        }
        pool.push({ value, weight: w, count })
      }

      let index = 0
      for (const group of pool) {
        for (let k = 0; k < group.count; k += 1) {
          ;(row[index] as PlacedBlock).left = group.value + (prefix[index] as number)
          index += 1
        }
      }
    }

    /**
     * Reserved columns, re-cleared after the row has moved.
     *
     * A collapsed container owns a column across several rows, and that is
     * an absolute position rather than an ordering constraint, so it
     * cannot go into the isotonic solve. Clearing it afterwards can only
     * push a block to the right, which preserves both the order and the
     * separations the solve just established.
     */
    function clearReservations(row: PlacedBlock[], rank: number): void {
      // Recomputed from where the container is NOW, not from where stage
      // one first put it.
      const bands = spanReservations
        .filter((reservation) => reservation.minRank < rank && reservation.maxRank >= rank)
        .map((reservation) => {
          const owner = blockOfMember.get(reservation.ownerId)
          if (!owner) return { left: reservation.left, right: reservation.right }
          const width = widthByNodeId.get(reservation.ownerId) ?? PERSON_NODE_WIDTH
          const centre = owner.left + (owner.centreOffset.get(reservation.ownerId) ?? owner.width / 2)
          return { left: centre - width / 2, right: centre + width / 2 }
        })

      let minimumLeft = Number.NEGATIVE_INFINITY
      let index = 0
      for (const block of row) {
        if (block.left < minimumLeft) block.left = minimumLeft
        let moved = true
        while (moved) {
          moved = false
          for (const band of bands) {
            if (block.left < band.right && block.left + block.width > band.left) {
              block.left = band.right + SAME_UNIT_GAP
              moved = true
            }
          }
        }
        // Carry the block's own separation forward, not just its width —
        // otherwise clearing a column could leave two blocks touching.
        const next = row[index + 1]
        minimumLeft = block.left + block.width + (next ? next.gapBefore : 0)
        index += 1
      }
    }

    /** Writes block positions back out to the nodes. */
    function commit(): void {
      for (const row of rowBlocks.values()) {
        for (const block of row) {
          for (const member of block.members) {
            const width = widthByNodeId.get(member.id) ?? PERSON_NODE_WIDTH
            const centre = block.left + (block.centreOffset.get(member.id) ?? width / 2)
            finalX.set(member.id, centre - width / 2)
            finalCenterX.set(member.id, centre)
          }
        }
      }
    }

    /**
     * What a block would have to do to put an anchored member exactly on
     * the thing it should line up with.
     *
     * Averaged over every member with an opinion, and expressed as a left
     * edge, so the block keeps its shape and simply slides. A block where
     * nobody has an opinion returns undefined and settleRow leaves it
     * roughly where it was.
     */
    function desiredLeftFor(
      block: PlacedBlock,
      wantedCentreOf: (memberId: string) => number | undefined,
    ): number | undefined {
      const wants: number[] = []
      for (const member of block.members) {
        const wanted = wantedCentreOf(member.id)
        if (wanted === undefined) continue
        wants.push(wanted - (block.centreOffset.get(member.id) ?? block.width / 2))
      }
      if (wants.length === 0) return undefined
      return wants.reduce((sum, v) => sum + v, 0) / wants.length
    }

    // Children by parent-edge source, so the upward sweep can ask where a
    // person's children ended up. Built once; the graph never changes.
    const childIdsBySource = new Map<string, string[]>()
    for (const edge of edges) {
      if (edge.data?.kind !== 'parentChild') continue
      const list = childIdsBySource.get(edge.source) ?? []
      if (!list.includes(edge.target)) list.push(edge.target)
      childIdsBySource.set(edge.source, list)
    }

    const centreOfNode = (id: string): number | undefined => {
      const block = blockOfMember.get(id)
      if (!block) return undefined
      return centreOfMember(block, id)
    }

    /**
     * One settling pass over every row, with each block pulled toward its
     * parents and its children at once.
     *
     * Deliberately ONE target rather than a downward sweep followed by an
     * upward one. Run as two sweeps, whichever went last simply overwrote
     * the other: measured on these fixtures, down-then-up produced exactly
     * the same drawing as up alone. And up alone was the worse of the two
     * — it widened the graph by 23% and made the mean parent-child
     * distance in My Family worse than the downward sweep had already made
     * it. Blending the two ends of the same edge into a single target is
     * what makes this bidirectional rather than alternately one-directional.
     *
     * Rows are still visited top to bottom, so the parent side of the
     * target is current within a pass while the child side is one pass
     * behind. That is what the repeat count is for.
     */
    function sweepCombined(): void {
      for (const rank of ranksAscending) {
        const row = rowBlocks.get(rank)
        if (!row || row.length === 0) continue

        const desired = row.map((block) => {
          const fromParents = desiredLeftFor(block, (memberId) => {
            const anchors = parentAnchorIdsByChild.get(memberId) ?? []
            const centres = anchors
              .map((anchorId) => centreOfNode(anchorId))
              .filter((x): x is number => x !== undefined)
            if (centres.length === 0) return undefined
            return centres.reduce((sum, x) => sum + x, 0) / centres.length
          })
          const fromChildren = desiredLeftFor(block, (memberId) => {
            // A parent belongs over the middle of its children. This is
            // the half a strictly top-down pass cannot do at all: for one
            // parent with four children, moving the parent is the answer.
            const children = childIdsBySource.get(memberId) ?? []
            const centres = children
              .map((childId) => centreOfNode(childId))
              .filter((x): x is number => x !== undefined)
            if (centres.length === 0) return undefined
            return centres.reduce((sum, x) => sum + x, 0) / centres.length
          })

          if (fromParents === undefined) return fromChildren
          if (fromChildren === undefined) return fromParents
          // An edge pulls equally from both ends; there is no reason for a
          // parent to outrank a child or the reverse.
          return (fromParents + fromChildren) / 2
        })

        settleRow(row, desired)
        clearReservations(row, rank)
      }
    }

    for (let pass = 0; pass < REFINEMENT_PASSES; pass += 1) sweepCombined()

    // Nothing downstream expects negative coordinates, and keeping the
    // graph anchored at zero makes runs comparable.
    let leftmost = Number.POSITIVE_INFINITY
    for (const row of rowBlocks.values()) for (const block of row) leftmost = Math.min(leftmost, block.left)
    if (Number.isFinite(leftmost) && leftmost !== 0) {
      for (const row of rowBlocks.values()) for (const block of row) block.left -= leftmost
    }

    commit()
  }
}

export const PERSON_NODE_SIZE = { width: PERSON_NODE_WIDTH, height: PERSON_NODE_HEIGHT }
export const JUNCTION_SIZE = JUNCTION_NODE_SIZE
export const GENERATION_ROW_HEIGHT = ROW_HEIGHT
/** Single source of truth for a node's rendered width — the canvas reuses this so generation bands stay in step with layout. */
export const nodeWidth = nodeWidthFor
