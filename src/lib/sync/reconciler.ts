import type { ChangeEvent, SyncEntity, SyncRecord } from './changeTypes'

/**
 * Pure conflict reconciliation over ChangeEvent streams — Phase 5B-3.
 *
 * This module has NO runtime imports. It never touches Dexie, React,
 * localStorage, the network, or the clock; the only import above is a type
 * import, which is erased at build time. Everything it knows comes from the
 * events it is handed, which is what makes it exhaustively testable against
 * synthetic streams years before a backend exists.
 *
 * It resolves SYNCHRONIZATION conflicts only. Whether the resulting family
 * structure is cyclic, duplicated, or genealogically plausible is not its
 * business — those invariants belong to lib/storage and are enforced when
 * records are written.
 *
 *
 * ORDERING
 * ────────
 * Events are placed in one total order:
 *
 *   1. `serverSeq` ascending, for events the server has accepted. This is
 *      the only authoritative ordering that exists.
 *   2. Accepted events (serverSeq set) before pending ones (serverSeq
 *      null). Not an assumption: an unaccepted event will by definition be
 *      assigned a serverSeq greater than every one already handed out.
 *   3. Among pending events, `createdAt` ascending — a client wall clock,
 *      unreliable across devices, and reported as such via `resolvedBy`.
 *   4. `id` ascending, as a final tie-break. Arbitrary but total, so the
 *      result never depends on input order. A conflict decided this way is
 *      flagged `resolvedBy: 'eventId'` rather than quietly presented as
 *      though something meaningful chose the winner.
 *
 * `clientSeq` is deliberately never read. It is a per-device autoincrement:
 * the SAME logical event carries different clientSeq values on different
 * devices, so using it to order across devices would be actively wrong.
 *
 *
 * CONFLICT DETECTION
 * ──────────────────
 * Last-writer-wins is applied PER FIELD, never per record, so two devices
 * editing different fields of one person both keep their work.
 *
 * Whether two edits are genuinely concurrent is not guessed: events carry
 * complete `before` snapshots, so if an event's `before[field]` matches the
 * value already merged, its author had seen that value and is simply
 * writing on top of it — an ordinary sequential edit, not a conflict. If it
 * does NOT match, the author was working from a base that no longer holds,
 * which is exactly what a concurrent edit looks like. Only that case is
 * reported.
 *
 *
 * TOMBSTONES
 * ──────────
 * `deletedAt` is treated as an ordinary field, which makes the whole
 * delete/restore matrix fall out of field-level LWW with no special cases:
 * an edit and a delete touch different fields so both survive (the record
 * ends up tombstoned but carrying the edit, and the tombstone is
 * reversible), while a delete and a restore contend for the same field and
 * one wins. Nothing is ever physically erased.
 *
 *
 * LIMITS — DETERMINISTIC, BUT NOT CAUSALLY PERFECT
 * ────────────────────────────────────────────────
 * The same events always produce the same result, in any order. That is
 * not the same as always producing the RIGHT result, and two known gaps
 * are accepted rather than papered over:
 *
 *   - ABA. Causality is inferred by comparing an event's `before` value
 *     with the merged value, so it detects VALUE divergence, not CAUSAL
 *     divergence. If a field returns to an earlier value, a concurrent
 *     write against that value is indistinguishable from a sequential one
 *     and no conflict is reported. The outcome stays deterministic and
 *     reversible; it is simply resolved silently.
 *
 *   - Client clock skew. With no serverSeq, `createdAt` is the only
 *     ordering signal available for pending events, and it comes from
 *     device clocks that may disagree. Conflicts decided this way are
 *     marked `resolvedBy: 'createdAt'` so the caller can tell.
 *
 * Both are closed, for events that carry one, by `basedOnServerSeq` —
 * the watermark this file asked for by name, added in Milestone 3 once a
 * server existed to define what it counts. Where both events have one,
 * causality is read rather than inferred: see `hadSeen`.
 *
 * It closes them only where it is present. An event written before the
 * watermark existed, or on a tree that has never synced, carries null and
 * falls back to the behaviour described above — which is the honest
 * reading of "this device knew nothing", and the reason no historical
 * event had to be rewritten to introduce it.
 *
 * And it changes only which conflicts are REPORTED. The total order below
 * is untouched, so the merged record is exactly what it always was.
 */

