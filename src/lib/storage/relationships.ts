import { db } from './db'
import type { ParentLink, Union } from '../../types'

export type CreateParentLinkInput = Omit<ParentLink, 'id' | 'createdAt' | 'updatedAt'>
export type CreateUnionInput = Omit<Union, 'id' | 'createdAt' | 'updatedAt'>

export async function createParentLink(input: CreateParentLinkInput): Promise<ParentLink> {
  const now = new Date().toISOString()
  const parentLink: ParentLink = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  await db.parentLinks.add(parentLink)
  return parentLink
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

export async function createUnion(input: CreateUnionInput): Promise<Union> {
  const now = new Date().toISOString()
  const union: Union = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  await db.unions.add(union)
  return union
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
