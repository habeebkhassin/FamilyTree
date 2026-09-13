// No `fake-indexeddb/auto` here, deliberately. The reconciler is pure, so
// this file must be able to run with no browser environment shimmed at
// all — if it ever starts needing one, something has leaked into it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { changeSetsFrom, reconcileEvents } from './reconciler'
import type { ChangeEvent, ChangeOperation, SyncEntity, SyncRecord } from './changeTypes'
import type { Person } from '../../types'

// ── Synthetic event construction ─────────────────────────────────────
// Shapes match exactly what lib/storage writes: complete before/after
// snapshots, updatedAt bumped on every mutation, deletion as a tombstone.

let idCounter = 0
const nextId = (prefix = 'evt') => `${prefix}-${String(++idCounter).padStart(4, '0')}`

const TREE = 'tree-1'

function person(id: string, fields: Partial<Person> = {}): Person {
  return {
    id,
    familyTreeId: TREE,
    firstName: 'John',
    lastName: 'Bello',
    gender: 'unknown',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  }
}

interface EventOptions {
  id?: string
  changeSetId?: string
  actorId?: string | null
  createdAt?: string
  serverSeq?: number | null
  clientSeq?: number
  entity?: SyncEntity
}

function event(
  op: ChangeOperation,
  entityId: string,
  before: SyncRecord | null,
  after: SyncRecord | null,
  options: EventOptions = {},
): ChangeEvent {
  const id = options.id ?? nextId()
  return {
    clientSeq: options.clientSeq ?? ++idCounter,
    id,
    changeSetId: options.changeSetId ?? `set-${id}`,
    familyTreeId: TREE,
    actorId: options.actorId ?? 'actor-a',
    entity: options.entity ?? 'person',
    entityId,
    op,
    before,
    after,
    createdAt: options.createdAt ?? '2026-01-01T00:00:00.000Z',
    serverSeq: options.serverSeq ?? null,
    recordedAt: null,
    basedOnServerSeq: null,
  }
}

/** An update as lib/storage writes it: bumps updatedAt, keeps everything else. */
function update(base: Person, changes: Partial<Person>, at: string, options: EventOptions = {}) {
  const after: Person = { ...base, ...changes, updatedAt: at }
  return { event: event('update', base.id, base, after, { createdAt: at, ...options }), after }
}

function remove(base: Person, at: string, options: EventOptions = {}) {
  const after: Person = { ...base, deletedAt: at, updatedAt: at }
  return { event: event('delete', base.id, base, after, { createdAt: at, ...options }), after }
}

function restore(base: Person, at: string, options: EventOptions = {}) {
  const after: Person = { ...base, deletedAt: undefined, updatedAt: at }
  return { event: event('restore', base.id, base, after, { createdAt: at, ...options }), after }
}

function create(record: Person, at: string, options: EventOptions = {}) {
  return { event: event('create', record.id, null, record, { createdAt: at, ...options }), after: record }
}

function recordFor(result: ReturnType<typeof reconcileEvents>, entityId: string) {
  const found = result.records.find((candidate) => candidate.entityId === entityId)
  assert.ok(found, `no reconciled record for ${entityId}`)
  return found
}

function merged(result: ReturnType<typeof reconcileEvents>, entityId: string): Person {
  return recordFor(result, entityId).record as unknown as Person
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner)
  }
  return value
}

// ── Idempotency and event identity ───────────────────────────────────

test('1. the same event received twice is applied once', () => {
  const base = person('p1')
  const { event: created } = create(base, '2026-02-01T10:00:00.000Z')

  const result = reconcileEvents([created], [created])
  assert.equal(result.events.length, 1, 'deduplicated by event id')
  assert.equal(result.conflicts.length, 0, 'replaying an event is not a conflict')
  assert.equal(result.anomalies.length, 0)
  assert.equal(merged(result, 'p1').firstName, 'John')
})

test('2. the same event in opposite streams is a no-op either way round', () => {
  const base = person('p1')
  const { event: created } = create(base, '2026-02-01T10:00:00.000Z')
  const { event: edit } = update(base, { firstName: 'Habeeb' }, '2026-02-01T11:00:00.000Z')

  const forwards = reconcileEvents([created, edit], [created])
  const backwards = reconcileEvents([created], [created, edit])
  assert.deepEqual(forwards, backwards)
  assert.equal(forwards.events.length, 2)
})

