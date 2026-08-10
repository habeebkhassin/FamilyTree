import { db } from './db'
import { assertPeopleBelongToTree } from './relationships'
import type { FamilyGroup, FamilyGroupMember } from '../../types'

export type CreateFamilyGroupInput = Omit<FamilyGroup, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateFamilyGroupInput = Partial<
  Pick<FamilyGroup, 'name' | 'originPersonId' | 'establishedPrecision' | 'establishedDate' | 'establishedLabel' | 'notes'>
>
export type CreateFamilyGroupMemberInput = Omit<FamilyGroupMember, 'id' | 'createdAt' | 'updatedAt'>

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
  return db.transaction('rw', db.people, db.familyGroups, async () => {
    if (input.originPersonId) {
      await assertPeopleBelongToTree(input.familyTreeId, [input.originPersonId])
    }

    const now = new Date().toISOString()
    const familyGroup: FamilyGroup = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    await db.familyGroups.add(familyGroup)
    return familyGroup
  })
}

export function getFamilyGroup(id: string): Promise<FamilyGroup | undefined> {
  return db.familyGroups.get(id)
}

export function getFamilyGroupsByTree(familyTreeId: string): Promise<FamilyGroup[]> {
  return db.familyGroups.where('familyTreeId').equals(familyTreeId).toArray()
}

export async function updateFamilyGroup(id: string, changes: UpdateFamilyGroupInput): Promise<void> {
  await db.transaction('rw', db.people, db.familyGroups, async () => {
    const group = await db.familyGroups.get(id)
    if (!group) {
      throw new InvalidFamilyGroupError('This family group no longer exists.')
    }
    if (changes.originPersonId) {
      await assertPeopleBelongToTree(group.familyTreeId, [changes.originPersonId])
    }
    await db.familyGroups.update(id, { ...changes, updatedAt: new Date().toISOString() })
  })
}

/**
 * Deletes a FamilyGroup and its membership rows only. Never touches
 * Person/ParentLink/Union/MediaRecord — FamilyGroup is a purely
 * organizational layer, so removing one must never affect the real
 * genealogy underneath it.
 */
export async function deleteFamilyGroup(id: string): Promise<void> {
  await db.transaction('rw', db.familyGroups, db.familyGroupMembers, async () => {
    await db.familyGroupMembers.where('familyGroupId').equals(id).delete()
    await db.familyGroups.delete(id)
  })
}

/**
 * Adds a person to a family group. Both the person and the group must
 * belong to the same FamilyTree (mirrors the cross-tree guard
 * relationships.ts already enforces for ParentLink/Union), and a person
 * cannot be added to the same group twice — rejected here with a clear,
 * catchable domain error, and backstopped at the schema level by the
 * &[familyGroupId+personId] unique index in db.ts.
 */
export async function addFamilyGroupMember(input: CreateFamilyGroupMemberInput): Promise<FamilyGroupMember> {
  return db.transaction('rw', db.people, db.familyGroups, db.familyGroupMembers, async () => {
    await assertPeopleBelongToTree(input.familyTreeId, [input.personId])

    const group = await db.familyGroups.get(input.familyGroupId)
    if (!group) {
      throw new InvalidFamilyGroupError('This family group no longer exists.')
    }
    if (group.familyTreeId !== input.familyTreeId) {
      throw new InvalidFamilyGroupError('A family group can only have members from the same family tree.')
    }

    const existing = await db.familyGroupMembers
      .where('[familyGroupId+personId]')
      .equals([input.familyGroupId, input.personId])
      .first()
    if (existing) {
      throw new DuplicateFamilyGroupMemberError('This person is already a member of this family group.')
    }

    const now = new Date().toISOString()
    const member: FamilyGroupMember = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    await db.familyGroupMembers.add(member)
    return member
  })
}

export function getFamilyGroupMembers(familyGroupId: string): Promise<FamilyGroupMember[]> {
  return db.familyGroupMembers.where('familyGroupId').equals(familyGroupId).toArray()
}

/** All membership rows for every group in a tree, in one indexed query — lets the UI load member counts/lists for a whole tree without one query per group. */
export function getFamilyGroupMembersByTree(familyTreeId: string): Promise<FamilyGroupMember[]> {
  return db.familyGroupMembers.where('familyTreeId').equals(familyTreeId).toArray()
}

export function removeFamilyGroupMember(id: string): Promise<void> {
  return db.familyGroupMembers.delete(id)
}
