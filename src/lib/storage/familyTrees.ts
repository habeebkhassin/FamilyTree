import { db } from './db'
import type { FamilyTree } from '../../types'

export interface CreateFamilyTreeInput {
  name: string
  description?: string
}

export async function createFamilyTree(input: CreateFamilyTreeInput): Promise<FamilyTree> {
  const now = new Date().toISOString()
  const familyTree: FamilyTree = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
  await db.familyTrees.add(familyTree)
  return familyTree
}

export function getFamilyTree(id: string): Promise<FamilyTree | undefined> {
  return db.familyTrees.get(id)
}

/** Most recently updated first. */
export function getAllFamilyTrees(): Promise<FamilyTree[]> {
  return db.familyTrees.orderBy('updatedAt').reverse().toArray()
}

export async function updateFamilyTree(
  id: string,
  changes: Partial<Pick<FamilyTree, 'name' | 'description'>>,
): Promise<void> {
  await db.familyTrees.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

export function deleteFamilyTree(id: string): Promise<void> {
  return db.familyTrees.delete(id)
}