test('3. duplicating an entire stream changes nothing', () => {
  const base = person('p1')
  const { event: created } = create(base, '2026-02-01T10:00:00.000Z')
  const { event: edit } = update(base, { firstName: 'Habeeb' }, '2026-02-01T11:00:00.000Z')

  const once = reconcileEvents([created, edit], [])
  const twice = reconcileEvents([created, edit, created, edit], [edit, created])
  assert.deepEqual(once, twice)
})

test('4. the same event id carrying two different payloads is reported, not guessed at', () => {
  const base = person('p1')
  const { event: honest } = update(base, { firstName: 'Habeeb' }, '2026-02-01T11:00:00.000Z', { id: 'evt-x' })
  const { event: forged } = update(base, { firstName: 'Forged' }, '2026-02-01T11:00:00.000Z', { id: 'evt-x' })

  const result = reconcileEvents([honest], [forged])
  assert.equal(result.events.length, 1)
  assert.equal(result.anomalies.length, 1)
  assert.equal(result.anomalies[0]?.kind, 'duplicateEventId')
  // ...and the choice is stable regardless of which side supplied which.
  assert.deepEqual(reconcileEvents([forged], [honest]), result)
})

test('5. a server-accepted copy is preferred over the pending copy of the same event', () => {
  const base = person('p1')
  const at = '2026-02-01T11:00:00.000Z'
  const pending = update(base, { firstName: 'Habeeb' }, at, { id: 'evt-y' }).event
  const accepted: ChangeEvent = { ...pending, serverSeq: 7, recordedAt: '2026-02-01T11:00:05.000Z', clientSeq: 99 }

  for (const result of [reconcileEvents([pending], [accepted]), reconcileEvents([accepted], [pending])]) {
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0]?.serverSeq, 7, 'the confirmed copy carries strictly more information')
    assert.equal(result.anomalies.length, 0, 'differing serverSeq for one id is not an anomaly')
  }
})

// ── Field-level merging ──────────────────────────────────────────────

test('6. concurrent edits to different fields both survive', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z', { actorId: 'actor-a' })
  const b = update(base, { birthDate: '1997-05-20' }, '2026-02-01T10:00:01.000Z', { actorId: 'actor-b' })

  const result = reconcileEvents([a.event], [b.event])
  const record = merged(result, 'p1')
  assert.equal(record.firstName, 'Habeeb', 'device A kept its edit')
  assert.equal(record.birthDate, '1997-05-20', 'device B kept its edit')
  assert.equal(result.conflicts.length, 0, 'different fields are not a conflict')
})

test('7. concurrent edits to the same field produce exactly one winner', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z', { actorId: 'actor-a' })
  const b = update(base, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z', { actorId: 'actor-b' })

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(merged(result, 'p1').firstName, 'Habib', 'the later client clock wins')
  assert.equal(result.conflicts.length, 1)

  const conflict = result.conflicts[0]
  assert.equal(conflict?.field, 'firstName')
  assert.equal(conflict?.winnerValue, 'Habib')
  assert.equal(conflict?.loserValue, 'Habeeb')
  assert.equal(conflict?.winnerEventId, b.event.id)
  assert.equal(conflict?.loserEventId, a.event.id)
  assert.equal(conflict?.winnerActorId, 'actor-b')
  assert.equal(conflict?.loserActorId, 'actor-a')
  assert.equal(conflict?.resolvedBy, 'createdAt')
})

test('8. a sequential edit is not a conflict, because its before-snapshot proves it saw the first', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z')
  // Device B synced first, so it edits on top of A's result.
  const b = update(a.after, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(merged(result, 'p1').firstName, 'Habib')
  assert.equal(result.conflicts.length, 0, 'this is an ordinary overwrite, not a collision')
})

test('9. the losing value stays reachable through the conflict and through the log', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z')
  const b = update(base, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(result.conflicts[0]?.loserValue, 'Habeeb')

  // The losing event itself is untouched and still in the reconciled log.
  const loser = result.events.find((candidate) => candidate.id === a.event.id)
  assert.ok(loser, 'the losing event is still in the reconciled log')
  assert.equal((loser.after as Person).firstName, 'Habeeb')
  assert.deepEqual(loser, a.event)
})

