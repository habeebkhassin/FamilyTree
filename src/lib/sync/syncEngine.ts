import { db } from '../storage/db'
import type { ChangeEvent, SyncEntity, SyncRecord } from './changeTypes'
import { reconcileEvents } from './reconciler'
import type { FieldConflict } from './reconciler'
import type { RemoteAdapter } from './remoteAdapter'

/**
 * One synchronisation cycle — Milestone 3.
 *
 * Push what is queued, then pull what is new, then reconcile it in. The
 * order matters and so does where the cursor moves.
 *
 *
 * CRASH SAFETY COMES FROM WHERE THE TRANSACTIONS ARE
 * ──────────────────────────────────────────────────
 * Closing the application at any point must lose nothing and corrupt
 * nothing. Three properties give that, and none of them needs a recovery
 * routine:
 *
 *   An outbox entry is only cleared in the same Dexie transaction that
 *   writes the server's answer onto the event. Crash before it and the
 *   event is still queued; it will be offered again, and the server
 *   recognises its id and returns the sequence it already had. Nothing is
 *   applied twice.
 *
 *   Pulled events are stored, applied to the records, and the cursor is
 *   advanced in ONE transaction. Crash before it and the cursor has not
 *   moved, so the same batch arrives again and produces the same result —
 *   applying a remote event twice is the same as applying it once.
 *
 *   The cursor is the last sequence SUCCESSFULLY APPLIED, never the last
 *   requested or received. A cursor that ran ahead of the data would skip
 *   events permanently, which is the one failure that cannot be repaired
 *   by syncing again.
 *
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * It does not merge. `reconcileEvents` does that, unchanged, and this
 * only writes down what it decided. It does not resolve conflicts, retry
 * on a timer, or listen to anything.
 */

export type SyncFailureKind =
  /** Nobody is signed in, or the session has expired. */
  | 'authentication'
  /** Signed in, but not permitted on this tree any more. */
  | 'authorization'
  /** The request never completed. Retrying later is the right answer. */
  | 'network'
  /** The server was reached and refused. Retrying will not help. */
  | 'server'

export interface SyncFailure {
  kind: SyncFailureKind
  message: string
}

export interface SyncOutcome {
  /** Events the server accepted, including ones it already held. */
  pushed: number
  /** Events it definitively refused. They stay in the outbox, marked. */
  rejected: { eventId: string; reason: string }[]
  /** Events received and applied. */
  pulled: number
  /** Conflicts the reconciler reported while applying them. */
  conflicts: FieldConflict[]
  /** Where the tree has got to, after everything that succeeded. */
  cursor: number | null
  /** Set when the cycle stopped early. Whatever had already been applied stays applied. */
  failure?: SyncFailure
}

/**
 * What kind of problem this was.
 *
 * Read from the message because that is all a transport gives us, and
 * kept deliberately coarse: the caller needs to know whether to retry
 * later, tell the user to sign in, or stop asking.
 */
export function classifyFailure(error: unknown): SyncFailure {
  const message = error instanceof Error ? error.message : String(error)

  if (/not signed in|jwt|session|expired/i.test(message)) {
    return { kind: 'authentication', message: 'Sign in again to keep syncing.' }
  }
  if (/permission|not allowed|row-level security|policy/i.test(message)) {
    return {
      kind: 'authorization',
      message: 'You no longer have permission to sync this family tree.',
    }
  }
  if (/fetch|network|offline|timeout|connection|ECONN|Failed to fetch/i.test(message)) {
    return { kind: 'network', message: 'No connection. Your changes are saved and will sync later.' }
  }
  return { kind: 'server', message }
}

/** Which Dexie table holds each kind of record. */
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

const RECORD_TABLES = [
  db.familyTrees,
  db.people,
  db.parentLinks,
  db.unions,
  db.familyGroups,
  db.familyGroupMembers,
] as const

/**
 * Events still waiting to go, oldest first.
 *
 * Rejected entries are skipped rather than removed: they keep their
 * reason so the interface can say something happened, and they are not
 * offered again because the server has already refused them once.
 */
export async function getPendingEvents(familyTreeId: string): Promise<ChangeEvent[]> {
  const entries = await db.outbox.where('familyTreeId').equals(familyTreeId).sortBy('createdAt')
  const pending = new Set(entries.filter((entry) => !entry.rejectedAt).map((entry) => entry.eventId))
  if (pending.size === 0) return []

  const events = await db.changeEvents.where('familyTreeId').equals(familyTreeId).sortBy('clientSeq')
  return events.filter((event) => pending.has(event.id))
}

/** Entries the server refused, so the interface can report them. */
export function getRejectedEntries(familyTreeId: string) {
  return db.outbox
    .where('familyTreeId')
    .equals(familyTreeId)
    .filter((entry) => Boolean(entry.rejectedAt))
    .toArray()
}

/**
 * Record what the server said about events we offered.
 *
 * One transaction: the authoritative sequence lands on the event and the
 * outbox row goes, together. There is no moment where an event looks
 * accepted but is still queued, or is dequeued without its sequence.
 */
