import type { RelationshipEngine } from '../../lib/relationships/deriveRelationships'

/**
 * Branches the tree can show as a Family Card.
 *
 * A card stands in for the family BELOW somebody — their descendants —
 * and never for the person. They keep their own card, their marriage and
 * their parents, so the genealogy on screen stays exactly what the
 * records say; what the card replaces is a subtree nobody is currently
 * looking at.
 *
 *
 * WHAT MAKES A BRANCH
 * ───────────────────
 * A married person with at least one parent and at least one sibling.
 *
 * The three together are what distinguish somebody who has become the
 * head of their own family from somebody who merely appears in one: a
 * marriage is the start of a household, and parents and siblings mean
 * they arrived from a family rather than being the root of the tree.
 * Any one or two of these on their own catch far too many people.
 *
 * Deliberately NOT read from FamilyGroup membership. A group is something
 * somebody typed; this is a shape the genealogy already has, and the tree
 * should be able to recognise it in a family nobody has organised yet.
 */
export function qualifiesAsFamilyBranch(personId: string, engine: RelationshipEngine): boolean {
  if (engine.getPartners(personId).length === 0) return false
  if (engine.getParents(personId).length === 0) return false
  /*
    Half-siblings count. The engine separates them because "sibling" and
    "half-sibling" are different answers to "who is this to me", but the
    question here is whether somebody grew up in a family — and a
    half-brother is family by any reading. Requiring two shared parents
    would quietly exclude every person whose tree records one parent.
  */
  const siblings = engine.getSiblings(personId).length + engine.getHalfSiblings(personId).length
  if (siblings === 0) return false
  // A branch with nobody under it is not a branch — collapsing it would
  // hide nothing and put a card where a family was not.
  return engine.getChildren(personId).length > 0
}

/**
 * The people the current viewpoint is about.
 *
 * The focal person and the family immediately around them: partners,
 * parents, siblings and children. None of these may be collapsed — the
 * whole point of focusing on somebody is to see their family in detail,
 * and a view that hid the very household being explored would be
 * answering a question nobody asked.
 */
export function focusRegion(
  focalPersonId: string | null | undefined,
  engine: RelationshipEngine,
): Set<string> {
  const region = new Set<string>()
  if (!focalPersonId) return region

  region.add(focalPersonId)
  for (const related of engine.getPartners(focalPersonId)) region.add(related.person.id)
  for (const related of engine.getParents(focalPersonId)) region.add(related.person.id)
  for (const related of engine.getSiblings(focalPersonId)) region.add(related.person.id)
  for (const related of engine.getHalfSiblings(focalPersonId)) region.add(related.person.id)
  for (const related of engine.getChildren(focalPersonId)) region.add(related.person.id)
  return region
}

/** Everyone descended from a person, through the graph as recorded. */
export function descendantsOf(personId: string, engine: RelationshipEngine): Set<string> {
  const found = new Set<string>()
  const queue = [personId]
  while (queue.length > 0) {
    const next = queue.pop()
    if (!next) continue
    for (const related of engine.getChildren(next)) {
      if (found.has(related.person.id)) continue
      found.add(related.person.id)
      queue.push(related.person.id)
    }
  }
  return found
}

export interface FamilyBranch {
  /** The person whose family this is. They stay on screen. */
  rootPersonId: string
  /** Everyone the card stands in for. Hidden, never deleted. */
  hiddenPersonIds: Set<string>
}

/**
 * Which branches this view may fold away.
 *
 *
 * THE RESTRAINT IS THE FEATURE
 * ────────────────────────────
 * "Every married person with relatives becomes a family card" would not
 * be a family tree any more, so three things hold it back:
 *
 *  - nobody in the focus region is ever a root, and
 *  - nobody in the focus region is ever HIDDEN by somebody else's card,
 *    which matters because the focal person's parent may well qualify and
 *    folding them away would take the focal person with them;
 *  - a branch inside another branch is left alone, so the tree folds at
 *    the outermost point rather than stacking cards inside cards.
 */
export function collapsibleBranches(
  personIds: readonly string[],
  engine: RelationshipEngine,
  focalPersonId: string | null | undefined,
): FamilyBranch[] {
  const protectedPeople = focusRegion(focalPersonId, engine)

  const candidates: FamilyBranch[] = []
  for (const personId of personIds) {
    if (protectedPeople.has(personId)) continue
    if (!qualifiesAsFamilyBranch(personId, engine)) continue

    const hidden = descendantsOf(personId, engine)
    // Folding this away would take the person being explored with it.
    if ([...protectedPeople].some((id) => hidden.has(id))) continue
    candidates.push({ rootPersonId: personId, hiddenPersonIds: hidden })
  }

  // Outermost wins: a branch whose root is already inside another branch
  // would put a card inside a card.
  return candidates.filter(
    (branch) =>
      !candidates.some(
        (other) =>
          other.rootPersonId !== branch.rootPersonId &&
          other.hiddenPersonIds.has(branch.rootPersonId),
      ),
  )
}