test('10. updatedAt never manufactures a conflict of its own', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z')
  const b = update(base, { lastName: 'Adeyemi' }, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([a.event], [b.event])
  assert.deepEqual(result.conflicts, [], 'bookkeeping is merged silently')
  assert.equal(merged(result, 'p1').updatedAt, '2026-02-01T10:00:01.000Z', 'but it is still merged')
})

// ── Additive operations ──────────────────────────────────────────────

test('11. people created independently on two devices both survive', () => {
  const a = create(person('p1', { firstName: 'Amina' }), '2026-02-01T10:00:00.000Z')
  const b = create(person('p2', { firstName: 'Yusuf' }), '2026-02-01T10:00:00.000Z')

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(result.records.length, 2)
  assert.equal(merged(result, 'p1').firstName, 'Amina')
  assert.equal(merged(result, 'p2').firstName, 'Yusuf')
  assert.deepEqual(result.conflicts, [])
})

test('12. parent links added independently both survive', () => {
  const linkA = event('create', 'l1', null, {
    id: 'l1', familyTreeId: TREE, parentId: 'p1', childId: 'p2', relationship: 'biological',
    createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z',
  } as SyncRecord, { entity: 'parentLink' })
  const linkB = event('create', 'l2', null, {
    id: 'l2', familyTreeId: TREE, parentId: 'p1', childId: 'p3', relationship: 'adopted',
    createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z',
  } as SyncRecord, { entity: 'parentLink' })

  const result = reconcileEvents([linkA], [linkB])
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.conflicts, [])
  assert.ok(result.records.every((entry) => entry.entity === 'parentLink' && !entry.deleted))
})

test('13. family group memberships added independently both survive', () => {
  const memberOf = (id: string, personId: string) =>
    event('create', id, null, {
      id, familyTreeId: TREE, familyGroupId: 'g1', personId,
      createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z',
    } as SyncRecord, { entity: 'familyGroupMember' })

  const result = reconcileEvents([memberOf('m1', 'p1')], [memberOf('m2', 'p2')])
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.conflicts, [])
})

test('14. the reconciler passes no judgement on genealogical validity', () => {
  // A link making someone their own ancestor is a storage-layer concern.
  // Sync must not silently drop it; storage rejects it when written.
  const cyclic = event('create', 'l1', null, {
    id: 'l1', familyTreeId: TREE, parentId: 'p1', childId: 'p1', relationship: 'biological',
    createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z',
  } as SyncRecord, { entity: 'parentLink' })

  const result = reconcileEvents([cyclic], [])
  assert.equal(result.records.length, 1)
  assert.deepEqual(result.anomalies, [], 'not the reconcilerʼs business')
})

// ── Tombstones ───────────────────────────────────────────────────────

