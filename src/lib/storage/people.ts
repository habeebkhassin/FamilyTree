import { db } from './db'
import { isLive, liveOnly, SYNC_TABLES } from './internal'
import { recordChange } from '../sync/changeLog'
import type { Person } from '../../types'

export type CreatePersonInput = Omit<Person, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const now = new Date().toISOString()
  const person: Person = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', [db.people, ...SYNC_TABLES], async () => {
    await db.people.add(person)
    await recordChange({
      familyTreeId: person.familyTreeId,
      entity: 'person',
      entityId: person.id,
      op: 'create',
      before: null,
      after: person,
    })
  })

  return person
}

export async function getPerson(id: string): Promise<Person | undefined> {
  const person = await db.people.get(id)
  return isLive(person) ? person : undefined
}

export async function getPeopleByTree(familyTreeId: string): Promise<Person[]> {
  return liveOnly(await db.people.where('familyTreeId').equals(familyTreeId).toArray())
}

export async function updatePerson(
  id: string,
  changes: Partial<Omit<Person, 'id' | 'familyTreeId' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
): Promise<void> {
  await db.transaction('rw', [db.people, ...SYNC_TABLES], async () => {
    const before = await db.people.get(id)
    // Unchanged behaviour for a missing row: Dexie's update() was always a
    // silent no-op. A tombstoned row is treated the same way — edit it and
    // nothing happens, rather than quietly resurrecting it.
    if (!isLive(before)) return

    const after: Person = { ...before, ...changes, updatedAt: new Date().toISOString() }
    await db.people.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'person',
      entityId: id,
      op: 'update',
      before,
      after,
    })
  })
}

/**
 * Tombstones a person and everything that pointed at them.
 *
 * The pre-5A version hard-deleted the person and their ParentLinks and
 * Unions outright. That cannot be replicated — a device that never saw a
 * row has nothing to remove — and it destroyed the relationship history
 * permanently. So deletion now writes `deletedAt` instead, on the person
 * AND on every relationship naming them.
 *
 * Both halves of the old cascade rule are kept, for the same reasons as
 * before:
 *
 *  - Relationships must not stay live pointing at a deleted person, so
 *    ParentLinks and Unions naming them are tombstoned too. They remain
 *    in the database and in the log, so nothing about the family's
 *    history is lost and the whole deletion can be walked back.
 *  - Containers keep their identity but drop the reference: a
 *    FamilyGroupMember row is tombstoned, and a FamilyGroup that named
 *    this person as its founder has `originPersonId` cleared — recorded
 *    as an ordinary update event, since the group itself survives.
 *
 * Media is the exception. A MediaRecord holds a Blob and is excluded from
 * the change log entirely (see changeTypes.ts), so stripping the deleted
 * id from `personIds` stays a plain unlogged edit, exactly as before.
 *
 * Every write here — records, events and outbox entries — happens in one
 * transaction.
 */
export async function deletePerson(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.people, db.parentLinks, db.unions, db.media, db.familyGroups, db.familyGroupMembers, ...SYNC_TABLES],
    async () => {
      const person = await db.people.get(id)
      if (!isLive(person)) return
      const deletedAt = new Date().toISOString()
      const familyTreeId = person.familyTreeId

      const parentLinks = liveOnly([
        ...(await db.parentLinks.where('parentId').equals(id).toArray()),
        ...(await db.parentLinks.where('childId').equals(id).toArray()),
      ])
      // A person who is both parent and child on the same link is
      // impossible (storage rejects self-parenting), but de-duplicating
      // keeps this correct if the two queries ever overlap.
      const seenLinkIds = new Set<string>()
      for (const link of parentLinks) {
        if (seenLinkIds.has(link.id)) continue
        seenLinkIds.add(link.id)
        const after = { ...link, deletedAt, updatedAt: deletedAt }
        await db.parentLinks.put(after)
        await recordChange({
          familyTreeId,
          entity: 'parentLink',
          entityId: link.id,
          op: 'delete',
          before: link,
          after,
        })
      }

      const unions = liveOnly([
        ...(await db.unions.where('partnerAId').equals(id).toArray()),
        ...(await db.unions.where('partnerBId').equals(id).toArray()),
      ])
      const seenUnionIds = new Set<string>()
      for (const union of unions) {
        if (seenUnionIds.has(union.id)) continue
        seenUnionIds.add(union.id)
        const after = { ...union, deletedAt, updatedAt: deletedAt }
        await db.unions.put(after)
        await recordChange({
          familyTreeId,
          entity: 'union',
          entityId: union.id,
          op: 'delete',
          before: union,
          after,
        })
      }

      // Unlogged on purpose — media carries binary data and is out of
      // scope for the Phase 5A change log.
      const taggedMedia = await db.media.where('personIds').equals(id).toArray()
      for (const media of taggedMedia) {
        await db.media.update(media.id, {
          personIds: media.personIds.filter((personId) => personId !== id),
          updatedAt: deletedAt,
        })
      }

      for (const member of liveOnly(await db.familyGroupMembers.where('personId').equals(id).toArray())) {
        const after = { ...member, deletedAt, updatedAt: deletedAt }
        await db.familyGroupMembers.put(after)
        await recordChange({
          familyTreeId,
          entity: 'familyGroupMember',
          entityId: member.id,
          op: 'delete',
          before: member,
          after,
        })
      }

      for (const group of liveOnly(await db.familyGroups.where('originPersonId').equals(id).toArray())) {
        const after = { ...group, originPersonId: undefined, updatedAt: deletedAt }
        await db.familyGroups.put(after)
        await recordChange({
          familyTreeId,
          entity: 'familyGroup',
          entityId: group.id,
          op: 'update',
          before: group,
          after,
        })
      }

      const after: Person = { ...person, deletedAt, updatedAt: deletedAt }
      await db.people.put(after)
      await recordChange({
        familyTreeId,
        entity: 'person',
        entityId: id,
        op: 'delete',
        before: person,
        after,
      })
    },
  )
}

/**
 * Clears a person's tombstone. Records a `restore` event; the original
 * delete event is left exactly as it was.
 *
 * Restores ONLY the person. The relationships tombstoned alongside them
 * stay tombstoned and are restored individually — see restoreEntity in
 * undo.ts. Bringing the whole cascade back automatically would need the
 * events to be grouped, which Phase 5A's agreed event shape has no field
 * for; see the report for that open question.
 */
export async function restorePerson(id: string): Promise<void> {
  await db.transaction('rw', [db.people, ...SYNC_TABLES], async () => {
    const before = await db.people.get(id)
    if (!before || !before.deletedAt) return

    const after: Person = { ...before, deletedAt: undefined, updatedAt: new Date().toISOString() }
    await db.people.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'person',
      entityId: id,
      op: 'restore',
      before,
      after,
    })
  })
}
