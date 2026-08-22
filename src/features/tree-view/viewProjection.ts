import type { FamilyGraph } from './types'
import type { ProjectedFamilyView, ViewEmphasis, ViewProjectionOptions } from './viewTypes'
import { projectMyFamily } from './myFamilyView'

/**
 * View projection — Phase 5C-2.
 *
 * The seam where "which family is this?" ends and "how am I looking at
 * it?" begins:
 *
 *     genealogy facts          People / ParentLinks / Unions
 *            ↓
 *     buildFamilyGraph         canonical graph — the truth
 *            ↓
 *     computeRanks             canonical generations
 *            ↓
 *     projectFamilyTreeView    ← THIS: what the camera includes
 *            ↓
 *     projectFamilyGroups      organisational collapsing
 *            ↓
 *     layoutFamilyGraph        2D placement
 *            ↓
 *     React Flow               the family map
 *
 * VIEWS ARE PRESENTATION PROJECTIONS. THEY NEVER MODIFY GENEALOGY FACTS
 * AND MUST NOT BE RANKED INDEPENDENTLY.
 *
 * Both halves of that matter. A view may leave someone out of the frame;
 * it may never change who anyone's parents are, and it may never cause the
 * remaining people to be re-ranked. Ranks arrive already computed from the
 * canonical graph and leave by the same reference — see the note on
 * `ProjectedFamilyView.ranks`.
 *
 *
 * WHAT THIS LAYER DOES NOT DECIDE
 * ───────────────────────────────
 * Genealogy stays where it already lives, and this module must never grow
 * a second opinion about any of it:
 *
 *   who someone's parent is        → graphAdapter + unionSelection
 *   which generation they are in   → rank.ts
 *   what two people are to each other → relationshipResolver
 *   how a family group collapses   → groupProjection.ts
 *
 * The only questions answered here are: is this node in frame, and how
 * loudly should it be drawn.
 *
 *
 * A MAP, NOT A LIST
 * ─────────────────
 * The result is a graph — nodes and edges — and deliberately not an
 * ordered sequence. Every future view must stay able to use the whole 2D
 * canvas, where vertical position carries generation, horizontal position
 * carries branch, proximity carries closeness, and empty space separates
 * families. Nothing here may impose an order, flatten a family into a
 * column, or turn a lineage into a chain: that would quietly foreclose the
 * spatial family map this is being built for. The `full` projection
 * returns the very arrays it was given, in their original order, so it
 * cannot even accidentally reorder anything.
 */

/**
 * Shared empties, so the identity projection allocates nothing per call
 * and its output stays referentially stable across renders.
 */
const NO_EMPHASIS: ReadonlyMap<string, ViewEmphasis> = new Map()
const NOTHING_HIDDEN: ReadonlySet<string> = new Set()
const NO_FAMILY_UNITS: ReadonlyMap<string, string> = new Map()

/**
 * How far from the focal person a node can be and still read at full
 * strength, then at reduced strength.
 *
 * Two rather than one because a sibling's distance is genuinely ambiguous:
 * siblings who share a union junction are one step apart, siblings whose
 * parents have no recorded union are two. Drawing those two families of
 * sibling differently would be indefensible, so the first tier absorbs
 * both. In practice the tiers land as:
 *
 *   primary    parents, children, partners, siblings, grandparents,
 *              grandchildren, aunts/uncles, nieces/nephews
 *   secondary  cousins, great-grandparents, great-grandchildren
 *   context    everything further out, and anyone unconnected
 */
const PRIMARY_WITHIN = 2
const SECONDARY_WITHIN = 4

/**
 * Emphasis by distance from the focal person, measured over the graph the
 * adapter already built.
 *
 * This counts hops. It does NOT decide kinship: it never asks who someone's
 * parent is, never names a relationship, and would be the wrong tool for
 * either — that is relationshipResolver's job and this must not grow a
 * second opinion about it. "How many steps away is this node" is a question
 * about the drawing, which is exactly what this layer is for.
 *
 * Stepping through a union junction is free, so a partner is one step away
 * rather than two and a couple reads as a single unit rather than as two
 * people with something between them.
 */
