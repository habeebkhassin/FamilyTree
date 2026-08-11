import { db } from '../storage/db'
import type { SyncState } from './changeTypes'

/**
 * How far a tree has been reconciled with the server.
 *
 * In Phase 5A every tree is local-only, so `lastServerSeq` is null and
 * stays null. That null is meaningful: it says "this tree has never been
 * synced", which is exactly what a future first sync needs to know. No
 * fake progress is recorded.
 *
 * A tree with no row here at all is equally valid — it simply predates any
 * interest in syncing. Callers should treat "no row" and "null seq" the
 * same way.
 */
export function getSyncState(familyTreeId: string): Promise<SyncState | undefined> {
  return db.syncState.get(familyTreeId)
}

/**
 * Creates the row for a tree if it has none, leaving an existing one
 * untouched. Called when a tree is created so the concept exists from the
 * start; it never invents a sync position.
 */
export async function ensureSyncState(familyTreeId: string): Promise<void> {
  const existing = await db.syncState.get(familyTreeId)
  if (existing) return
  await db.syncState.add({ familyTreeId, lastServerSeq: null, lastSyncedAt: null })
}
