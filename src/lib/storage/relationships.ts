import { db } from './db'
import { isLive, liveOnly, SYNC_TABLES } from './internal'
import { recordChange } from '../sync/changeLog'
import type { ParentLink, Union } from '../../types'

export type CreateParentLinkInput = Omit<ParentLink, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type CreateUnionInput = Omit<Union, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

export class DuplicateRelationshipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateRelationshipError'
  }
}

export class InvalidRelationshipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRelationshipError'
  }
}

/** Exported so familyGroups.ts can reuse the exact same cross-tree guard rather than re-implementing it. */
export async function assertPeopleBelongToTree(familyTreeId: string, personIds: string[]): Promise<void> {
  const people = await db.people.bulkGet(personIds)
  for (let index = 0; index < personIds.length; index += 1) {
    const person = people[index]
    // A tombstoned person counts as gone: you cannot attach a new
    // relationship to someone who has been deleted.
    if (!isLive(person)) {
      throw new InvalidRelationshipError('One of the people in this relationship no longer exists.')
    }
    if (person.familyTreeId !== familyTreeId) {
      throw new InvalidRelationshipError('People can only be linked within the same family tree.')
    }
  }
}

/**
 * Simple BFS cycle guard: before adding the edge parentId -> childId
 * (parentId becomes a parent of childId), reject it if parentId is already
 * reachable by walking DOWN from childId through existing parent->child
 * edges. If it is, childId is already an ancestor of parentId, so the new
 * edge would close a loop (e.g. A parent-of B, B parent-of C, then
 * C parent-of A). ParentLink subtype (biological/adopted/step/foster) is
 * ignored here — every subtype is an equally real edge for this check.
 *
 * Tombstoned links are skipped: a deleted relationship must not keep
 * blocking a new one.
 *
 * Deliberately a plain adjacency-map BFS, not a general graph library —
 * family trees stay small, so this doesn't need anything fancier.
 */
async function wouldCreateCycle(familyTreeId: string, parentId: string, childId: string): Promise<boolean> {
  const links = liveOnly(await db.parentLinks.where('familyTreeId').equals(familyTreeId).toArray())
  const childrenOf = new Map<string, string[]>()
  for (const link of links) {
    const list = childrenOf.get(link.parentId) ?? []
    list.push(link.childId)
    childrenOf.set(link.parentId, list)
  }

  const queue: string[] = [childId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (visited.has(current)) continue
    visited.add(current)
    for (const descendant of childrenOf.get(current) ?? []) {
      if (descendant === parentId) return true
      queue.push(descendant)
    }
  }
  return false
}

export async function createParentLink(input: CreateParentLinkInput): Promise<ParentLink> {
  if (input.parentId === input.childId) {
    throw new InvalidRelationshipError('A person cannot be their own parent.')
  }

  return db.transaction('rw', [db.people, db.parentLinks, ...SYNC_TABLES], async () => {
    await assertPeopleBelongToTree(input.familyTreeId, [input.parentId, input.childId])

    if (await wouldCreateCycle(input.familyTreeId, input.parentId, input.childId)) {
      throw new InvalidRelationshipError(
        'This would create a cycle in the family tree — a person cannot be their own ancestor.',
      )
    }

    // A tombstoned link is not a duplicate — re-adding a relationship that
    // was deleted has to be allowed.
    const duplicate = await db.parentLinks
      .where('familyTreeId')
      .equals(input.familyTreeId)
      .filter(
        (link) =>
          !link.deletedAt &&
          link.parentId === input.parentId &&
          link.childId === input.childId &&
          link.relationship === input.relationship,
      )
      .first()

    if (duplicate) {
      throw new DuplicateRelationshipError('This parent relationship already exists.')
    }

    const now = new Date().toISOString()
    const parentLink: ParentLink = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    await db.parentLinks.add(parentLink)
    await recordChange({
      familyTreeId: parentLink.familyTreeId,
      entity: 'parentLink',
      entityId: parentLink.id,
      op: 'create',
      before: null,
      after: parentLink,
    })
    return parentLink
  })
}

