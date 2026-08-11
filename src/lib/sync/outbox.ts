import { db } from '../storage/db'
import type { ChangeEvent, OutboxEntry } from './changeTypes'

/**
 * The queue of events that will one day be uploaded.
 *
 * Phase 5A only fills it. There is no transport, no retry, no network
 * listener and no adapter — those arrive in Phase 5D, and they will find
 * the queue already populated with every change made in the meantime.
 *
 * Entries are keyed by event id precisely so that upload can be made
 * idempotent later: sending an event the server already accepted has to be
 * safe, and that is only true if the id was minted here and never changes.
 */
export function getOutboxEntries(familyTreeId: string): Promise<OutboxEntry[]> {
  return db.outbox.where('familyTreeId').equals(familyTreeId).sortBy('createdAt')
}

export function getOutboxSize(familyTreeId: string): Promise<number> {
  return db.outbox.where('familyTreeId').equals(familyTreeId).count()
}

/** The queued events themselves, oldest first — the order a future upload must preserve. */
export async function getPendingChangeEvents(familyTreeId: string): Promise<ChangeEvent[]> {
  const entries = await getOutboxEntries(familyTreeId)
  const pendingIds = new Set(entries.map((entry) => entry.eventId))
  const events = await db.changeEvents.where('familyTreeId').equals(familyTreeId).sortBy('clientSeq')
  return events.filter((event) => pendingIds.has(event.id))
}
