import type { Table } from 'dexie'
import { db } from './db'
import { isLive, SYNC_TABLES } from './internal'
import { getChangeEvent } from '../sync/changeLog'
import { recordChange } from '../sync/changeLog'
import type { SyncEntity, SyncRecord } from '../sync/changeTypes'

/**
 * Undo, built the only way the architecture permits.
 *
 * An event is never edited or removed to undo it. Instead the inverse
 * mutation is applied, which appends a NEW event. Reverting a revert is
 * therefore just another event, and the history reads as the sequence of
 * things that actually happened rather than a story rewritten to look
 * tidy. That append-only property is what makes the log usable as an
 * audit trail later.
 *
 *   #42  update  John -> Johnny
 *   #43  update  Johnny -> John      <- the undo of #42; #42 is untouched
 *
 * This lives in lib/storage rather than lib/sync because reverting WRITES
 * records. Keeping it here preserves the dependency direction — storage
 * depends on sync, never the other way round.
 */

/** Deliberately a lookup rather than a switch, so an unhandled entity is a type error. */
const TABLE_BY_ENTITY: Record<SyncEntity, Table<never, string>> = {
  familyTree: db.familyTrees as unknown as Table<never, string>,
  person: db.people as unknown as Table<never, string>,
  parentLink: db.parentLinks as unknown as Table<never, string>,
  union: db.unions as unknown as Table<never, string>,
  familyGroup: db.familyGroups as unknown as Table<never, string>,
  familyGroupMember: db.familyGroupMembers as unknown as Table<never, string>,
}

const ALL_ENTITY_TABLES = [
  db.familyTrees,
  db.people,
  db.parentLinks,
  db.unions,
  db.familyGroups,
  db.familyGroupMembers,
]

function tableFor(entity: SyncEntity): Table<SyncRecord, string> {
  return TABLE_BY_ENTITY[entity] as unknown as Table<SyncRecord, string>
}

/**
 * Applies the inverse of one recorded event.
 *
 *   create   -> tombstone the record
 *   update   -> write the previous snapshot back
 *   delete   -> clear the tombstone
 *   restore  -> tombstone again
 *
 * Returns false when there is nothing to do — the event does not exist, or
 * the record has since moved on in a way that makes a blind revert unsafe.
 * It never throws for ordinary "already undone" situations.
 */
export async function revertChangeEvent(clientSeq: number): Promise<boolean> {
  let reverted = false

  await db.transaction('rw', [...ALL_ENTITY_TABLES, ...SYNC_TABLES], async () => {
    const event = await getChangeEvent(clientSeq)
    if (!event) return

    const table = tableFor(event.entity)
    const current = await table.get(event.entityId)
    if (!current) return

    const now = new Date().toISOString()

    if (event.op === 'create' || event.op === 'restore') {
      // Inverse of bringing a record into existence is tombstoning it.
      if (!isLive(current)) return
      const after = { ...current, deletedAt: now, updatedAt: now } as SyncRecord
      await table.put(after)
      await recordChange({
        familyTreeId: event.familyTreeId,
        entity: event.entity,
        entityId: event.entityId,
        op: 'delete',
        before: current,
        after,
      })
      reverted = true
      return
    }

    if (event.op === 'delete') {
      if (!current.deletedAt) return
      const after = { ...current, deletedAt: undefined, updatedAt: now } as SyncRecord
      await table.put(after)
      await recordChange({
        familyTreeId: event.familyTreeId,
        entity: event.entity,
        entityId: event.entityId,
        op: 'restore',
        before: current,
        after,
      })
      reverted = true
      return
    }

    // update: put the previous snapshot back, keeping the live/tombstoned
    // state the record has now rather than resurrecting it as a side effect.
    if (!event.before) return
    const after = { ...event.before, updatedAt: now, deletedAt: current.deletedAt } as SyncRecord
    await table.put(after)
    await recordChange({
      familyTreeId: event.familyTreeId,
      entity: event.entity,
      entityId: event.entityId,
      op: 'update',
      before: current,
      after,
    })
    reverted = true
  })

  return reverted
}

/**
 * Clears a tombstone on any syncable record, recording a `restore`.
 *
 * The generic counterpart to restorePerson. Relationships tombstoned by a
 * cascading person delete are brought back one at a time through this —
 * see the note on restorePerson for why the cascade is not automatic.
 */
export async function restoreEntity(entity: SyncEntity, entityId: string): Promise<boolean> {
  let restored = false

  await db.transaction('rw', [...ALL_ENTITY_TABLES, ...SYNC_TABLES], async () => {
    const table = tableFor(entity)
    const before = await table.get(entityId)
    if (!before || !before.deletedAt) return

    const now = new Date().toISOString()
    const after = { ...before, deletedAt: undefined, updatedAt: now } as SyncRecord
    await table.put(after)
    await recordChange({
      familyTreeId: entity === 'familyTree' ? entityId : (before as { familyTreeId: string }).familyTreeId,
      entity,
      entityId,
      op: 'restore',
      before,
      after,
    })
    restored = true
  })

  return restored
}