/** How the winner of a field was chosen over the loser. */
export type ConflictResolution =
  /** Both events were server-accepted; their total order decided it. */
  | 'serverSeq'
  /** One was server-accepted and the other is still pending locally. */
  | 'acceptedBeforePending'
  /** Both pending: decided by client wall clock, which may be skewed. */
  | 'createdAt'
  /** Nothing in the events distinguished them. Deterministic, but arbitrary. */
  | 'eventId'

/**
 * One field that two events set to different values without either having
 * seen the other.
 *
 * The losing value is kept here rather than discarded — the log still holds
 * the losing event in full, and this is the index into it.
 */
export interface FieldConflict {
  entity: SyncEntity
  entityId: string
  field: string
  winnerEventId: string
  loserEventId: string
  winnerValue: unknown
  loserValue: unknown
  winnerActorId: string | null
  loserActorId: string | null
  resolvedBy: ConflictResolution
}

/** The merged state of one record after every event has been applied. */
export interface ReconciledRecord {
  entity: SyncEntity
  entityId: string
  /** Null only when the events never revealed a complete record. */
  record: SyncRecord | null
  /** True when the merged record carries a tombstone. Reversible. */
  deleted: boolean
  /** The last event in total order that touched this record. */
  lastEventId: string
}

export type ReconciliationAnomalyKind =
  /** One event id arrived carrying two substantively different payloads. */
  | 'duplicateEventId'
  /** create/update/delete/restore with no `after` snapshot. */
  | 'missingAfter'
  /** The `after` snapshot's own id disagrees with the event's entityId. */
  | 'entityIdMismatch'

/**
 * Something structurally wrong with the input.
 *
 * Reported rather than thrown: a malformed event from one device must not
 * take down the reconciliation of everything else.
 */
export interface ReconciliationAnomaly {
  kind: ReconciliationAnomalyKind
  eventId: string
  entity: SyncEntity
  entityId: string
  detail: string
}

export interface ReconciliationResult {
  /** Deduplicated and totally ordered. The event objects are the originals. */
  events: ChangeEvent[]
  records: ReconciledRecord[]
  conflicts: FieldConflict[]
  anomalies: ReconciliationAnomaly[]
}

/** Set once at creation and never rewritten, so they are copied, not merged. */
const IMMUTABLE_FIELDS = new Set(['id', 'familyTreeId', 'createdAt'])

/**
 * Bookkeeping that EVERY mutation touches. Merged like any other field, but
 * never reported as a conflict — otherwise two devices editing genuinely
 * different fields would collide on `updatedAt` every single time and bury
 * the real conflicts in noise.
 */
const BOOKKEEPING_FIELDS = new Set(['updatedAt'])

/**
 * Per-device and per-transport, so they play no part in deciding whether
 * two copies of one event id are the same event.
 */
const NON_SUBSTANTIVE_FIELDS = new Set(['clientSeq', 'serverSeq', 'recordedAt'])

/** Stable stringify: key order can never influence a comparison. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => compareStrings(a, b))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`
}

function compareStrings(a: string, b: string): number {
  // Explicit rather than localeCompare, whose result depends on the runtime
  // locale — determinism must not vary by machine.
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * `undefined` and "key absent" mean the same thing throughout the record
 * types: a restore writes `deletedAt: undefined`, a record that was never
 * deleted simply has no such key, and both are live.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === undefined && b === undefined
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return canonicalJson(a) === canonicalJson(b)
}

/** The fields this event actually moved, sorted so conflicts report in a stable order. */
function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set(Object.keys(after))
  if (before) for (const key of Object.keys(before)) keys.add(key)

  const changed: string[] = []
  for (const key of keys) {
    if (!valuesEqual(before ? before[key] : undefined, after[key])) changed.push(key)
  }
  return changed.sort(compareStrings)
}

/**
 * Whether the author of `later` had already seen `earlier` — Milestone 3.
 *
 * The watermark makes this decidable. An event carries the position its
 * device had synced to when it was written, so if that position is at or
 * past the sequence `earlier` was given, its author was working on top of
 * it. That is a sequential edit however the values happen to look.
 *
 * Without it, concurrency is inferred by comparing an event's `before`
 * value with the merged value — which detects VALUE divergence rather
 * than CAUSAL divergence, and so reports a conflict whenever a field
 * returns to a value somebody else had already moved away from.
 *
 * Deliberately affects only whether a conflict is REPORTED. Which value
 * wins is still decided by the total order and nothing here touches it,
 * so a merged record is byte-for-byte what it was before this existed.
 * Events with no watermark — everything written before Milestone 3, and
 * everything from a tree that has never synced — answer false and fall
 * back to the previous behaviour rather than claiming knowledge their
 * author did not have.
 */
