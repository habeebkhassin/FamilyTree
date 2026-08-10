import { db } from './db'
import { createPerson } from './people'
import type { CreatePersonInput } from './people'
import { createParentLink, createUnion, DuplicateRelationshipError } from './relationships'
import type { ParentRelationship, Person, UnionStatus } from '../../types'

export type RelativeLinkKind =
  | { kind: 'parent'; relationship: ParentRelationship }
  | { kind: 'child'; relationship: ParentRelationship }
  | { kind: 'spouse'; status: UnionStatus; startDate?: string }
  | { kind: 'sibling' }

/**
 * Applies one relationship link between an existing anchor person and
 * another person (new or already existing). This is the single place
 * RelativeIntent-style "add relative" actions turn into ParentLink/Union
 * writes — both the "connect existing person" path and
 * createPersonWithRelationship below call this, so there is one source of
 * truth for what each relationship kind actually does.
 */
export async function linkRelative(
  familyTreeId: string,
  anchorPersonId: string,
  otherPersonId: string,
  link: RelativeLinkKind,
): Promise<void> {
  if (link.kind === 'parent') {
    await createParentLink({
      familyTreeId,
      parentId: otherPersonId,
      childId: anchorPersonId,
      relationship: link.relationship,
    })
    return
  }

  if (link.kind === 'child') {
    await createParentLink({
      familyTreeId,
      parentId: anchorPersonId,
      childId: otherPersonId,
      relationship: link.relationship,
    })
    return
  }

  if (link.kind === 'spouse') {
    await createUnion({
      familyTreeId,
      partnerAId: anchorPersonId,
      partnerBId: otherPersonId,
      status: link.status,
      startDate: link.startDate,
    })
    return
  }

  // Sibling shortcut (Phase 3 scope, kept as-is per the hardening pass):
  // links the other person to every one of the anchor's CURRENT parents,
  // read fresh here rather than from a possibly-stale snapshot. There is
  // no shared-parent picker yet — a later pass can offer choosing a
  // subset (e.g. to deliberately model only a half-sibling).
  const anchorParentLinks = await db.parentLinks
    .where('familyTreeId')
    .equals(familyTreeId)
    .filter((parentLink) => parentLink.childId === anchorPersonId)
    .toArray()

  let linkedAny = false
  let sawDuplicate = false
  for (const parentLink of anchorParentLinks) {
    try {
      await createParentLink({
        familyTreeId,
        parentId: parentLink.parentId,
        childId: otherPersonId,
        relationship: 'biological',
      })
      linkedAny = true
    } catch (error) {
      if (error instanceof DuplicateRelationshipError) {
        sawDuplicate = true
      } else {
        throw error
      }
    }
  }
  if (!linkedAny && sawDuplicate) {
    throw new DuplicateRelationshipError('They are already connected as siblings through the selected parent(s).')
  }
}

/**
 * Creates a new Person and links them to an existing anchor person in one
 * Dexie transaction. createParentLink/createUnion open their own nested
 * db.transaction() calls, which Dexie joins into this ambient one since
 * their table scopes are subsets of it — so if the relationship write
 * fails for any reason (duplicate, cycle, cross-tree), the Person
 * creation rolls back too. A new relative should never be created except
 * through this function, so an orphaned, unlinked Person is never left
 * behind.
 */
export async function createPersonWithRelationship(
  personInput: CreatePersonInput,
  anchorPersonId: string,
  link: RelativeLinkKind,
): Promise<Person> {
  return db.transaction('rw', db.people, db.parentLinks, db.unions, async () => {
    const person = await createPerson(personInput)
    await linkRelative(personInput.familyTreeId, anchorPersonId, person.id, link)
    return person
  })
}
