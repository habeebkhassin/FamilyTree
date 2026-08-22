import type { FamilyEdge, FamilyGraph, FamilyNode } from './types'
import type { ProjectedFamilyView, ViewEmphasis } from './viewTypes'

/**
 * The My Family view — Phase 5C-4.
 *
 * The first projection that materially changes what the canvas shows. It
 * answers "where do I sit in my family?" by measuring everyone's position
 * RELATIVE TO THE FOCAL PERSON and framing the neighbourhood around them.
 *
 * Pure: no React, no Dexie, no storage, no clock. It reads the canonical
 * graph and a focal person id, and returns a projection. It never modifies
 * genealogy, and it never re-ranks — canonical ranks arrive computed and
 * leave by the same reference, exactly as in the full view.
 *
 *
 * GENERATIONAL DISPLACEMENT, NOT HOP COUNT
 * ────────────────────────────────────────
 * Phase 5C-3 measures undirected hops, which cannot express the hierarchy
 * this view needs: a sibling and a grandparent are BOTH two hops away, yet
 * one is immediate family and the other is a generation removed. No
 * threshold on an undirected metric can separate them, because the
 * difference is directional — up-then-down versus up-then-up.
 *
 * So each person is measured as a pair: how many generations UP from the
 * focal person, and how many DOWN. Partners are displacement-neutral,
 * since a spouse stands beside you rather than above or below.
 *
 *     focal        (0,0)      partner   (0,0)
 *     parent       (1,0)      child     (0,1)
 *     sibling      (1,1)      grandparent (2,0)
 *     aunt/uncle   (2,1)      niece/nephew (1,2)
 *     cousin       (2,2)      great-grandparent (3,0)
 *
 * This is a MEASUREMENT, not relationship naming. It counts generations;
 * it never concludes "this is an aunt". Naming relationships remains
 * relationshipResolver's job and this module must not grow a second
 * opinion about it.
 *
 * A useful property falls out of it: a sibling is (1,1) whether or not
 * their shared parents have a recorded Union. Under hop counting those two
 * cases differ, which would draw two kinds of sibling differently for a
 * reason no reader could ever guess.
 */

export interface GenerationalDisplacement {
  /** Generations from the focal person toward their ancestors. */
  up: number
  /** Generations from the focal person toward their descendants. */
  down: number
}

/**
 * How far out the view reaches before people stop being drawn.
 *
 * Generous on purpose. Cutting at immediate family would answer "who is
 * closest to me" while destroying "where did I come from" — and someone a
 * single generation outside the frame would read as unrelated rather than
 * as further away. Everyone beyond this is recorded in `hiddenNodeIds`
 * rather than forgotten, so the interface can say that more family exists.
 */
const MAX_GENERATIONS_UP = 3
const MAX_GENERATIONS_DOWN = 3

/** Primary: your own generation and the one either side of it. */
function isPrimary({ up, down }: GenerationalDisplacement): boolean {
  return Math.max(up, down) <= 1
}

/**
 * Secondary: two generations away in one direction, at most one in the
 * other — grandparents, grandchildren, aunts/uncles, nieces/nephews. The
 * `min <= 1` is what keeps cousins (2,2) out; they are context.
 */
function isSecondary({ up, down }: GenerationalDisplacement): boolean {
  return Math.max(up, down) <= 2 && Math.min(up, down) <= 1
}

export function emphasisForDisplacement(displacement: GenerationalDisplacement): ViewEmphasis {
  if (isPrimary(displacement)) return 'primary'
  if (isSecondary(displacement)) return 'secondary'
  return 'context'
}

interface DirectedAdjacency {
  /** Neighbours one generation nearer the ancestors. */
  up: Map<string, string[]>
  /** Neighbours one generation nearer the descendants. */
  down: Map<string, string[]>
  /** Neighbours in the same generation — partners, and their junction. */
  lateral: Map<string, string[]>
}

function buildDirectedAdjacency(edges: readonly FamilyEdge[]): DirectedAdjacency {
  const up = new Map<string, string[]>()
  const down = new Map<string, string[]>()
  const lateral = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  for (const edge of edges) {
    if (edge.data?.kind === 'parentChild') {
      // The source is the parent, or the junction standing in for both
      // parents — either way it is one generation above the target.
      push(up, edge.target, edge.source)
      push(down, edge.source, edge.target)
    } else if (edge.data?.kind === 'unionSegment') {
      push(lateral, edge.source, edge.target)
      push(lateral, edge.target, edge.source)
    }
  }
  return { up, down, lateral }
}

/**
 * Every node's generational displacement from the focal person, by
 * breadth-first search in order of increasing total displacement.
 *
 * O(V + E): each node is settled once and each edge inspected a constant
 * number of times. No all-pairs work, and nothing is resolved for people
 * the view will not draw.
 */
