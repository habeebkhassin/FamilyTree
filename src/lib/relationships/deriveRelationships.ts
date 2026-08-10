import type { ParentLink, ParentRelationship, Person, Union } from '../../types'

export interface RelatedParent {
  person: Person
  relationship: ParentRelationship
  parentLinkId: string
}

export interface RelatedChild {
  person: Person
  relationship: ParentRelationship
  parentLinkId: string
}

export interface RelatedSibling {
  person: Person
  /** 2 = shares both known parents (full sibling), 1 = shares exactly one (half-sibling). */
  sharedParentCount: 1 | 2
}

export interface RelatedPartner {
  person: Person
  union: Union
}

export interface RelationshipEngine {
  getParents(personId: string): RelatedParent[]
  getChildren(personId: string): RelatedChild[]
  getSiblings(personId: string): RelatedSibling[]
  getHalfSiblings(personId: string): RelatedSibling[]
  getPartners(personId: string): RelatedPartner[]
}

/**
 * Builds a relationship engine bound to one family tree's current data.
 * Nothing here reads storage — it's pure derivation over already-loaded
 * People/ParentLinks/Unions, so the UI never hand-rolls this logic itself.
 */
export function createRelationshipEngine(
  people: Person[],
  parentLinks: ParentLink[],
  unions: Union[],
): RelationshipEngine {
  const peopleById = new Map(people.map((person) => [person.id, person]))

  function getParents(personId: string): RelatedParent[] {
    const result: RelatedParent[] = []
    for (const link of parentLinks) {
      if (link.childId !== personId) continue
      const person = peopleById.get(link.parentId)
      if (person) result.push({ person, relationship: link.relationship, parentLinkId: link.id })
    }
    return result
  }

  function getChildren(personId: string): RelatedChild[] {
    const result: RelatedChild[] = []
    for (const link of parentLinks) {
      if (link.parentId !== personId) continue
      const person = peopleById.get(link.childId)
      if (person) result.push({ person, relationship: link.relationship, parentLinkId: link.id })
    }
    return result
  }

  /**
   * personId -> how many of this person's own parents each other child
   * shares with them. Full sibling = 2+ shared parents, half-sibling = 1.
   *
   * ParentLink's `relationship` subtype (biological/adopted/step/foster)
   * is not consulted here — every subtype counts equally toward shared
   * parenthood. That's intentional for Phase 3: an adopted or step link
   * still makes two children siblings by this measure. Richer kinship
   * semantics (e.g. treating step-siblings as a distinct category) are a
   * later concern, not a Phase 3 redesign.
   */
  function getSharedParentCounts(personId: string): Map<string, number> {
    const myParentIds = new Set(parentLinks.filter((link) => link.childId === personId).map((link) => link.parentId))
    const counts = new Map<string, number>()
    if (myParentIds.size === 0) return counts

    for (const link of parentLinks) {
      if (link.childId === personId) continue
      if (!myParentIds.has(link.parentId)) continue
      counts.set(link.childId, (counts.get(link.childId) ?? 0) + 1)
    }
    return counts
  }

  function getSiblings(personId: string): RelatedSibling[] {
    const result: RelatedSibling[] = []
    for (const [siblingId, count] of getSharedParentCounts(personId)) {
      if (count < 2) continue
      const person = peopleById.get(siblingId)
      if (person) result.push({ person, sharedParentCount: 2 })
    }
    return result
  }

  function getHalfSiblings(personId: string): RelatedSibling[] {
    const result: RelatedSibling[] = []
    for (const [siblingId, count] of getSharedParentCounts(personId)) {
      if (count !== 1) continue
      const person = peopleById.get(siblingId)
      if (person) result.push({ person, sharedParentCount: 1 })
    }
    return result
  }

  function getPartners(personId: string): RelatedPartner[] {
    const result: RelatedPartner[] = []
    for (const union of unions) {
      if (union.partnerAId !== personId && union.partnerBId !== personId) continue
      const partnerId = union.partnerAId === personId ? union.partnerBId : union.partnerAId
      const person = peopleById.get(partnerId)
      if (person) result.push({ person, union })
    }
    return result
  }

  return { getParents, getChildren, getSiblings, getHalfSiblings, getPartners }
}
