import type { FamilyGraph } from './types'

/**
 * The perspectives the architecture anticipates — Phase 5C-2.
 *
 * A view is a way of LOOKING at the genealogy, never a different
 * genealogy. The same People, ParentLinks and Unions underlie every one of
 * them, and switching view changes what the camera includes and
 * emphasises — not who anyone's parents are.
 */
export type FamilyTreeView =
  /** Everyone, as the canvas has always drawn them. */
  | 'full'
  /** The focal person's immediate family, bounded. */
  | 'my-family'
  /** Direct ancestors only. */
  | 'lineage'
  /** Direct descendants only. */
  | 'descendants'
  /** The path connecting two selected people. */
  | 'relationship'

/**
 * The views `projectFamilyTreeView` can actually produce today.
 *
 * Deliberately narrower than FamilyTreeView, and deliberately enforced by
 * the compiler rather than by a runtime branch: asking for a view that has
 * not been built is a type error, so there is no "unimplemented view"
 * path that could silently return the wrong tree. Each later phase widens
 * this union by exactly the view it implements.
 */
export type ImplementedView = Extract<FamilyTreeView, 'full' | 'my-family' | 'lineage'>

/**
 * How prominently a node should read in this view.
 *
 * Presentation only. Emphasis says nothing about kinship — it is the
 * answer to "how loudly should this be drawn here", which is a question
 * about the camera, not about the family.
 */
export type ViewEmphasis = 'primary' | 'secondary' | 'context'

export interface ViewProjectionOptions {
  view: ImplementedView
  /**
   * The person the tree is being explored from (Phase 5C-1).
   *
   * Accepted by every view so the signature does not change when
   * focus-dependent views arrive. The `full` view deliberately ignores it:
   * the full family is the full family regardless of where you stand in
   * it, and a view that quietly dropped people when focus moved would be
   * lying about the family rather than reframing it.
   */
  focalPersonId?: string | null
}

/**
 * A view of the canonical graph.
 *
 * Extends FamilyGraph so it drops straight into the existing pipeline —
 * `projectFamilyGroups` takes it unchanged, which is what keeps the new
 * seam from disturbing anything downstream.
 */
export interface ProjectedFamilyView extends FamilyGraph {
  view: ImplementedView
  /**
   * The ranks this view was projected against — the SAME map that was
   * passed in, by reference.
   *
   * Carried through rather than recomputed, and identity is asserted in
   * the tests, so it is provable that no view re-ranked anything. Ranking
   * a projected graph is exactly the mistake that let a collapsed
   * multi-generation group drag outsiders into other generations in Phase
   * 4E-3; passing the canonical map along untouched makes that
   * unrepeatable here.
   */
  ranks: ReadonlyMap<string, number>
  /**
   * Emphasis for nodes that are not `primary`.
   *
   * Sparse on purpose: an absent entry means `primary`, so the identity
   * projection allocates nothing and a future view only records the nodes
   * it actually wants to play down.
   */
  emphasis: ReadonlyMap<string, ViewEmphasis>
  /**
   * Canonical nodes this view leaves out.
   *
   * Recorded rather than merely omitted, so a view can honestly say "there
   * are more people here" instead of pretending the family ends where the
   * frame does. Someone a generation outside the frame should read as
   * further away, never as unrelated.
   */
  hiddenNodeIds: ReadonlySet<string>
  /**
   * Person id -> household id, for the households the focal person belongs
   * to. Empty in the full view.
   *
   * A derived, render-time grouping used only to draw a quiet shared rail —
   * never persisted, never a container, and emphatically NOT a FamilyGroup.
   * Family Groups are explicit, user-defined and stored; these are worked
   * out from the graph each time it is drawn.
   */
  familyUnits: ReadonlyMap<string, string>
}