function hadSeen(later: ChangeEvent, earlier: ChangeEvent): boolean {
  if (later.basedOnServerSeq === null || earlier.serverSeq === null) return false
  return later.basedOnServerSeq >= earlier.serverSeq
}

/** The total order described at the top of this file. */
function compareEvents(a: ChangeEvent, b: ChangeEvent): number {
  if (a.serverSeq !== null && b.serverSeq !== null) {
    if (a.serverSeq !== b.serverSeq) return a.serverSeq - b.serverSeq
  } else if (a.serverSeq !== null) {
    return -1
  } else if (b.serverSeq !== null) {
    return 1
  } else if (a.createdAt !== b.createdAt) {
    return compareStrings(a.createdAt, b.createdAt)
  }
  return compareStrings(a.id, b.id)
}

function resolutionBetween(winner: ChangeEvent, loser: ChangeEvent): ConflictResolution {
  if (winner.serverSeq !== null && loser.serverSeq !== null) {
    return winner.serverSeq === loser.serverSeq ? 'eventId' : 'serverSeq'
  }
  if (winner.serverSeq !== null || loser.serverSeq !== null) return 'acceptedBeforePending'
  if (winner.createdAt !== loser.createdAt) return 'createdAt'
  return 'eventId'
}

/** Everything that identifies an event as the same logical event on any device. */
function substantiveJson(event: ChangeEvent): string {
  const entries = Object.entries(event as unknown as Record<string, unknown>)
    .filter(([key, value]) => !NON_SUBSTANTIVE_FIELDS.has(key) && value !== undefined)
    .sort(([a], [b]) => compareStrings(a, b))
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalJson(value)}`).join(',')}}`
}

/**
 * One entry per event id.
 *
 * Receiving an event twice — in the same stream or from both sides — is a
 * no-op, which is what makes replay and retry safe. Where the same id
 * arrives as both a server-accepted copy and a still-pending local copy,
 * the accepted one is kept: it carries strictly more information
 * (serverSeq, recordedAt) and is identical in substance.
 */
function deduplicate(events: readonly ChangeEvent[], anomalies: ReconciliationAnomaly[]): ChangeEvent[] {
  const byId = new Map<string, ChangeEvent>()

  for (const event of events) {
    const existing = byId.get(event.id)
    if (!existing) {
      byId.set(event.id, event)
      continue
    }

    if (substantiveJson(existing) === substantiveJson(event)) {
      // Same event. Prefer whichever copy the server has confirmed; if both
      // or neither are confirmed, the copies are interchangeable and the
      // lower serverSeq keeps the choice deterministic.
      if (existing.serverSeq !== null && event.serverSeq !== null) {
        byId.set(event.id, existing.serverSeq <= event.serverSeq ? existing : event)
      } else if (event.serverSeq !== null) {
        byId.set(event.id, event)
      }
      // Otherwise `existing` is already the accepted copy, or neither is
      // accepted and the two are interchangeable.
      continue
    }

    // Two genuinely different payloads under one id. That should be
    // impossible — ids are minted once and events are immutable — so it is
    // reported rather than silently resolved. The canonically smaller
    // payload is kept so the outcome is at least deterministic.
    const keep = substantiveJson(existing) <= substantiveJson(event) ? existing : event
    byId.set(event.id, keep)
    anomalies.push({
      kind: 'duplicateEventId',
      eventId: event.id,
      entity: event.entity,
      entityId: event.entityId,
      detail: 'One event id carries two different payloads; kept the canonically smaller one.',
    })
  }

  return [...byId.values()]
}

/** Merged records are rebuilt with sorted keys and no undefined values, so serialization is stable. */
function normalizeRecord(state: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(state).sort(compareStrings)) {
    if (state[key] !== undefined) normalized[key] = state[key]
  }
  return normalized
}