test('15. edit versus delete: the record is deleted but keeps the edit', () => {
  const base = person('p1')
  const edit = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z')
  const deletion = remove(base, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([edit.event], [deletion.event])
  const record = recordFor(result, 'p1')
  assert.equal(record.deleted, true, 'the tombstone stands')
  assert.equal((record.record as unknown as Person).firstName, 'Habeeb', 'and the edit is not lost')
  assert.deepEqual(result.conflicts, [], 'different fields: deletedAt versus firstName')
})

test('16. delete versus edit reconciles identically whichever arrives first', () => {
  const base = person('p1')
  const deletion = remove(base, '2026-02-01T10:00:00.000Z')
  const edit = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:01.000Z')

  const one = reconcileEvents([deletion.event], [edit.event])
  const other = reconcileEvents([edit.event], [deletion.event])
  assert.deepEqual(one, other)
  assert.equal(recordFor(one, 'p1').deleted, true)
  assert.equal(merged(one, 'p1').firstName, 'Habeeb')
})

test('17. delete versus delete converges on deleted and reports the timestamp collision', () => {
  const base = person('p1')
  const a = remove(base, '2026-02-01T10:00:00.000Z')
  const b = remove(base, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(recordFor(result, 'p1').deleted, true)
  assert.equal(result.conflicts.length, 1, 'both set deletedAt, to different values')
  assert.equal(result.conflicts[0]?.field, 'deletedAt')
  assert.equal(result.conflicts[0]?.winnerValue, '2026-02-01T10:00:01.000Z')
})

test('18. restore versus delete from divergent bases is a genuine contest over the tombstone', () => {
  const base = person('p1')
  const deleted: Person = { ...base, deletedAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }

  // Device A is offline and still sees January's tombstone, so it restores
  // from that. Device B has caught up, sees a live record, and deletes it.
  // Their bases genuinely disagree, which is what makes this a conflict.
  const deletion = remove(base, '2026-02-01T10:00:00.000Z')
  const restored = restore(deleted, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([deletion.event], [restored.event])
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0]?.field, 'deletedAt')
  assert.equal(result.conflicts[0]?.winnerEventId, restored.event.id)
  assert.equal(recordFor(result, 'p1').deleted, false, 'a tombstone is always reversible')

  // The record itself is never erased either way.
  assert.equal(merged(result, 'p1').firstName, 'John')
})

test('19. ABA: a field returned to an earlier value cannot be told apart from no change at all', () => {
  // A known and deliberate limit of deriving causality from before-snapshots.
  // Device A restores January's tombstone; device B, which never saw that
  // restore, deletes what it believes is a live record. Because B's base
  // (live) matches the state A produced (live), the delete reads as an
  // ordinary sequential operation rather than a concurrent one.
  const base = person('p1')
  const deleted: Person = { ...base, deletedAt: '2026-01-05T00:00:00.000Z' }

  const restored = restore(deleted, '2026-02-01T09:00:00.000Z')
  const deletion = remove(base, '2026-02-01T10:00:00.000Z')

  const result = reconcileEvents([restored.event], [deletion.event])
  assert.equal(recordFor(result, 'p1').deleted, true, 'the outcome is still deterministic and reversible')
  assert.deepEqual(result.conflicts, [], 'but no conflict is reported, because none is detectable')

  // Detecting this needs causality metadata the event model does not carry
  // — a per-event record of how far the device had synced. See the report
  // accompanying this phase; nothing here invents one.
})

test('20. restore versus edit keeps both', () => {
  const deleted: Person = { ...person('p1'), deletedAt: '2026-01-05T00:00:00.000Z' }
  const restored = restore(deleted, '2026-02-01T10:00:00.000Z')
  const edit = update(deleted, { firstName: 'Habeeb' }, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([restored.event], [edit.event])
  assert.equal(recordFor(result, 'p1').deleted, false)
  assert.equal(merged(result, 'p1').firstName, 'Habeeb')
  assert.deepEqual(result.conflicts, [])
})

test('21. a long delete/restore alternation terminates and converges', () => {
  const base = person('p1')
  const events: ChangeEvent[] = []
  let state = base
  const start = Date.UTC(2026, 2, 1, 10, 0, 0)
  for (let index = 0; index < 200; index += 1) {
    // Built from a real clock rather than string arithmetic: hand-rolled
    // "10:${index}" overflows past 59 and breaks lexicographic ordering.
    const at = new Date(start + index * 60_000).toISOString()
    const step = index % 2 === 0 ? remove(state, at) : restore(state, at)
    events.push(step.event)
    state = step.after
  }

  const result = reconcileEvents(events, [])
  assert.equal(result.events.length, 200)
  assert.equal(recordFor(result, 'p1').deleted, false, 'ends on a restore')
  assert.deepEqual(result.conflicts, [], 'each step saw the one before it')
})

test('22. nothing is ever physically erased: a deleted record still materializes', () => {
  const base = person('p1', { firstName: 'Amina' })
  const created = create(base, '2026-02-01T09:00:00.000Z')
  const deletion = remove(base, '2026-02-01T10:00:00.000Z')

  const result = reconcileEvents([created.event, deletion.event], [])
  const record = recordFor(result, 'p1')
  assert.equal(record.deleted, true)
  assert.equal((record.record as unknown as Person).firstName, 'Amina', 'the record survives its tombstone')
})

// ── Ordering ─────────────────────────────────────────────────────────

test('23. clientSeq is never used for cross-device ordering', () => {
  const base = person('p1')
  // Device B's clientSeq is far lower, which on a naive implementation
  // would drag its edit before device A's.
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z', { clientSeq: 9000 })
  const b = update(base, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z', { clientSeq: 1 })

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(merged(result, 'p1').firstName, 'Habib', 'the client clock decided, not clientSeq')

  // Rewriting clientSeq must not change anything at all.
  const rewritten = reconcileEvents(
    [{ ...a.event, clientSeq: 1 }],
    [{ ...b.event, clientSeq: 9000 }],
  )
  assert.equal(merged(rewritten, 'p1').firstName, 'Habib')
  assert.deepEqual(
    rewritten.conflicts.map((conflict) => conflict.winnerEventId),
    result.conflicts.map((conflict) => conflict.winnerEventId),
  )
})

test('24. serverSeq decides when it is available, overriding the client clock', () => {
  const base = person('p1')
  // The server accepted the "Habeeb" edit second, despite its earlier clock.
  const a = update(base, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z', { serverSeq: 10 })
  const b = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z', { serverSeq: 11 })

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(merged(result, 'p1').firstName, 'Habeeb', 'server order wins')
  assert.equal(result.conflicts[0]?.resolvedBy, 'serverSeq')
})

test('25. an accepted event is ordered before a still-pending one, and says so', () => {
  const base = person('p1')
  const accepted = update(base, { firstName: 'Accepted' }, '2026-02-01T23:00:00.000Z', { serverSeq: 5 })
  const pending = update(base, { firstName: 'Pending' }, '2026-02-01T08:00:00.000Z')

  const result = reconcileEvents([accepted.event], [pending.event])
  assert.equal(result.events[0]?.id, accepted.event.id, 'accepted history comes first')
  assert.equal(merged(result, 'p1').firstName, 'Pending', 'unaccepted local work applies on top')
  assert.equal(result.conflicts[0]?.resolvedBy, 'acceptedBeforePending')
})

test('26. an unbreakable tie is resolved deterministically and flagged as arbitrary', () => {
  const base = person('p1')
  const sameInstant = '2026-02-01T10:00:00.000Z'
  const a = update(base, { firstName: 'Aaa' }, sameInstant, { id: 'evt-aaa' })
  const b = update(base, { firstName: 'Bbb' }, sameInstant, { id: 'evt-bbb' })

  const result = reconcileEvents([a.event], [b.event])
  assert.equal(result.conflicts[0]?.resolvedBy, 'eventId', 'the caller is told nothing meaningful decided this')
  assert.equal(merged(result, 'p1').firstName, 'Bbb')
  assert.deepEqual(reconcileEvents([b.event], [a.event]), result, 'and it is still stable')
})

// ── Determinism ──────────────────────────────────────────────────────

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items]
  let state = seed
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648
    const swapWith = state % (index + 1)
    const first = copy[index] as T
    copy[index] = copy[swapWith] as T
    copy[swapWith] = first
  }
  return copy
}

test('27. every permutation and split of the same events gives an identical result', () => {
  const base = person('p1')
  const other = person('p2', { firstName: 'Amina' })
  const events = [
    create(base, '2026-02-01T09:00:00.000Z').event,
    create(other, '2026-02-01T09:00:01.000Z').event,
    update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z').event,
    update(base, { firstName: 'Habib' }, '2026-02-01T10:00:00.500Z').event,
    update(base, { birthDate: '1997-05-20' }, '2026-02-01T10:00:01.000Z').event,
    remove(other, '2026-02-01T11:00:00.000Z').event,
  ]

  const expected = reconcileEvents(events, [])
  const expectedJson = JSON.stringify(expected)

  for (let seed = 1; seed <= 40; seed += 1) {
    const shuffled = shuffle(events, seed)
    const cut = seed % (shuffled.length + 1)
    const actual = reconcileEvents(shuffled.slice(0, cut), shuffled.slice(cut))
    assert.equal(JSON.stringify(actual), expectedJson, `permutation ${seed} diverged`)
  }
})

test('28. reconcile(a, b) equals reconcile(b, a)', () => {
  const base = person('p1')
  const left = [create(base, '2026-02-01T09:00:00.000Z').event, update(base, { firstName: 'L' }, '2026-02-01T10:00:00.000Z').event]
  const right = [update(base, { firstName: 'R' }, '2026-02-01T10:00:01.000Z').event, remove(base, '2026-02-01T12:00:00.000Z').event]

  assert.deepEqual(reconcileEvents(left, right), reconcileEvents(right, left))
})

test('29. merged records serialize identically regardless of input key order', () => {
  const base = person('p1')
  const scrambled = Object.fromEntries(Object.entries(base).reverse()) as unknown as Person
  const a = create(base, '2026-02-01T09:00:00.000Z').event
  const b = create(scrambled, '2026-02-01T09:00:00.000Z').event

  assert.equal(
    JSON.stringify(merged(reconcileEvents([a], []), 'p1')),
    JSON.stringify(merged(reconcileEvents([b], []), 'p1')),
  )
})

// ── Preservation ─────────────────────────────────────────────────────

test('30. changeSetId, actorId and both snapshots survive reconciliation untouched', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z', {
    changeSetId: 'set-alpha', actorId: 'actor-habeeb',
  })
  const b = update(base, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z', {
    changeSetId: 'set-beta', actorId: 'actor-ayesha',
  })

  const result = reconcileEvents([a.event], [b.event])
  const [first, second] = result.events
  assert.ok(first && second, 'both events survived')
  assert.deepEqual(first, a.event, 'the losing event is the original object, unmodified')
  assert.deepEqual(second, b.event)
  assert.equal(first.changeSetId, 'set-alpha')
  assert.equal(second.actorId, 'actor-ayesha')
  assert.equal((first.before as Person).firstName, 'John', 'before-snapshot intact')
  assert.equal((first.after as Person).firstName, 'Habeeb', 'after-snapshot intact')
})

