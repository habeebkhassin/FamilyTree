import { db } from './db'
import type { ParentLink, Union } from '../../types'

export type CreateParentLinkInput = Omit<ParentLink, 'id' | 'createdAt' | 'updatedAt'>
export type CreateUnionInput = Omit<Union, 'id' | 'createdAt' | 'updatedAt'>

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

async function assertPeopleBelongToTree(familyTreeId: string, personIds: string[]): Promise<void> {
  const people = await db.people.bulkGet(personIds)
  for (let index = 0; index < personIds.length; index += 1) {
    const person = people[index]
    if (!person) {
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
 * Deliberately a plain adjacency-map BFS, not a general graph library —
 * family trees stay small, so this doesn't need anything fancier.
 */
async function wouldCreateCycle(familyTreeId: string, parentId: string, childId: string): Promise<boolean> {
  const links = await db.parentLinks.where('familyTreeId').equals(familyTreeId).toArray()
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

  return db.transaction('rw', db.people, db.parentLinks, async () => {
    await assertPeopleBelongToTree(input.familyTreeId, [input.parentId, input.childId])

    if (await wouldCreateCycle(input.familyTreeId, input.parentId, input.childId)) {
      throw new InvalidRelationshipError(
        'This would create a cycle in the family tree — a person cannot be their own ancestor.',
      )
    }

    const duplicate = await db.parentLinks
      .where('familyTreeId')
      .equals(input.familyTreeId)
      .filter(
        (link) =>
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
    return parentLink
  })
}

export function getParentLinksByTree(familyTreeId: string): Promise<ParentLink[]> {
  return db.parentLinks.where('familyTreeId').equals(familyTreeId).toArray()
}

export async function updateParentLink(
  id: string,
  changes: Partial<Pick<ParentLink, 'relationship'>>,
): Promise<void> {
  await db.parentLinks.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

export function deleteParentLink(id: string): Promise<void> {
  return db.parentLinks.delete(id)
}

function isSamePartnerPair(union: Pick<Union, 'partnerAId' | 'partnerBId'>, a: string, b: string): boolean {
  return (union.partnerAId === a && union.partnerBId === b) || (union.partnerAId === b && union.partnerBId === a)
}

export async function createUnion(input: CreateUnionInput): Promise<Union> {
  if (input.partnerAId === input.partnerBId) {
    throw new InvalidRelationshipError('A person cannot be their own partner.')
  }

  return db.transaction('rw', db.people, db.unions, async () => {
    await assertPeopleBelongToTree(input.familyTreeId, [input.partnerAId, input.partnerBId])

    const existingUnions = await db.unions.where('familyTreeId').equals(input.familyTreeId).toArray()
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
    return union
  })
}

export function getUnionsByTree(familyTreeId: string): Promise<Union[]> {
  return db.unions.where('familyTreeId').equals(familyTreeId).toArray()
}

export async function updateUnion(
  id: string,
  changes: Partial<Pick<Union, 'status' | 'startDate' | 'endDate'>>,
): Promise<void> {
  await db.unions.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

export function deleteUnion(id: string): Promise<void> {
  return db.unions.delete(id)
}
