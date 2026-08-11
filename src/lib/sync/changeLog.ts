import { db } from '../storage/db'
import { currentChangeSetId } from './changeSet'
import type { ChangeEvent, ChangeOperation, NewChangeEvent, SyncEntity, SyncRecord } from './changeTypes'

export interface RecordChangeInput {
  familyTreeId: string
  entity: SyncEntity
  entityId: string
  op: ChangeOperation
  before: SyncRecord | null
  after: SyncRecord | null
}

/**
 * Appends one event to the log and queues it for a future upload.
 *
 * MUST be called from inside the same Dexie transaction as the mutation it
 * describes, with `db.changeEvents` and `db.outbox` in that transaction's
 * scope. Dexie joins the ambient transaction, so the record write, the
 * event, and the outbox entry commit or roll back together — there is no
 * window in which the data changed but the event is missing, or an event
 * exists for a mutation that failed.
 *
 * This is the only function in the codebase that writes to the log, and
 * nothing anywhere updates or deletes from it.
 */
export async function recordChange(input: RecordChangeInput): Promise<void> {
  const createdAt = new Date().toISOString()
  const event: NewChangeEvent = {
    id: crypto.randomUUID(),
    // Derived from the ambient transaction, so a cascade groups itself
    // without any caller having to pass an id down.
    changeSetId: currentChangeSetId(),
    familyTreeId: input.familyTreeId,
    // No authentication in Phase 5A. Genuinely nobody, not a placeholder.
    actorUserId: null,
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    before: input.before,
    after: input.after,
    createdAt,
    // Assigned by the server when one exists; fabricating a value here
    // would corrupt the ordering later reconciliation depends on.
    serverSeq: null,
    recordedAt: null,
  }

  // clientSeq is the autoincrement primary key, so Dexie fills it in.
  await db.changeEvents.add(event as ChangeEvent)
  await db.outbox.add({ eventId: event.id, familyTreeId: event.familyTreeId, createdAt })
}

/** Full history for one tree, oldest first. */
export function getChangeEvents(familyTreeId: string): Promise<ChangeEvent[]> {
  return db.changeEvents.where('familyTreeId').equals(familyTreeId).sortBy('clientSeq')
}

/** History for a single record — what the future per-person history view will read. */
export function getChangeEventsForEntity(entity: SyncEntity, entityId: string): Promise<ChangeEvent[]> {
  return db.changeEvents.where('[entity+entityId]').equals([entity, entityId]).sortBy('clientSeq')
}

export function getChangeEvent(clientSeq: number): Promise<ChangeEvent | undefined> {
  return db.changeEvents.get(clientSeq)
}

/**
 * Every event produced by one logical action, oldest first — what a future
 * grouped undo or a single audit-trail entry will read. Phase 5A only
 * records the grouping; nothing acts on it yet.
 */
export function getChangeSet(changeSetId: string): Promise<ChangeEvent[]> {
  return db.changeEvents.where('changeSetId').equals(changeSetId).sortBy('clientSeq')
}

/** The most recent events for a tree, newest first — for an "activity" view. */
export async function getRecentChangeEvents(familyTreeId: string, limit = 50): Promise<ChangeEvent[]> {
  const events = await getChangeEvents(familyTreeId)
  return events.slice(-limit).reverse()
}
