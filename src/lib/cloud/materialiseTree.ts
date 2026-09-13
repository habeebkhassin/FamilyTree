import { db } from '../storage/db'
import type { SyncEntity, SyncRecord } from '../sync/changeTypes'
import type { RemoteAdapter } from '../sync/remoteAdapter'

/**
 * Bringing a shared family tree onto this device — Milestone 4.
 *
 * Runs once, after an invitation is accepted: the tree's current records
 * are downloaded and written locally, and the cursor recorded, so the
 * ordinary sync engine can take over from there. It is bootstrap, not
 * synchronisation, and it deliberately reuses the adapter method that has
 * meant exactly this since before there was a server.
 *
 *
 * IT WILL NOT OVERWRITE A LOCAL FAMILY
 * ────────────────────────────────────
 * Somebody accepting an invitation may already have their own trees on
 * this device, and those are theirs. A downloaded tree is written under
 * the id the cloud gave it, which for a tree somebody else created is a
 * uuid this device has never seen.
 *
 * If it HAS seen it, that is either the same cloud tree arriving again —
 * fine, and applying it twice is the same as once — or a genuine
 * collision between a local-only tree and a cloud one. The second is
 * essentially impossible with random uuids, and precisely because it
 * should never happen it is treated as a reason to stop rather than a
 * case to handle silently. Nothing is overwritten and the caller is told.
 */

export class LocalTreeConflictError extends Error {
  readonly familyTreeId: string

  constructor(familyTreeId: string, name: string) {
    super(
      `A family tree already on this device has the same id as the one you were invited to (“${name}”). ` +
        'Nothing has been changed. Please report this — it should not be possible.',
    )
    this.name = 'LocalTreeConflictError'
    this.familyTreeId = familyTreeId
  }
}

function tableFor(entity: SyncEntity) {
  switch (entity) {
    case 'familyTree':
      return db.familyTrees
    case 'person':
      return db.people
    case 'parentLink':
      return db.parentLinks
    case 'union':
      return db.unions
    case 'familyGroup':
      return db.familyGroups
    case 'familyGroupMember':
      return db.familyGroupMembers
  }
}

export async function materialiseCloudTree(
  familyTreeId: string,
  adapter: RemoteAdapter,
): Promise<void> {
  const existing = await db.familyTrees.get(familyTreeId)
  if (existing) {
    const syncState = await db.syncState.get(familyTreeId)
    // A tree this device has synced before is the same tree, arriving
    // again. One with no sync position was made here, locally, and must
    // not be written over.
    if (!syncState) throw new LocalTreeConflictError(familyTreeId, existing.name)
  }

  const bootstrap = await adapter.bootstrap(familyTreeId)

  await db.transaction(
    'rw',
    [
      db.familyTrees,
      db.people,
      db.parentLinks,
      db.unions,
      db.familyGroups,
      db.familyGroupMembers,
      db.syncState,
    ],
    async () => {
      for (const { entity, record } of bootstrap.records) {
        // Straight to the table, deliberately not through lib/storage: a
        // storage function would record a change event, and an event for
        // a record that came FROM the server would be pushed back as
        // though this device had written it.
        await (tableFor(entity) as { put(value: SyncRecord): Promise<unknown> }).put(record)
      }

      // Written last, and in the same transaction: the position is only
      // true once the rows are in. Closing the application half way
      // leaves no cursor, so the whole bootstrap simply happens again.
      await db.syncState.put({
        familyTreeId,
        lastServerSeq: bootstrap.cursor.lastServerSeq,
        lastSyncedAt: new Date().toISOString(),
      })
    },
  )
}