test('31. a five-event cascade stays five events under one change set', () => {
  const at = '2026-02-01T10:00:00.000Z'
  const options = { changeSetId: 'cascade-1', createdAt: at }
  const cascade = [
    event('delete', 'p1', person('p1'), { ...person('p1'), deletedAt: at } as SyncRecord, options),
    event('delete', 'l1', { id: 'l1' } as SyncRecord, { id: 'l1', deletedAt: at } as SyncRecord, { ...options, entity: 'parentLink' }),
    event('delete', 'u1', { id: 'u1' } as SyncRecord, { id: 'u1', deletedAt: at } as SyncRecord, { ...options, entity: 'union' }),
    event('delete', 'm1', { id: 'm1' } as SyncRecord, { id: 'm1', deletedAt: at } as SyncRecord, { ...options, entity: 'familyGroupMember' }),
    event('update', 'g1', { id: 'g1', originPersonId: 'p1' } as SyncRecord, { id: 'g1' } as SyncRecord, { ...options, entity: 'familyGroup' }),
  ]

  const result = reconcileEvents(cascade.slice(0, 2), cascade.slice(2))
  assert.equal(result.events.length, 5, 'nothing was merged into a synthetic event')

  const sets = changeSetsFrom(result)
  assert.equal(sets.size, 1)
  assert.equal(sets.get('cascade-1')?.length, 5)
  assert.deepEqual(
    result.records.map((entry) => `${entry.entity}:${entry.deleted}`).sort(),
    ['familyGroup:false', 'familyGroupMember:true', 'parentLink:true', 'person:true', 'union:true'],
  )
})

