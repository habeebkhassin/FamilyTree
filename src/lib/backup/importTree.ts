import { db } from '../storage/db'
import type { ChangeEvent } from '../sync'
import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupCollection,
  type TreeBackup,
} from './backupTypes'

/**
 * Reading a backup back in — Phase A.
 *
 * Two rules shape everything here.
 *
 * VALIDATE COMPLETELY BEFORE WRITING ANYTHING. `parseBackup` reaches no
 * further than the parsed object; it opens no transaction and touches no
 * table. A malformed file is rejected while the database is still exactly
 * as it was.
 *
 * NEVER OVERWRITE SILENTLY. A tree whose id already exists is refused
 * outright. Restoring over live data is a decision only the person who
 * owns the data can make, and it needs a deliberate flow rather than a
 * side effect of opening a file.
 */

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns unknown JSON into a TreeBackup, or explains why it is not one.
 *
 * Deliberately structural rather than exhaustive: it checks the things
 * that make a file safe to apply — the format marker, the version, that
 * every collection is present and is an array of the length the manifest
 * claims, and that every row belongs to the tree the file names. It does
 * not re-validate every field of every record, because the file was
 * written by this application and the database has its own constraints;
 * what it guards against is a truncated, edited, or foreign file.
 */
export function parseBackup(raw: unknown): TreeBackup {
  const source = typeof raw === 'string' ? safeParseJson(raw) : raw

  if (!isObject(source)) throw new BackupError('This file is not a family tree backup.')
  if (source.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not a family tree backup.')
  }
  if (source.version !== BACKUP_VERSION) {
    throw new BackupError(
      `This backup is version ${String(source.version)}, and this app reads version ${BACKUP_VERSION}.`,
    )
  }

  const familyTreeId = source.familyTreeId
  if (typeof familyTreeId !== 'string' || familyTreeId.length === 0) {
    throw new BackupError('This backup does not say which family tree it holds.')
  }

  const data = source.data
  if (!isObject(data)) throw new BackupError('This backup has no data.')

  const familyTree = data.familyTree
  if (!isObject(familyTree) || familyTree.id !== familyTreeId) {
    throw new BackupError('This backup names one family tree and contains another.')
  }

  const counts = source.counts
  if (!isObject(counts)) throw new BackupError('This backup has no manifest.')

  for (const name of BACKUP_COLLECTIONS) {
    const rows = data[name]
    if (!Array.isArray(rows)) {
      throw new BackupError(`This backup is missing its ${name}.`)
    }
    // The manifest is what catches a file truncated in transit: the rows
    // are still valid JSON, there are simply fewer of them than the export
    // recorded.
    if (rows.length !== counts[name]) {
      throw new BackupError(
        `This backup is incomplete: it lists ${String(counts[name])} ${name} but contains ${rows.length}.`,
      )
    }
    // Cross-tree contamination, checked on the way in as well as on the
    // way out. A backup of one tree may never carry a row from another.
    for (const row of rows) {
      if (isObject(row) && 'familyTreeId' in row && row.familyTreeId !== familyTreeId) {
        throw new BackupError(`This backup contains ${name} belonging to a different family tree.`)
      }
    }
  }

  for (const name of ['syncState', 'governance'] as const) {
    const row = data[name]
    if (row !== null && row !== undefined && isObject(row) && row.familyTreeId !== familyTreeId) {
      throw new BackupError(`This backup contains ${name} belonging to a different family tree.`)
    }
  }

  return source as unknown as TreeBackup
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new BackupError('This file is not valid JSON.')
  }
}

export interface ImportResult {
  familyTreeId: string
  familyTreeName: string
  counts: Record<BackupCollection, number>
  mediaBlobsExcluded: number
}

/**
 * Writes a validated backup into the database, all of it or none of it.
 *
 * One Dexie transaction over every table the file touches, so a failure
 * part-way leaves nothing behind — there is no state in which half a
 * family exists.
 *
 * IDS ARE PRESERVED. Every record keeps the id it was exported with, which
 * is what makes a restored tree the same tree rather than a copy of it,
 * and what will let a future cloud adoption recognise records it has seen.
 *
 * The one exception is `ChangeEvent.clientSeq`, and it is not an identity:
 * its own definition says it "orders events produced by THIS device only".
 * Carrying the numbers across would collide with events this database
 * already holds for other trees. So events are re-keyed by the database in
 * the order the file lists them — which export wrote in clientSeq order —
 * and `ChangeEvent.id`, the real identity and the outbox's idempotency
 * key, is preserved exactly.
 */
export async function importFamilyTree(backup: TreeBackup): Promise<ImportResult> {
  const { familyTreeId, data } = backup

  const existing = await db.familyTrees.get(familyTreeId)
  if (existing) {
    throw new BackupError(
      `This family tree is already on this device: "${existing.name}". Importing would overwrite it, so it has been left alone.`,
    )
  }

  await db.transaction(
    'rw',
    [
      db.familyTrees,
      db.people,
      db.parentLinks,
      db.unions,
      db.media,
      db.familyGroups,
      db.familyGroupMembers,
      db.changeEvents,
      db.outbox,
      db.syncState,
      db.familyTreeMembers,
      db.personClaims,
      db.invitations,
      db.governance,
    ],
    async () => {
      // Re-checked inside the transaction. The check above is for a clear
      // error message; this one is for correctness, because the gap
      // between them is where a second import could otherwise slip in.
      if (await db.familyTrees.get(familyTreeId)) {
        throw new BackupError('This family tree was created while the import was running.')
      }

      await db.familyTrees.add(data.familyTree)
      await db.people.bulkAdd(data.people)
      await db.parentLinks.bulkAdd(data.parentLinks)
      await db.unions.bulkAdd(data.unions)
      await db.media.bulkAdd(data.media)
      await db.familyGroups.bulkAdd(data.familyGroups)
      await db.familyGroupMembers.bulkAdd(data.familyGroupMembers)

      // Stripped of clientSeq so the database assigns fresh ones, in file
      // order. `id` travels untouched.
      const events = data.changeEvents.map((event) => {
        const { clientSeq: _ignored, ...rest } = event
        return rest as ChangeEvent
      })
      await db.changeEvents.bulkAdd(events)

      await db.outbox.bulkAdd(data.outbox)
      if (data.syncState) await db.syncState.add(data.syncState)

      await db.familyTreeMembers.bulkAdd(data.familyTreeMembers)
      await db.personClaims.bulkAdd(data.personClaims)
      await db.invitations.bulkAdd(data.invitations)
      if (data.governance) await db.governance.add(data.governance)
    },
  )

  return {
    familyTreeId,
    familyTreeName: data.familyTree.name,
    counts: backup.counts,
    mediaBlobsExcluded: backup.mediaBlobsExcluded,
  }
}