export function displacementsFrom(
  graph: FamilyGraph,
  focalPersonId: string,
): Map<string, GenerationalDisplacement> {
  const settled = new Map<string, GenerationalDisplacement>()
  if (!graph.nodes.some((node) => node.id === focalPersonId)) return settled

  const { up, down, lateral } = buildDirectedAdjacency(graph.edges)
  settled.set(focalPersonId, { up: 0, down: 0 })
  let frontier = [focalPersonId]

  while (frontier.length > 0) {
    // Partners and their junction sit at the same displacement, so the
    // lateral neighbourhood is closed over before stepping a generation.
    // Iterative rather than one pass: a person can reach a junction, which
    // reaches the other partner, which may reach a further junction.
    const pending = [...frontier]
    while (pending.length > 0) {
      const current = pending.pop() as string
      const displacement = settled.get(current) as GenerationalDisplacement
      for (const next of lateral.get(current) ?? []) {
        if (settled.has(next)) continue
        settled.set(next, displacement)
        frontier.push(next)
        pending.push(next)
      }
    }

    const nextFrontier: string[] = []
    for (const current of frontier) {
      const displacement = settled.get(current) as GenerationalDisplacement
      for (const ancestor of up.get(current) ?? []) {
        if (settled.has(ancestor)) continue
        settled.set(ancestor, { up: displacement.up + 1, down: displacement.down })
        nextFrontier.push(ancestor)
      }
      for (const descendant of down.get(current) ?? []) {
        if (settled.has(descendant)) continue
        settled.set(descendant, { up: displacement.up, down: displacement.down + 1 })
        nextFrontier.push(descendant)
      }
    }
    frontier = nextFrontier
  }

  return settled
}

/**
 * The households the focal person belongs to: person id -> household id.
 *
 * A household is a union and the children hanging off it, plus — for a
 * person with no recorded union — a parent and their children. Only the
 * ones the FOCAL PERSON is part of are returned, which is normally the
 * family they were born into and the one they went on to make.
 *
 * Deliberately not every household in the tree. A rail on every family
 * would be a rail on everyone, which says nothing; and colouring each
 * branch differently is the rainbow this design has ruled out. Two quiet
 * rails around the people you actually live among is the whole idea.
 *
 * This is NOT a FamilyGroup. Family Groups are explicit, user-defined and
 * persisted; these are derived at render time, never stored, and never
 * shown as a container.
 */
export function focalHouseholds(
  graph: FamilyGraph,
  focalPersonId: string,
): Map<string, string> {
  const { up, down, lateral } = buildDirectedAdjacency(graph.edges)
  const membership = new Map<string, string>()

  // Anchors are what a household forms around: the junction a person
  // partners in, and the junction (or lone parent) they descend from.
  const anchors = new Set<string>([
    ...(lateral.get(focalPersonId) ?? []),
    ...(up.get(focalPersonId) ?? []),
  ])

  // And the person themselves, when children hang directly off them
  // rather than off a union junction. Without this, someone with children
  // but no recorded union and no recorded parents — the root of a tree is
  // the common case — anchors nothing and gets no rail at all, despite
  // plainly heading a household. A child whose parents share a union
  // routes through that junction instead, so this adds nothing there.
  if ((down.get(focalPersonId) ?? []).length > 0) anchors.add(focalPersonId)

  for (const anchor of [...anchors].sort()) {
    const unitId = `unit:${anchor}`
    // The partners either side of the anchor, then everyone below it.
    const members = [anchor, ...(lateral.get(anchor) ?? []), ...(down.get(anchor) ?? [])]
    for (const member of members) {
      // A junction is a drawing device, not a member of anything.
      if (member.startsWith('junction:')) continue
      // First anchor wins, so a person is only ever in one unit and the
      // ordering above keeps that deterministic.
      if (!membership.has(member)) membership.set(member, unitId)
    }
  }

  return membership
}

/**
 * Projects the canonical graph as the focal person's family.
 *
 * Everyone within reach is kept and tiered; everyone beyond is recorded in
 * `hiddenNodeIds` rather than dropped silently, so the interface can show
 * that the family continues past the frame. People with no connection to
 * the focal person at all are also recorded there — they are in this tree,
 * but they are not this person's family.
 *
 * With no focal person, or one who is not in the graph, this returns the
 * whole graph untouched: an empty screen would be a worse answer than the
 * view the user already had.
 */
export function projectMyFamily(
  graph: FamilyGraph,
  ranks: ReadonlyMap<string, number>,
  focalPersonId: string | null | undefined,
): Omit<ProjectedFamilyView, 'view'> {
  const displacements = focalPersonId ? displacementsFrom(graph, focalPersonId) : new Map()

  if (!focalPersonId || displacements.size === 0) {
    return {
      nodes: graph.nodes,
      edges: graph.edges,
      ranks,
      emphasis: new Map(),
      hiddenNodeIds: new Set(),
      familyUnits: new Map(),
    }
  }

  const includedIds = new Set<string>()
  const hiddenNodeIds = new Set<string>()
  const emphasis = new Map<string, ViewEmphasis>()

  for (const node of graph.nodes) {
    const displacement = displacements.get(node.id)
    const inRange =
      displacement !== undefined &&
      displacement.up <= MAX_GENERATIONS_UP &&
      displacement.down <= MAX_GENERATIONS_DOWN

    if (!inRange) {
      hiddenNodeIds.add(node.id)
      continue
    }
    includedIds.add(node.id)

    // Sparse, like the full view: an absent entry means primary.
    const tier = emphasisForDisplacement(displacement)
    if (tier !== 'primary') emphasis.set(node.id, tier)
  }

  const nodes: FamilyNode[] = graph.nodes.filter((node) => includedIds.has(node.id))
  // Both ends must be present, or the edge would point at nothing. The
  // edges themselves are the originals — never rebuilt, never re-derived.
  const edges: FamilyEdge[] = graph.edges.filter(
    (edge) => includedIds.has(edge.source) && includedIds.has(edge.target),
  )

  return {
    nodes,
    edges,
    ranks,
    emphasis,
    hiddenNodeIds,
    familyUnits: focalHouseholds(graph, focalPersonId),
  }
}