test('32. two cascades from two devices stay separate actions', () => {
  const mk = (setId: string, entityId: string, at: string) =>
    event('delete', entityId, person(entityId), { ...person(entityId), deletedAt: at } as SyncRecord, {
      changeSetId: setId, createdAt: at,
    })

  const deviceA = [mk('set-a', 'p1', '2026-02-01T10:00:00.000Z'), mk('set-a', 'p2', '2026-02-01T10:00:00.000Z')]
  const deviceB = [mk('set-b', 'p3', '2026-02-01T10:00:01.000Z')]

  const sets = changeSetsFrom(reconcileEvents(deviceA, deviceB))
  assert.equal(sets.size, 2)
  assert.equal(sets.get('set-a')?.length, 2)
  assert.equal(sets.get('set-b')?.length, 1)
})

test('33. a stream of updates with no create still materializes the whole record', () => {
  // Incremental sync: the create was applied long ago and is not resent.
  const base = person('p1', { firstName: 'Amina', notes: 'Born in Kano.' })
  const edit = update(base, { firstName: 'Aminat' }, '2026-02-01T10:00:00.000Z')

  const record = merged(reconcileEvents([edit.event], []), 'p1')
  assert.equal(record.firstName, 'Aminat')
  assert.equal(record.notes, 'Born in Kano.', 'recovered from the before-snapshot')
  assert.equal(record.lastName, 'Bello')
})

