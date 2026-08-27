import { db } from '../storage/db'
import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupCollection,
  type BackupMediaRecord,
  type TreeBackup,
} from './backupTypes'

/**
 * Reads one family tree out of the database, whole — Phase A.
 *
 * Everything is scoped by `familyTreeId`, so a backup of one tree can
 * never contain a row from another. That is enforced by the queries rather
 * than trusted: every collection is fetched with a `where('familyTreeId')`
 * clause, and import checks the same property again on the way back in.
 *
 * Tombstoned records are INCLUDED. A backup is a copy of the database, not
 * of what the interface currently shows — dropping tombstones would make a
 * restore silently un-delete people, and would break the change log, whose
 * events reference them.
 */
export async function exportFamilyTree(familyTreeId: string): Promise<TreeBackup> {
  const familyTree = await db.familyTrees.get(familyTreeId)
  if (!familyTree) {
    throw new Error(`Cannot export: no family tree with id ${familyTreeId}`)
  }

  // Written out per table rather than through a generic helper: Dexie's
  // row types are what make the manifest below type-check, and a helper
  // taking "any table with a familyTreeId" erases them to unknown.
  const [
    people,
    parentLinks,
    unions,
    mediaRecords,
    familyGroups,
    familyGroupMembers,
    outbox,
    familyTreeMembers,
    personClaims,
    invitations,
  ] = await Promise.all([
    db.people.where('familyTreeId').equals(familyTreeId).toArray(),
    db.parentLinks.where('familyTreeId').equals(familyTreeId).toArray(),
    db.unions.where('familyTreeId').equals(familyTreeId).toArray(),
    db.media.where('familyTreeId').equals(familyTreeId).toArray(),
    db.familyGroups.where('familyTreeId').equals(familyTreeId).toArray(),
    db.familyGroupMembers.where('familyTreeId').equals(familyTreeId).toArray(),
    db.outbox.where('familyTreeId').equals(familyTreeId).toArray(),
    db.familyTreeMembers.where('familyTreeId').equals(familyTreeId).toArray(),
    db.personClaims.where('familyTreeId').equals(familyTreeId).toArray(),
    db.invitations.where('familyTreeId').equals(familyTreeId).toArray(),
  ])

  // Sorted by clientSeq so the file preserves the order this device
  // produced them in, which is what lets import re-key them without
  // losing their sequence.
  const changeEvents = await db.changeEvents
    .where('familyTreeId')
    .equals(familyTreeId)
    .sortBy('clientSeq')

  const syncState = (await db.syncState.get(familyTreeId)) ?? null
  const governance = (await db.governance.get(familyTreeId)) ?? null

  // The bytes are dropped, deliberately, and counted so the file says so.
  let mediaBlobsExcluded = 0
  const media: BackupMediaRecord[] = mediaRecords.map((record) => {
    const { blob, ...rest } = record
    if (blob) mediaBlobsExcluded += 1
    return rest
  })

  const data = {
    familyTree,
    people,
    parentLinks,
    unions,
    media,
    familyGroups,
    familyGroupMembers,
    changeEvents,
    outbox,
    syncState,
    familyTreeMembers,
    personClaims,
    invitations,
    governance,
  }

  const counts = Object.fromEntries(
    BACKUP_COLLECTIONS.map((name) => [name, data[name].length]),
  ) as Record<BackupCollection, number>

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: db.verno,
    familyTreeId,
    familyTreeName: familyTree.name,
    counts,
    mediaBlobsExcluded,
    data,
  }
}

/** Pretty-printed, because a backup somebody keeps should be readable. */
export function serialiseBackup(backup: TreeBackup): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * A filename that sorts usefully and survives a filesystem.
 *
 * Date only, not a full timestamp: two exports on one day are rare, and a
 * colon-free readable name is worth more than uniqueness the browser will
 * disambiguate anyway.
 */
export function backupFilename(backup: TreeBackup): string {
  const safeName = backup.familyTreeName
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const day = backup.exportedAt.slice(0, 10)
  return `${safeName || 'family-tree'}-backup-${day}.json`
}