async function recordPushResult(
  accepted: ChangeEvent[],
  rejected: { eventId: string; reason: string }[],
): Promise<void> {
  if (accepted.length === 0 && rejected.length === 0) return
  const rejectedAt = new Date().toISOString()

  await db.transaction('rw', [db.changeEvents, db.outbox], async () => {
    for (const event of accepted) {
      const stored = await db.changeEvents.where('id').equals(event.id).first()
      if (stored) {
        await db.changeEvents.update(stored.clientSeq, {
          serverSeq: event.serverSeq,
          recordedAt: event.recordedAt,
        })
      }
      await db.outbox.delete(event.id)
    }

    for (const failure of rejected) {
      // Kept, not deleted. The work and the reason both survive, and it
      // is not offered again.
      const entry = await db.outbox.get(failure.eventId)
      if (entry) {
        await db.outbox.put({ ...entry, rejectedAt, rejectedReason: failure.reason })
      }
    }
  })
}

/**
 * Write one merged record into the local database.
 *
 * Straight to the table, deliberately NOT through lib/storage: a storage
 * function would record a change event, and an event recorded for a
 * remote change would be pushed back as though this device had made it.
 */
async function applyRecords(
  records: { entity: SyncEntity; record: SyncRecord | null }[],
): Promise<void> {
  for (const { entity, record } of records) {
    if (!record) continue
    await (tableFor(entity) as { put(value: SyncRecord): Promise<unknown> }).put(record)
  }
}

/**
 * Apply one pulled batch and move the cursor, in a single transaction.
 *
 * Idempotent by construction: an event already stored is matched by id
 * and updated rather than added again, and the records are merged from
 * the events rather than accumulated, so the same batch applied twice
 * leaves the same state.
 */
async function applyPulled(
  familyTreeId: string,
  incoming: ChangeEvent[],
  cursor: number | null,
): Promise<FieldConflict[]> {
  let conflicts: FieldConflict[] = []

  await db.transaction(
    'rw',
    [db.changeEvents, db.outbox, db.syncState, ...RECORD_TABLES],
    async () => {
      // Only the local events that touch the same records as this batch,
      // and only ones not yet accepted by the server. Anything already
      // accepted is in the incoming stream's history, and replaying the
      // whole log on every sync is exactly what this must not do.
      const touched = new Set(incoming.map((event) => `${event.entity} ${event.entityId}`))
      const pendingIds = new Set(
        (await db.outbox.where('familyTreeId').equals(familyTreeId).toArray())
          .filter((entry) => !entry.rejectedAt)
          .map((entry) => entry.eventId),
      )
      const localPending = (
        await db.changeEvents.where('familyTreeId').equals(familyTreeId).toArray()
      ).filter(
        (event) =>
          pendingIds.has(event.id) && touched.has(`${event.entity} ${event.entityId}`),
      )

      const result = reconcileEvents(localPending, incoming)
      conflicts = result.conflicts

      // Store the remote events. Matched by id so a redelivery updates
      // rather than duplicates.
      for (const event of incoming) {
        const existing = await db.changeEvents.where('id').equals(event.id).first()
        if (existing) {
          await db.changeEvents.update(existing.clientSeq, {
            serverSeq: event.serverSeq,
            recordedAt: event.recordedAt,
          })
        } else {
          const { clientSeq: _ignored, ...rest } = event
          await db.changeEvents.add(rest as ChangeEvent)
        }
      }

      await applyRecords(result.records)

      // Last, and only now: the data is in, so the position is true.
      await db.syncState.put({
        familyTreeId,
        lastServerSeq: cursor,
        lastSyncedAt: new Date().toISOString(),
      })
    },
  )

  return conflicts
}

/**
 * Push, then pull, then reconcile.
 *
 * Pushing first means this device's work is offered before it asks for
 * anybody else's, so the events it pulls back already include its own —
 * which keeps the local log and the server's in agreement rather than
 * leaving the device to merge against a version of the tree that does not
 * include what it just sent.
 */
export async function syncTree(
  familyTreeId: string,
  adapter: RemoteAdapter,
  options: { maxPullBatches?: number } = {},
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    pushed: 0,
    rejected: [],
    pulled: 0,
    conflicts: [],
    cursor: (await db.syncState.get(familyTreeId))?.lastServerSeq ?? null,
  }

  // ── push ──────────────────────────────────────────────────────────
  try {
    const pending = await getPendingEvents(familyTreeId)
    if (pending.length > 0) {
      const result = await adapter.push(familyTreeId, pending)
      await recordPushResult(result.accepted, result.rejected)
      outcome.pushed = result.accepted.length
      outcome.rejected = result.rejected
    }
  } catch (error) {
    // Nothing was recorded, so every event is still queued and will be
    // offered again. Stopping here is right: pulling after a failed push
    // would merge against a server that has not seen this device's work.
    return { ...outcome, failure: classifyFailure(error) }
  }

  // ── pull ──────────────────────────────────────────────────────────
  const maxBatches = options.maxPullBatches ?? 50
  for (let batch = 0; batch < maxBatches; batch += 1) {
    try {
      const page = await adapter.pull(familyTreeId, { lastServerSeq: outcome.cursor })
      if (page.events.length === 0) {
        // Genuinely nothing newer — an error would have thrown.
        break
      }

      const conflicts = await applyPulled(familyTreeId, page.events, page.cursor.lastServerSeq)
      outcome.pulled += page.events.length
      outcome.conflicts.push(...conflicts)
      outcome.cursor = page.cursor.lastServerSeq

      if (!page.hasMore) break
    } catch (error) {
      // Whatever earlier batches applied stays applied, and the cursor
      // records exactly that. The next attempt resumes from there.
      return { ...outcome, failure: classifyFailure(error) }
    }
  }

  return outcome
}