// ── Robustness ───────────────────────────────────────────────────────

test('34. inputs are never mutated, even when deeply frozen', () => {
  const base = deepFreeze(person('p1'))
  const a = deepFreeze(update(base, { firstName: 'Habeeb' }, '2026-02-01T10:00:00.000Z').event)
  const b = deepFreeze(update(base, { firstName: 'Habib' }, '2026-02-01T10:00:01.000Z').event)
  const left = deepFreeze([a])
  const right = deepFreeze([b])

  const before = JSON.stringify([left, right])
  const result = reconcileEvents(left, right)
  assert.equal(JSON.stringify([left, right]), before, 'the inputs are exactly as they were')

  // The merged record must be a new object, not one of the snapshots.
  const record = merged(result, 'p1')
  assert.notEqual(record, a.after)
  assert.ok(!Object.isFrozen(record), 'freshly built, not an alias of a frozen input')
})

test('35. a malformed event with no after-snapshot is reported and skipped', () => {
  const base = person('p1')
  const created = create(base, '2026-02-01T09:00:00.000Z').event
  const broken = event('update', 'p1', base, null, { createdAt: '2026-02-01T10:00:00.000Z' })

  const result = reconcileEvents([created, broken], [])
  assert.equal(result.anomalies.length, 1)
  assert.equal(result.anomalies[0]?.kind, 'missingAfter')
  assert.equal(merged(result, 'p1').firstName, 'John', 'the rest still reconciled')
})

test('36. an after-snapshot naming a different record is reported', () => {
  const mismatched = event('update', 'p1', person('p1'), person('p2'), { createdAt: '2026-02-01T10:00:00.000Z' })

  const result = reconcileEvents([mismatched], [])
  assert.equal(result.anomalies[0]?.kind, 'entityIdMismatch')
  assert.equal(result.records.length, 1, 'reconciliation still completed')
})

test('37. empty input is valid', () => {
  const result = reconcileEvents([], [])
  assert.deepEqual(result, { events: [], records: [], conflicts: [], anomalies: [] })
})

test('38. a large synthetic stream reconciles in reasonable time', () => {
  const events: ChangeEvent[] = []
  const people: Person[] = []

  for (let index = 0; index < 2000; index += 1) {
    const record = person(`p${index}`, { firstName: `Person ${index}` })
    people.push(record)
    events.push(create(record, `2026-04-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`).event)
  }
  // Five sequential edits each, plus a concurrent pair on every tenth.
  for (let round = 0; round < 5; round += 1) {
    for (const [index, record] of people.entries()) {
      const at = `2026-05-0${round + 1}T00:00:${String(index % 60).padStart(2, '0')}.000Z`
      const step = update(record, { notes: `round ${round}` }, at)
      events.push(step.event)
      people[index] = step.after
      if (index % 10 === 0) {
        events.push(update(record, { notes: `rival ${round}` }, at, { id: nextId('rival') }).event)
      }
    }
  }

  const started = performance.now()
  const result = reconcileEvents(events.slice(0, 6000), events.slice(6000))
  const elapsed = performance.now() - started

  assert.equal(result.events.length, events.length)
  assert.equal(result.records.length, 2000)
  assert.ok(result.conflicts.length > 0, 'the concurrent pairs were detected')
  assert.ok(elapsed < 5000, `reconciled ${events.length} events in ${Math.round(elapsed)}ms`)
})

test('39. conflicts are reported per field, not collapsed per record', () => {
  const base = person('p1')
  const a = update(base, { firstName: 'Habeeb', lastName: 'Adeyemi' }, '2026-02-01T10:00:00.000Z')
  const b = update(base, { firstName: 'Habib', lastName: 'Okafor', birthDate: '1997-05-20' }, '2026-02-01T10:00:01.000Z')

  const result = reconcileEvents([a.event], [b.event])
  assert.deepEqual(
    result.conflicts.map((conflict) => conflict.field),
    ['firstName', 'lastName'],
    'only the two contested fields, and in a stable order',
  )
  const record = merged(result, 'p1')
  assert.equal(record.firstName, 'Habib')
  assert.equal(record.lastName, 'Okafor')
  assert.equal(record.birthDate, '1997-05-20', 'the uncontested field merged silently')
})
