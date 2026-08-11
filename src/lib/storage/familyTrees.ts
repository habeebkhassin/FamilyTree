import { db } from './db'
import { isLive, liveOnly, SYNC_TABLES } from './internal'
import { ensureSyncState } from '../sync/syncState'
import { recordChange } from '../sync/changeLog'
import type { FamilyTree } from '../../types'

export interface CreateFamilyTreeInput {
  name: string
  description?: string
}

/**
 * A tree created here is a LOCAL tree. It has no owner and needs no
 * account — Phase 5A adds no authentication, and a tree without an owner
 * must stay a first-class citizen indefinitely, not a half-migrated one.
 * The sync-state row is created empty so the concept exists from the
 * start; it records no position, because nothing has ever been synced.
 */
export async function createFamilyTree(input: CreateFamilyTreeInput): Promise<FamilyTree> {
  const now = new Date().toISOString()
  const familyTree: FamilyTree = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', [db.familyTrees, db.syncState, ...SYNC_TABLES], async () => {
    await db.familyTrees.add(familyTree)
    await ensureSyncState(familyTree.id)
    await recordChange({
      familyTreeId: familyTree.id,
      entity: 'familyTree',
      entityId: familyTree.id,
      op: 'create',
      before: null,
      after: familyTree,
    })
  })

  return familyTree
}

export async function getFamilyTree(id: string): Promise<FamilyTree | undefined> {
  const tree = await db.familyTrees.get(id)
  return isLive(tree) ? tree : undefined
}

/** Most recently updated first. */
export async function getAllFamilyTrees(): Promise<FamilyTree[]> {
  return liveOnly(await db.familyTrees.orderBy('updatedAt').reverse().toArray())
}

export async function updateFamilyTree(
  id: string,
  changes: Partial<Pick<FamilyTree, 'name' | 'description'>>,
): Promise<void> {
  await db.transaction('rw', [db.familyTrees, ...SYNC_TABLES], async () => {
    const before = await db.familyTrees.get(id)
    if (!isLive(before)) return

    const after: FamilyTree = { ...before, ...changes, updatedAt: new Date().toISOString() }
    await db.familyTrees.put(after)
    await recordChange({
      familyTreeId: id,
      entity: 'familyTree',
      entityId: id,
      op: 'update',
      before,
      after,
    })
  })
}

/**
 * Tombstones the tree itself. Its people and relationships are left as
 * they are: they already hang off a tree that no longer lists, and
 * cascading a whole archive into tombstones would produce an enormous
 * event burst for no benefit. Restoring the tree brings everything back
 * intact.
 */
export async function deleteFamilyTree(id: string): Promise<void> {
  await db.transaction('rw', [db.familyTrees, ...SYNC_TABLES], async () => {
    const before = await db.familyTrees.get(id)
    if (!isLive(before)) return

    const deletedAt = new Date().toISOString()
    const after: FamilyTree = { ...before, deletedAt, updatedAt: deletedAt }
    await db.familyTrees.put(after)
    await recordChange({
      familyTreeId: id,
      entity: 'familyTree',
      entityId: id,
      op: 'delete',
      before,
      after,
    })
  })
}
