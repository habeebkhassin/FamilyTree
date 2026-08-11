import { db } from './db'
import { isLive, liveOnly, SYNC_TABLES } from './internal'
import { assertPeopleBelongToTree } from './relationships'
import { recordChange } from '../sync/changeLog'
import type { FamilyGroup, FamilyGroupMember } from '../../types'

export type CreateFamilyGroupInput = Omit<FamilyGroup, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type UpdateFamilyGroupInput = Partial<
  Pick<FamilyGroup, 'name' | 'originPersonId' | 'establishedPrecision' | 'establishedDate' | 'establishedLabel' | 'notes'>
>
export type CreateFamilyGroupMemberInput = Omit<
  FamilyGroupMember,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>

export class InvalidFamilyGroupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFamilyGroupError'
  }
}

export class DuplicateFamilyGroupMemberError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateFamilyGroupMemberError'
  }
}

export async function createFamilyGroup(input: CreateFamilyGroupInput): Promise<FamilyGroup> {
  return db.transaction('rw', [db.people, db.familyGroups, ...SYNC_TABLES], async () => {
    if (input.originPersonId) {
      await assertPeopleBelongToTree(input.familyTreeId, [input.originPersonId])
    }

    const now = new Date().toISOString()
    const familyGroup: FamilyGroup = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    await db.familyGroups.add(familyGroup)
    await recordChange({
      familyTreeId: familyGroup.familyTreeId,
      entity: 'familyGroup',
      entityId: familyGroup.id,
      op: 'create',
      before: null,
      after: familyGroup,
    })
    return familyGroup
  })
}

export async function getFamilyGroup(id: string): Promise<FamilyGroup | undefined> {
  const group = await db.familyGroups.get(id)
  return isLive(group) ? group : undefined
}

export async function getFamilyGroupsByTree(familyTreeId: string): Promise<FamilyGroup[]> {
  return liveOnly(await db.familyGroups.where('familyTreeId').equals(familyTreeId).toArray())
}

export async function updateFamilyGroup(id: string, changes: UpdateFamilyGroupInput): Promise<void> {
  await db.transaction('rw', [db.people, db.familyGroups, ...SYNC_TABLES], async () => {
    const before = await db.familyGroups.get(id)
    if (!isLive(before)) {
      throw new InvalidFamilyGroupError('This family group no longer exists.')
    }
    if (changes.originPersonId) {
      await assertPeopleBelongToTree(before.familyTreeId, [changes.originPersonId])
    }

    const after: FamilyGroup = { ...before, ...changes, updatedAt: new Date().toISOString() }
    await db.familyGroups.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'familyGroup',
      entityId: id,
      op: 'update',
      before,
      after,
    })
  })
}

/**
 * Tombstones a FamilyGroup and its membership rows. Never touches
 * Person/ParentLink/Union/MediaRecord — FamilyGroup is a purely
 * organizational layer, so removing one must never affect the real
 * genealogy underneath it.
 *
 * The membership rows are tombstoned rather than removed, so the record of
 * who was in the group survives and the deletion can be walked back.
 */
export async function deleteFamilyGroup(id: string): Promise<void> {
  await db.transaction('rw', [db.familyGroups, db.familyGroupMembers, ...SYNC_TABLES], async () => {
    const group = await db.familyGroups.get(id)
    if (!isLive(group)) return
    const deletedAt = new Date().toISOString()

    for (const member of liveOnly(await db.familyGroupMembers.where('familyGroupId').equals(id).toArray())) {
      const after = { ...member, deletedAt, updatedAt: deletedAt }
      await db.familyGroupMembers.put(after)
      await recordChange({
        familyTreeId: group.familyTreeId,
        entity: 'familyGroupMember',
        entityId: member.id,
        op: 'delete',
        before: member,
        after,
      })
    }

    const after: FamilyGroup = { ...group, deletedAt, updatedAt: deletedAt }
    await db.familyGroups.put(after)
    await recordChange({
      familyTreeId: group.familyTreeId,
      entity: 'familyGroup',
      entityId: id,
      op: 'delete',
      before: group,
      after,
    })
  })
}

/**
 * Adds a person to a family group. Both the person and the group must
 * belong to the same FamilyTree (mirrors the cross-tree guard
 * relationships.ts already enforces for ParentLink/Union), and a person
 * cannot be added to the same group twice.
 *
 * The duplicate check ignores tombstoned rows so somebody removed from a
 * group can be added back. Because the schema's unique index still holds
 * across tombstones, the old row is revived rather than a second one
 * inserted — recorded as a `restore`, which is what actually happened.
 */
export async function addFamilyGroupMember(input: CreateFamilyGroupMemberInput): Promise<FamilyGroupMember> {
  return db.transaction('rw', [db.people, db.familyGroups, db.familyGroupMembers, ...SYNC_TABLES], async () => {
    await assertPeopleBelongToTree(input.familyTreeId, [input.personId])

    const group = await db.familyGroups.get(input.familyGroupId)
    if (!isLive(group)) {
      throw new InvalidFamilyGroupError('This family group no longer exists.')
    }
    if (group.familyTreeId !== input.familyTreeId) {
      throw new InvalidFamilyGroupError('A family group can only have members from the same family tree.')
    }

    const existing = await db.familyGroupMembers
      .where('[familyGroupId+personId]')
      .equals([input.familyGroupId, input.personId])
      .first()

    if (existing && !existing.deletedAt) {
      throw new DuplicateFamilyGroupMemberError('This person is already a member of this family group.')
    }

    const now = new Date().toISOString()

    if (existing) {
      const revived: FamilyGroupMember = { ...existing, deletedAt: undefined, updatedAt: now }
      await db.familyGroupMembers.put(revived)
      await recordChange({
        familyTreeId: revived.familyTreeId,
        entity: 'familyGroupMember',
        entityId: revived.id,
        op: 'restore',
        before: existing,
        after: revived,
      })
      return revived
    }

    const member: FamilyGroupMember = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    await db.familyGroupMembers.add(member)
    await recordChange({
      familyTreeId: member.familyTreeId,
      entity: 'familyGroupMember',
      entityId: member.id,
      op: 'create',
      before: null,
      after: member,
    })
    return member
  })
}

export async function getFamilyGroupMembers(familyGroupId: string): Promise<FamilyGroupMember[]> {
  return liveOnly(await db.familyGroupMembers.where('familyGroupId').equals(familyGroupId).toArray())
}

/** All membership rows for every group in a tree, in one indexed query — lets the UI load member counts/lists for a whole tree without one query per group. */
export async function getFamilyGroupMembersByTree(familyTreeId: string): Promise<FamilyGroupMember[]> {
  return liveOnly(await db.familyGroupMembers.where('familyTreeId').equals(familyTreeId).toArray())
}

export async function removeFamilyGroupMember(id: string): Promise<void> {
  await db.transaction('rw', [db.familyGroupMembers, ...SYNC_TABLES], async () => {
    const before = await db.familyGroupMembers.get(id)
    if (!isLive(before)) return

    const deletedAt = new Date().toISOString()
    const after: FamilyGroupMember = { ...before, deletedAt, updatedAt: deletedAt }
    await db.familyGroupMembers.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'familyGroupMember',
      entityId: id,
      op: 'delete',
      before,
      after,
    })
  })
}