export async function getParentLinksByTree(familyTreeId: string): Promise<ParentLink[]> {
  return liveOnly(await db.parentLinks.where('familyTreeId').equals(familyTreeId).toArray())
}

export async function updateParentLink(
  id: string,
  changes: Partial<Pick<ParentLink, 'relationship'>>,
): Promise<void> {
  await db.transaction('rw', [db.parentLinks, ...SYNC_TABLES], async () => {
    const before = await db.parentLinks.get(id)
    if (!isLive(before)) return

    const after: ParentLink = { ...before, ...changes, updatedAt: new Date().toISOString() }
    await db.parentLinks.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'parentLink',
      entityId: id,
      op: 'update',
      before,
      after,
    })
  })
}

export async function deleteParentLink(id: string): Promise<void> {
  await db.transaction('rw', [db.parentLinks, ...SYNC_TABLES], async () => {
    const before = await db.parentLinks.get(id)
    if (!isLive(before)) return

    const deletedAt = new Date().toISOString()
    const after: ParentLink = { ...before, deletedAt, updatedAt: deletedAt }
    await db.parentLinks.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'parentLink',
      entityId: id,
      op: 'delete',
      before,
      after,
    })
  })
}

function isSamePartnerPair(union: Pick<Union, 'partnerAId' | 'partnerBId'>, a: string, b: string): boolean {
  return (union.partnerAId === a && union.partnerBId === b) || (union.partnerAId === b && union.partnerBId === a)
}

export async function createUnion(input: CreateUnionInput): Promise<Union> {
  if (input.partnerAId === input.partnerBId) {
    throw new InvalidRelationshipError('A person cannot be their own partner.')
  }

  return db.transaction('rw', [db.people, db.unions, ...SYNC_TABLES], async () => {
    await assertPeopleBelongToTree(input.familyTreeId, [input.partnerAId, input.partnerBId])

    const existingUnions = liveOnly(await db.unions.where('familyTreeId').equals(input.familyTreeId).toArray())
    const duplicate = existingUnions.find(
      (union) =>
        isSamePartnerPair(union, input.partnerAId, input.partnerBId) &&
        union.status === input.status &&
        (union.startDate ?? null) === (input.startDate ?? null) &&
        (union.endDate ?? null) === (input.endDate ?? null),
    )

    if (duplicate) {
      throw new DuplicateRelationshipError('This union already exists.')
    }

    const now = new Date().toISOString()
    const union: Union = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    await db.unions.add(union)
    await recordChange({
      familyTreeId: union.familyTreeId,
      entity: 'union',
      entityId: union.id,
      op: 'create',
      before: null,
      after: union,
    })
    return union
  })
}

export async function getUnionsByTree(familyTreeId: string): Promise<Union[]> {
  return liveOnly(await db.unions.where('familyTreeId').equals(familyTreeId).toArray())
}

export async function updateUnion(
  id: string,
  changes: Partial<Pick<Union, 'status' | 'startDate' | 'endDate'>>,
): Promise<void> {
  await db.transaction('rw', [db.unions, ...SYNC_TABLES], async () => {
    const before = await db.unions.get(id)
    if (!isLive(before)) return

    const after: Union = { ...before, ...changes, updatedAt: new Date().toISOString() }
    await db.unions.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'union',
      entityId: id,
      op: 'update',
      before,
      after,
    })
  })
}

export async function deleteUnion(id: string): Promise<void> {
  await db.transaction('rw', [db.unions, ...SYNC_TABLES], async () => {
    const before = await db.unions.get(id)
    if (!isLive(before)) return

    const deletedAt = new Date().toISOString()
    const after: Union = { ...before, deletedAt, updatedAt: deletedAt }
    await db.unions.put(after)
    await recordChange({
      familyTreeId: after.familyTreeId,
      entity: 'union',
      entityId: id,
      op: 'delete',
      before,
      after,
    })
  })
}
