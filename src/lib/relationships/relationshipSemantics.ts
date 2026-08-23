import type { ParentRelationship } from '../../types'

/**
 * What a family relationship MEANS — Phase 5C-7.
 *
 * The single source of truth for the question every view kept answering
 * for itself: does this parent link make somebody an ancestor?
 *
 * Three different questions were being conflated, and separating them is
 * the whole point of this module. They are all legitimate; they are simply
 * not the same question, and a view has to say which one it is asking.
 *
 *
 * 1. GENEALOGICAL ANCESTRY — who am I descended from?
 *    Biological and adoptive parent links, and nothing else. This is the
 *    question Lineage asks, and the one the relationship resolver measures
 *    distance along. An adopted child's grandparents really are their
 *    grandparents; a step-parent's mother is not a great-grandmother, and
 *    saying so would invent a fact the records do not contain.
 *
 * 2. FAMILY PROXIMITY — who is close to me?
 *    Every parent link counts, step and foster included, alongside
 *    children, siblings and partners. A step-parent who raised you is
 *    close family by any honest measure. This is the question My Family
 *    asks, which is why it and Lineage legitimately disagree about the
 *    same person.
 *
 * 3. CONTEXTUAL FAMILY — who explains the picture?
 *    Spouses of ancestors and of relatives: people who are not the subject
 *    of the view but without whom it reads oddly, like a grandmother drawn
 *    alone because her husband happens not to be an ancestor. Views admit
 *    these deliberately and mark them as context so they never outrank the
 *    people the view is actually about.
 *
 * None of these weakens support for step, foster, adoptive, biological,
 * half-sibling or partner relationships. They are all real, all preserved,
 * and all still resolvable — they simply sit in different categories, and
 * the categories are now written down instead of implied.
 */

/**
 * How a parent link participates in the family.
 *
 * `social` is the established term for a parent who raises a child without
 * being a forebear of theirs. It is a description, not a ranking.
 */
export type ParentLinkSemantics = 'ancestral' | 'social'

/**
 * Parent links that carry descent.
 *
 * The one definition. relationshipResolver measures lineage along these;
 * lineageView admits people to the line by them. Nothing else may keep a
 * private copy — that duplication is exactly what this module exists to
 * end.
 */
export const ANCESTRAL_PARENT_LINKS: ReadonlySet<ParentRelationship> = new Set([
  'biological',
  'adopted',
])

/**
 * Parent links that make somebody family without making them a forebear.
 *
 * Kept as its own set rather than derived, so that adding a new subtype to
 * ParentRelationship forces a deliberate decision about which side it
 * falls on. A test asserts the two sets partition the type exactly, so an
 * unclassified subtype fails the build rather than quietly defaulting.
 */
export const SOCIAL_PARENT_LINKS: ReadonlySet<ParentRelationship> = new Set(['step', 'foster'])

/**
 * Every parent link, whatever it means — the set a proximity question
 * uses.
 *
 * Named rather than left implicit so a view that counts all of them is
 * visibly CHOOSING to, instead of merely not having filtered.
 */
export const PROXIMITY_PARENT_LINKS: ReadonlySet<ParentRelationship> = new Set([
  ...ANCESTRAL_PARENT_LINKS,
  ...SOCIAL_PARENT_LINKS,
])

export function semanticsOfParentLink(relationship: ParentRelationship): ParentLinkSemantics {
  return ANCESTRAL_PARENT_LINKS.has(relationship) ? 'ancestral' : 'social'
}

/** Does this link make the parent a forebear of the child? */
export function isAncestralParentLink(relationship: ParentRelationship): boolean {
  return ANCESTRAL_PARENT_LINKS.has(relationship)
}

/**
 * Is this link family at all?
 *
 * True for every subtype today. It exists so proximity-based code can say
 * what it means, and so a future subtype has somewhere obvious to be
 * excluded from if one ever should be.
 */
export function isProximityParentLink(relationship: ParentRelationship): boolean {
  return PROXIMITY_PARENT_LINKS.has(relationship)
}