function emphasisByGraphDistance(
  graph: FamilyGraph,
  focalPersonId: string,
): ReadonlyMap<string, ViewEmphasis> {
  const neighbours = new Map<string, string[]>()
  for (const node of graph.nodes) neighbours.set(node.id, [])
  for (const edge of graph.edges) {
    neighbours.get(edge.source)?.push(edge.target)
    neighbours.get(edge.target)?.push(edge.source)
  }
  if (!neighbours.has(focalPersonId)) return NO_EMPHASIS

  const junctionIds = new Set(
    graph.nodes.filter((node) => node.type === 'unionJunction').map((node) => node.id),
  )

  // Breadth-first, one generation of people at a time. Junctions reached
  // on the way are recorded at the distance they were reached from and
  // then expanded in the same step — they cost nothing to pass through.
  // Junctions never neighbour each other, so one free hop always suffices.
  const distance = new Map<string, number>([[focalPersonId, 0]])
  let frontier = [focalPersonId]
  let steps = 0

  while (frontier.length > 0) {
    const passedThrough: string[] = []
    for (const id of frontier) {
      for (const next of neighbours.get(id) ?? []) {
        if (!junctionIds.has(next) || distance.has(next)) continue
        distance.set(next, steps)
        passedThrough.push(next)
      }
    }

    const nextFrontier: string[] = []
    for (const id of [...frontier, ...passedThrough]) {
      for (const next of neighbours.get(id) ?? []) {
        if (junctionIds.has(next) || distance.has(next)) continue
        distance.set(next, steps + 1)
        nextFrontier.push(next)
      }
    }

    frontier = nextFrontier
    steps += 1
  }

  // Sparse: `primary` is the default, so only the quieter tiers are
  // recorded and a tree with everyone nearby allocates almost nothing.
  const emphasis = new Map<string, ViewEmphasis>()
  for (const node of graph.nodes) {
    const hops = distance.get(node.id)
    if (hops === undefined) {
      // Unreachable from the focal person: a genuinely separate branch,
      // and saying so quietly is more honest than drawing it as loudly as
      // the family you are standing in.
      emphasis.set(node.id, 'context')
      continue
    }
    if (hops <= PRIMARY_WITHIN) continue
    emphasis.set(node.id, hops <= SECONDARY_WITHIN ? 'secondary' : 'context')
  }
  return emphasis
}

/**
 * Presents the canonical graph as one view.
 *
 * Pure: no React, no Dexie, no storage, no network, no clock. Everything
 * it knows arrives as an argument, which is what lets a view be tested
 * against a synthetic graph with no application running.
 *
 * `full` is an identity projection and is built to be observably free —
 * the nodes, edges and ranks come back by reference, so React's memo
 * comparisons downstream see no change and nothing re-lays-out merely
 * because a view was requested.
 */
export function projectFamilyTreeView(
  graph: FamilyGraph,
  ranks: ReadonlyMap<string, number>,
  options: ViewProjectionOptions,
): ProjectedFamilyView {
  // ImplementedView keeps the set of buildable views honest at the type
  // level rather than with a runtime fallback that could silently return
  // the wrong family. Later phases widen that union as they build.
  if (options.view === 'my-family') {
    // Measured by generational displacement rather than hop count, which
    // is what lets it tell a sibling from a grandparent — see
    // myFamilyView.ts. It frames the family; it never re-ranks it.
    return { view: options.view, ...projectMyFamily(graph, ranks, options.focalPersonId) }
  }

  //
  // The focal person changes only how loudly each node is drawn — never
  // WHICH nodes there are. `nodes`, `edges` and `ranks` come back by
  // reference whoever is focused, so the full family stays the full
  // family and nothing downstream re-lays-out when the viewpoint moves.
  const emphasis = options.focalPersonId
    ? emphasisByGraphDistance(graph, options.focalPersonId)
    : NO_EMPHASIS

  return {
    view: options.view,
    nodes: graph.nodes,
    edges: graph.edges,
    ranks,
    emphasis,
    hiddenNodeIds: NOTHING_HIDDEN,
    familyUnits: NO_FAMILY_UNITS,
  }
}

/** Emphasis for one node. Absent means `primary`, which is what the full view gives everyone. */
export function emphasisFor(view: ProjectedFamilyView, nodeId: string): ViewEmphasis {
  return view.emphasis.get(nodeId) ?? 'primary'
}
