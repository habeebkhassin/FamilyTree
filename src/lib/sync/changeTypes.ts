import type {
  FamilyGroup,
  FamilyGroupMember,
  FamilyTree,
  ParentLink,
  Person,
  Union,
} from '../../types'

/**
 * The entities whose mutations are recorded in the change log.
 *
 * MediaRecord is deliberately absent. Events carry COMPLETE before/after
 * snapshots (see ChangeEvent), and a MediaRecord embeds a Blob — logging
 * one would copy binary data into every event and, later, into every sync
 * payload. Media needs object storage and a reference, which is a Phase 5
 * question of its own; until then media mutations stay unlogged and media
 * records are excluded from tombstoning.
 */
export type SyncEntity =
  | 'familyTree'
  | 'person'
  | 'parentLink'
  | 'union'
  | 'familyGroup'
  | 'familyGroupMember'

/** The record shapes the log can carry, matching SyncEntity one-for-one. */
export type SyncRecord = FamilyTree | Person | ParentLink | Union | FamilyGroup | FamilyGroupMember

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
