import type { FamilyGraph } from './types'
import type { ProjectedFamilyView, ViewEmphasis, ViewProjectionOptions } from './viewTypes'

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
  // `full` is the only implemented view, and ImplementedView keeps that
  // honest at the type level rather than with a runtime branch that could
  // silently return the wrong family. Later phases widen that union.
  //
  // focalPersonId is accepted and deliberately unused here: the full
  // family does not change depending on where you are standing in it.
  return {
    view: options.view,
    nodes: graph.nodes,
    edges: graph.edges,
    ranks,
    emphasis: NO_EMPHASIS,
    hiddenNodeIds: NOTHING_HIDDEN,
  }
}

/** Emphasis for one node. Absent means `primary`, which is what the full view gives everyone. */
export function emphasisFor(view: ProjectedFamilyView, nodeId: string): ViewEmphasis {
  return view.emphasis.get(nodeId) ?? 'primary'
}
