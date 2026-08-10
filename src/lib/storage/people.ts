import { db } from './db'
import type { Person } from '../../types'

export type CreatePersonInput = Omit<Person, 'id' | 'createdAt' | 'updatedAt'>

export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const now = new Date().toISOString()
  const person: Person = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  await db.people.add(person)
  return person
}

export function getPerson(id: string): Promise<Person | undefined> {
  return db.people.get(id)
}

export function getPeopleByTree(familyTreeId: string): Promise<Person[]> {
  return db.people.where('familyTreeId').equals(familyTreeId).toArray()
}

export async function updatePerson(
  id: string,
  changes: Partial<Omit<Person, 'id' | 'familyTreeId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await db.people.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

/**
 * Deletes a person and every relationship record that points at them, so no
 * ParentLink/Union is ever left referencing a person that no longer exists.
 * MediaRecords are kept but have the deleted id stripped from personIds,
 * since a photo/story can still be meaningful without every tagged person.
 *
 * FamilyGroupMember rows follow the same "strip the reference, keep the
 * container" rule as MediaRecord above — a FamilyGroup can still exist
 * with one fewer member. FamilyGroup.originPersonId is different: it's
 * the single authoritative source of truth for "who founded this family"
 * (see familyGroups.ts), so a dangling reference there would be worse
 * than a stale media tag — it's cleared, not left pointing at nothing.
 */
export async function deletePerson(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.people, db.parentLinks, db.unions, db.media, db.familyGroups, db.familyGroupMembers],
    async () => {
      await db.parentLinks.where('parentId').equals(id).delete()
      await db.parentLinks.where('childId').equals(id).delete()
      await db.unions.where('partnerAId').equals(id).delete()
      await db.unions.where('partnerBId').equals(id).delete()

      const taggedMedia = await db.media.where('personIds').equals(id).toArray()
      for (const media of taggedMedia) {
        await db.media.update(media.id, {
          personIds: media.personIds.filter((personId) => personId !== id),
          updatedAt: new Date().toISOString(),
        })
      }

      await db.familyGroupMembers.where('personId').equals(id).delete()

      const foundedGroups = await db.familyGroups.where('originPersonId').equals(id).toArray()
      for (const group of foundedGroups) {
        await db.familyGroups.update(group.id, { originPersonId: undefined, updatedAt: new Date().toISOString() })
      }

      await db.people.delete(id)
    },
  )
}
