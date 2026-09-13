import type { Person } from '../../types'
import type { RelationshipEngine } from '../../lib/relationships/deriveRelationships'

/**
 * The handful of people worth offering when connecting somebody who is
 * already in the tree.
 *
 * Adding a relative used to render the whole family as a grid of cards
 * above the form, so on any real tree you scrolled past everybody you
 * were not looking for before you could reach the fields. The full family
 * is still reachable — through search — but what is offered up front is
 * the few people the answer is actually likely to be.
 *
 * Closeness is read from the existing relationship engine and nothing
 * else. There is no new notion of "related", no score stored anywhere,
 * and no second traversal of ParentLinks or Unions: partners, parents,
 * children and siblings come from the same derivations the profile screen
 * already shows, and anyone further out is found by walking those same
 * four edges one more step.
 */

/** Partner, then parents, then children, then siblings — the brief's order. */
function immediateCircle(personId: string, engine: RelationshipEngine): string[] {
  return [
    ...engine.getPartners(personId).map((related) => related.person.id),
    ...engine.getParents(personId).map((related) => related.person.id),
    ...engine.getChildren(personId).map((related) => related.person.id),
    ...engine.getSiblings(personId).map((related) => related.person.id),
    ...engine.getHalfSiblings(personId).map((related) => related.person.id),
  ]
}

export function suggestRelatives(
  anchorPersonId: string,
  engine: RelationshipEngine,
  /** Who may be offered at all — the anchor is already excluded by the caller. */
  candidates: Person[],
  limit = 5,
): Person[] {
  if (limit <= 0) return []
  const offerable = new Map(candidates.map((person) => [person.id, person]))

  const suggested: Person[] = []
  const seen = new Set<string>([anchorPersonId])

  const take = (personId: string): boolean => {
    if (seen.has(personId)) return false
    seen.add(personId)
    const person = offerable.get(personId)
    if (!person) return false
    suggested.push(person)
    return suggested.length >= limit
  }

  const closest = immediateCircle(anchorPersonId, engine)
  for (const personId of closest) if (take(personId)) return suggested

  /*
    Still short, so widen by one step: the same four kinds of edge walked
    out from each person already offered. That reaches a sibling's
    partner, a nephew, a grandparent — the rest of the branch you are
    standing in — without ever reaching for somebody unrelated just to
    fill the row.
  */
  for (const personId of [...closest]) {
    for (const nextId of immediateCircle(personId, engine)) {
      if (take(nextId)) return suggested
    }
  }

  return suggested
}