function mergeEntity(
  entity: SyncEntity,
  entityId: string,
  ordered: ChangeEvent[],
  conflicts: FieldConflict[],
  anomalies: ReconciliationAnomaly[],
): ReconciledRecord {
  const first = ordered[0] as ChangeEvent

  // Seeded from the first event's `before`, which is a COMPLETE snapshot.
  // That is what lets a stream containing only updates still materialize a
  // whole record — the create does not have to be present.
  const state: Record<string, unknown> = first.before
    ? { ...(first.before as unknown as Record<string, unknown>) }
    : {}
  const lastWriter = new Map<string, ChangeEvent>()
  let lastEventId = first.id

  for (const event of ordered) {
    lastEventId = event.id

    if (event.after === null) {
      anomalies.push({
        kind: 'missingAfter',
        eventId: event.id,
        entity,
        entityId,
        detail: `A ${event.op} event carries no after-snapshot, so it cannot be applied.`,
      })
      continue
    }

    const after = event.after as unknown as Record<string, unknown>
    const before = (event.before ?? null) as Record<string, unknown> | null

    if (typeof after.id === 'string' && after.id !== entityId) {
      anomalies.push({
        kind: 'entityIdMismatch',
        eventId: event.id,
        entity,
        entityId,
        detail: `The after-snapshot identifies record ${after.id}.`,
      })
    }

    for (const field of changedFields(before, after)) {
      if (IMMUTABLE_FIELDS.has(field)) continue

      const base = before ? before[field] : undefined
      const current = state[field]

      // The author wrote this on top of `base`. If the merged value is no
      // longer `base`, they had not seen what is already here — concurrent,
      // not sequential.
      if (!BOOKKEEPING_FIELDS.has(field) && !valuesEqual(base, current)) {
        const loser = lastWriter.get(field)
        if (loser && loser.id !== event.id && !hadSeen(event, loser)) {
          conflicts.push({
            entity,
            entityId,
            field,
            winnerEventId: event.id,
            loserEventId: loser.id,
            winnerValue: after[field],
            loserValue: current,
            winnerActorId: event.actorId,
            loserActorId: loser.actorId,
            resolvedBy: resolutionBetween(event, loser),
          })
        }
      }

      state[field] = after[field]
      lastWriter.set(field, event)
    }

    // Identity fields are carried across verbatim from whichever snapshot
    // first supplies them; by definition they never differ.
    for (const field of IMMUTABLE_FIELDS) {
      if (state[field] === undefined && after[field] !== undefined) state[field] = after[field]
    }
  }

  const record = typeof state.id === 'string' ? (normalizeRecord(state) as unknown as SyncRecord) : null

  return {
    entity,
    entityId,
    record,
    deleted: typeof state.deletedAt === 'string' && state.deletedAt.length > 0,
    lastEventId,
  }
}

/**
 * Merges two event streams into one deterministic result.
 *
 * The two parameters are SYMMETRIC — `reconcileEvents(a, b)` and
 * `reconcileEvents(b, a)` produce identical results, as does any
 * permutation within either stream. The names describe the usual calling
 * convention (the local log and whatever arrived from elsewhere), not any
 * precedence between them.
 *
 * Nothing is mutated: the input arrays and the event objects inside them
 * are only read, and every record in the result is newly built.
 */
export function reconcileEvents(
  local: readonly ChangeEvent[],
  incoming: readonly ChangeEvent[],
): ReconciliationResult {
  const anomalies: ReconciliationAnomaly[] = []
  const conflicts: FieldConflict[] = []

  const events = deduplicate([...local, ...incoming], anomalies).sort(compareEvents)

  // Bucketed after sorting, so each bucket is already in total order.
  const buckets = new Map<string, ChangeEvent[]>()
  for (const event of events) {
    const key = `${event.entity}\u0000${event.entityId}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(event)
    else buckets.set(key, [event])
  }

  const records: ReconciledRecord[] = []
  for (const bucket of buckets.values()) {
    const head = bucket[0] as ChangeEvent
    records.push(mergeEntity(head.entity, head.entityId, bucket, conflicts, anomalies))
  }

  records.sort(
    (a, b) => compareStrings(a.entity, b.entity) || compareStrings(a.entityId, b.entityId),
  )
  conflicts.sort(
    (a, b) =>
      compareStrings(a.entity, b.entity) ||
      compareStrings(a.entityId, b.entityId) ||
      compareStrings(a.field, b.field) ||
      compareStrings(a.winnerEventId, b.winnerEventId),
  )
  anomalies.sort(
    (a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.eventId, b.eventId),
  )

  return { events, records, conflicts, anomalies }
}

/**
 * Every event belonging to one logical user action, in total order.
 *
 * Change sets are never merged into a synthetic single event: deleting a
 * person stays five immutable events that happen to share a changeSetId,
 * and this is how a caller reads them back as one action.
 */
export function changeSetsFrom(result: ReconciliationResult): Map<string, ChangeEvent[]> {
  const sets = new Map<string, ChangeEvent[]>()
  for (const event of result.events) {
    const existing = sets.get(event.changeSetId)
    if (existing) existing.push(event)
    else sets.set(event.changeSetId, [event])
  }
  return sets
}
