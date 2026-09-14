import type {
  FamilyGroup,
  FamilyGroupMember,
  FamilyTree,
  MediaRecord,
  ParentLink,
  Person,
  Union,
} from '../../types'

/**
 * The entities whose mutations are recorded in the change log.
 *
 * MediaRecord was absent for a good reason: events carry COMPLETE
 * before/after snapshots, and the record used to embed a Blob, so logging
 * one would have copied binary into every event and every sync payload.
 *
 * Milestone 5 moved the bytes out rather than bending that rule. A
 * MediaRecord is now plain JSON describing a photograph and naming where
 * its bytes live; the bytes themselves are in a local-only table and in
 * object storage. So it logs, tombstones and syncs exactly like a Person,
 * and media metadata needs no machinery of its own.
 */
export type SyncEntity =
  | 'familyTree'
  | 'person'
  | 'parentLink'
  | 'union'
  | 'familyGroup'
  | 'familyGroupMember'
  | 'media'

/** The record shapes the log can carry, matching SyncEntity one-for-one. */
export type SyncRecord =
  | FamilyTree
  | Person
  | ParentLink
  | Union
  | FamilyGroup
  | FamilyGroupMember
  | MediaRecord

/**
 * Deliberately small.
 *
 * `delete` writes a tombstone rather than removing a row, and `restore`
 * clears one. Neither is a physical removal, so both are replayable and
 * both are reversible.
 */
export type ChangeOperation = 'create' | 'update' | 'delete' | 'restore'

/**
 * One immutable, attributed, ordered record of something that happened.
 *
 * APPEND ONLY. Once written, an event is never updated or removed — there
 * is deliberately no updateChangeEvent or deleteChangeEvent anywhere in
 * the codebase. Undoing a mutation means applying the inverse mutation,
 * which records a NEW event; the original stays exactly as it was. That
 * property is what will later make the log usable as an audit trail, a
 * sync feed, and the basis for conflict resolution all at once.
 *
 * Snapshots are complete records, not field diffs. It costs more space,
 * but it means any past state can be reconstructed without replaying the
 * whole log from the beginning, and a revert never has to guess.
 */
export interface ChangeEvent {
  /**
   * Local ordering, assigned by Dexie's autoincrement inside the same
   * transaction as the mutation. Orders events produced by THIS device
   * only — it is not, and must not be confused with, `serverSeq`.
   */
  clientSeq: number
  /**
   * Stable identity, generated on the client. Doubles as the idempotency
   * key for the outbox: re-sending an event the server already has must
   * be a no-op, so the id is generated here and never reassigned.
   */
  id: string
  /**
   * Groups the events produced by ONE logical user action.
   *
   * Deleting a person is a single thing a person did, but it necessarily
   * touches their ParentLinks, Unions, group memberships and any group
   * that named them as founder. Each of those stays its own immutable
   * event — nothing is merged — and they all carry the same
   * `changeSetId`, so an audit view can say "Habeeb deleted Ayesha" once
   * instead of listing six unrelated-looking rows, and a future grouped
   * undo has something to undo.
   *
   * An ordinary single-record edit gets its own id too; a change set of
   * one is still a change set.
   */
  changeSetId: string
  familyTreeId: string
  /**
   * Who did it: the id of the device-local actor in effect at the time
   * (see lib/identity/localActor).
   *
   * Named `actorId` rather than `actorUserId` because a local actor is NOT
   * a user account — it is a self-asserted name on one device. It is
   * ATTRIBUTION, never authorization: nothing may grant a capability on the
   * strength of this field, because the client that writes it also chooses
   * it. When accounts exist, an actor is linked to one rather than
   * replaced.
   *
   * Null means genuinely unattributed, and stays null: events written
   * before this device had any identity are left exactly as recorded rather
   * than backfilled with an actor who was not there.
   */
  actorId: string | null
  entity: SyncEntity
  entityId: string
  op: ChangeOperation
  /** Complete record as it was, or null for a create. */
  before: SyncRecord | null
  /** Complete record as it became. Never null in 5A: a delete stores the tombstoned record. */
  after: SyncRecord | null
  /** Client clock. Fine for display; never relied on for ordering. */
  createdAt: string
  /**
   * Total order across all devices, assigned by the server when the event
   * is accepted. Always null in Phase 5A — there is no server, and
   * inventing a value here would make later reconciliation unsound.
   */
  serverSeq: number | null
  /** Server clock, set when the server accepts the event. Null until then. */
  recordedAt: string | null
  /**
   * How far this device had synced when it wrote the event — Milestone 3.
   *
   * The watermark the reconciler asked for by name. Without it, whether
   * two edits were concurrent is inferred by comparing an event's `before`
   * value against the merged value, which detects VALUE divergence rather
   * than CAUSAL divergence: a field that returns to an earlier value makes
   * a genuinely concurrent write look sequential, and with no serverSeq
   * the only other ordering signal is a device clock.
   *
   * With it the question is decidable. An event whose watermark is at or
   * past another event's serverSeq was written by somebody who had already
   * seen that event, so the two are sequential however their values look.
   *
   * Null on every event written before this existed, and null while a tree
   * has never synced — both correctly read as "nothing was known", which
   * falls back to the previous behaviour rather than claiming knowledge
   * the author did not have.
   */
  basedOnServerSeq: number | null
}

/** clientSeq is assigned by the database on insert, so callers never supply it. */
export type NewChangeEvent = Omit<ChangeEvent, 'clientSeq'>

/**
 * An event still awaiting upload.
 *
 * Keyed by the event id so that queueing the same event twice is
 * impossible, which is the property a retry loop will depend on in Phase
 * 5D. Phase 5A only ever fills this table — nothing drains it, and no
 * network call exists.
 */
export interface OutboxEntry {
  eventId: string
  familyTreeId: string
  createdAt: string
  /**
   * Set when the server definitively refused this event — Milestone 3.
   *
   * The row STAYS. Deleting a rejected event would lose both the work and
   * the explanation, and retrying it forever would block everything queued
   * behind it. So a rejected entry stops being pending, keeps its reason,
   * and remains something the sync layer and the interface can see and
   * report.
   *
   * Absent means still pending, which is what every entry written before
   * this existed correctly reads as.
   */
  rejectedAt?: string
  rejectedReason?: string
}

/**
 * Where a tree has got to with the server.
 *
 * `lastServerSeq` is null in Phase 5A: nothing has ever been synced, and
 * recording a fabricated position would be worse than recording none.
 */
export interface SyncState {
  familyTreeId: string
  lastServerSeq: number | null
  lastSyncedAt: string | null
}
