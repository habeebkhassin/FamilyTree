import { db } from './db'

/**
 * Internal helpers shared by the storage modules. Not exported from the
 * package barrel — nothing outside lib/storage should need these.
 */

/**
 * Every mutating transaction must include these so the record write and
 * its change event commit together. Spread into the table list:
 *
 *   db.transaction('rw', [db.people, ...SYNC_TABLES], ...)
 *
 * `syncState` is in the list from Milestone 3 because recordChange reads
 * the tree's cursor to stamp each event with the position this device had
 * reached. Reading it inside the same transaction is what makes the
 * watermark atomic with the event rather than a value that could have
 * moved between the two.
 */
export const SYNC_TABLES = [db.changeEvents, db.outbox, db.syncState] as const

/**
 * A record is live unless it carries a tombstone.
 *
 * Records written before the Phase 5A migration have no `deletedAt` at
 * all, which correctly reads as live — that is why no data rewrite was
 * needed to introduce tombstones.
 *
 * The type predicate narrows the TRUE branch to a present record, which is
 * what the dominant `if (!isLive(x)) return` guard needs. It says nothing
 * useful about the false branch — a tombstoned record is still a record —
 * so where the tombstoned row itself is wanted, test `record.deletedAt`
 * directly rather than reaching for this.
 */
export function isLive<T extends { deletedAt?: string }>(record: T | undefined): record is T {
  return record !== undefined && !record.deletedAt
}

export function liveOnly<T extends { deletedAt?: string }>(records: T[]): T[] {
  return records.filter((record) => !record.deletedAt)
}
