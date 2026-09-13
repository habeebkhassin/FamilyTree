import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import { createFamilyTree } from '../storage/familyTrees'
import { createPerson, updatePerson, deletePerson } from '../storage/people'
import type { ChangeEvent } from './changeTypes'
import type {
  BootstrapResult,
  PullResult,
  PushResult,
  RemoteAdapter,
  RemoteCursor,
} from './remoteAdapter'
import { classifyFailure, getPendingEvents, getRejectedEntries, syncTree } from './syncEngine'

/**
 * The sync cycle: offline work, reconnection, retries, crashes, and two
 * devices converging.
 *
 * The server here is a fake that behaves like the real one — it assigns a
 * sequence, it recognises an event id it has seen before, and it can be
 * told to fail. The real server's own behaviour is tested against real
 * Postgres in cloud/sync.sql.test.ts; this is about what the client does
 * with the answers.
 */

/** A server that keeps a log, exactly as the real one does. */
class FakeServer {
  log: ChangeEvent[] = []
  headSeq = 0
  failNextPushWith: string | null = null
  failNextPullWith: string | null = null
  /** How many events a pull will hand over at once. */
  pageSize = 100

  accept(events: ChangeEvent[]): PushResult {
    const accepted: ChangeEvent[] = []
    for (const event of events) {
      const seen = this.log.find((stored) => stored.id === event.id)
      if (seen) {
        // Idempotent: the original sequence comes back, nothing is added.
        accepted.push({ ...event, serverSeq: seen.serverSeq, recordedAt: seen.recordedAt })
        continue
      }
      this.headSeq += 1
      const stored: ChangeEvent = {
        ...event,
        serverSeq: this.headSeq,
        recordedAt: new Date(2026, 0, 1, 0, 0, this.headSeq).toISOString(),
      }
      this.log.push(stored)
      accepted.push(stored)
    }
    return { accepted, rejected: [] }
  }

  adapterFor(): RemoteAdapter {
    return {
      listTrees: async () => [],
      bootstrap: async (): Promise<BootstrapResult> => ({
        records: [],
        cursor: { lastServerSeq: this.headSeq || null },
      }),
      pull: async (_treeId: string, cursor: RemoteCursor): Promise<PullResult> => {
        if (this.failNextPullWith) {
          const message = this.failNextPullWith
          this.failNextPullWith = null
          throw new Error(message)
        }
        const after = cursor.lastServerSeq ?? 0
        const all = this.log
          .filter((event) => (event.serverSeq ?? 0) > after)
          .sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0))
        const page = all.slice(0, this.pageSize)
        return {
          events: page,
          cursor: {
            lastServerSeq:
              page.length > 0 ? (page[page.length - 1]?.serverSeq ?? after) : cursor.lastServerSeq,
          },
          hasMore: all.length > page.length,
        }
      },
      push: async (_treeId: string, events: ChangeEvent[]): Promise<PushResult> => {
        if (this.failNextPushWith) {
          const message = this.failNextPushWith
          this.failNextPushWith = null
          throw new Error(message)
        }
        return this.accept(events)
      },
    }
  }
}

/** Events as another device would have written them, against this server. */
function remoteEdit(
  server: FakeServer,
  treeId: string,
  personId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  basedOnServerSeq: number | null = null,
): void {
  server.accept([
    {
      clientSeq: 0,
      id: crypto.randomUUID(),
      changeSetId: crypto.randomUUID(),
      familyTreeId: treeId,
      actorId: 'device-b',
      entity: 'person',
      entityId: personId,
      op: 'update',
      before: before as never,
      after: after as never,
      createdAt: new Date().toISOString(),
      serverSeq: null,
      recordedAt: null,
      basedOnServerSeq,
    },
  ])
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seed() {
  const tree = await createFamilyTree({ name: 'Okafor Family' })
  const grace = await createPerson({
    familyTreeId: tree.id,
    firstName: 'Grace',
    lastName: 'Okafor',
    gender: 'female',
  })
  return { tree, grace }
}

// ── offline, then online ────────────────────────────────────────────

test('edits made offline are queued, then pushed on reconnection', async () => {
  const { tree, grace } = await seed()
  await updatePerson(grace.id, { notes: 'written while offline' })

  const queued = await getPendingEvents(tree.id)
  assert.ok(queued.length >= 2, 'the create and the edit are both waiting')

  const server = new FakeServer()
  const outcome = await syncTree(tree.id, server.adapterFor())

  assert.equal(outcome.failure, undefined)
  assert.equal(outcome.pushed, queued.length)
  assert.deepEqual(await getPendingEvents(tree.id), [], 'the queue is empty')

  const stored = await db.changeEvents.where('familyTreeId').equals(tree.id).toArray()
  assert.ok(
    stored.every((event) => event.serverSeq !== null),
    'every event now carries the sequence the server gave it',
  )
})

test('a failed push leaves everything queued and the tree untouched', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  server.failNextPushWith = 'Failed to fetch'

  const outcome = await syncTree(tree.id, server.adapterFor())

  assert.equal(outcome.failure?.kind, 'network')
  assert.equal(outcome.pushed, 0)
  assert.ok((await getPendingEvents(tree.id)).length > 0, 'nothing was dequeued')
  assert.equal((await db.people.get(grace.id))?.firstName, 'Grace', 'the family is untouched')

  // And it simply works next time.
  const retry = await syncTree(tree.id, server.adapterFor())
  assert.equal(retry.failure, undefined)
  assert.deepEqual(await getPendingEvents(tree.id), [])
})

test('editing never waits for the network', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  server.failNextPushWith = 'Failed to fetch'
  await syncTree(tree.id, server.adapterFor())

  // Offline, and the application carries on.
  await updatePerson(grace.id, { notes: 'still editing' })
  assert.equal((await db.people.get(grace.id))?.notes, 'still editing')
  assert.ok((await getPendingEvents(tree.id)).length >= 3)
})

// ── idempotency ─────────────────────────────────────────────────────

test('a push that succeeded but was never heard is safe to repeat', async () => {
  const { tree } = await seed()
  const server = new FakeServer()
  const adapter = server.adapterFor()

  const pending = await getPendingEvents(tree.id)
  // The server accepts, and the answer is lost on the way back.
  server.accept(pending)
  const logSize = server.log.length

  const outcome = await syncTree(tree.id, adapter)

  assert.equal(outcome.failure, undefined)
  assert.equal(server.log.length, logSize, 'no duplicate events were created')
  assert.deepEqual(await getPendingEvents(tree.id), [], 'and the queue drained')
})

test('applying the same remote events twice leaves the same state', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  remoteEdit(server, tree.id, grace.id, base, { ...base, notes: 'from device B' })

  await syncTree(tree.id, server.adapterFor())
  const once = await db.people.get(grace.id)
  const eventsOnce = await db.changeEvents.count()

  // Rewind the cursor and sync again: the same batch arrives a second time.
  await db.syncState.put({ familyTreeId: tree.id, lastServerSeq: null, lastSyncedAt: null })
  await syncTree(tree.id, server.adapterFor())

  assert.deepEqual(await db.people.get(grace.id), once, 'the record is identical')
  assert.equal(await db.changeEvents.count(), eventsOnce, 'and no event was stored twice')
})

// ── two devices ─────────────────────────────────────────────────────

test('simultaneous edits to different fields both survive', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>

  // This device edits the notes, offline.
  await updatePerson(grace.id, { notes: 'ours' })
  // The other device edits the birth date, and gets there first.
  remoteEdit(server, tree.id, grace.id, base, { ...base, birthDate: '1958-04-11' })

  await syncTree(tree.id, server.adapterFor())

  const merged = await db.people.get(grace.id)
  assert.equal(merged?.notes, 'ours', 'our edit survived')
  assert.equal(merged?.birthDate, '1958-04-11', 'and so did theirs')
})

test('the same field is decided by the server order', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  remoteEdit(server, tree.id, grace.id, base, { ...base, notes: 'theirs, earlier' })
  remoteEdit(server, tree.id, grace.id, base, { ...base, notes: 'theirs, later' })

  await syncTree(tree.id, server.adapterFor())
  assert.equal((await db.people.get(grace.id))?.notes, 'theirs, later')
})

test('a delete from another device arrives as a reversible tombstone', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  const deletedAt = new Date().toISOString()
  remoteEdit(server, tree.id, grace.id, base, { ...base, deletedAt })
  await syncTree(tree.id, server.adapterFor())
  assert.ok((await db.people.get(grace.id))?.deletedAt, 'tombstoned, not erased')

  remoteEdit(server, tree.id, grace.id, { ...base, deletedAt }, base)
  await syncTree(tree.id, server.adapterFor())
  assert.equal((await db.people.get(grace.id))?.deletedAt, undefined, 'and restored')
})

test('an edit here and a delete there both land', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  await updatePerson(grace.id, { notes: 'a correction' })
  remoteEdit(server, tree.id, grace.id, base, { ...base, deletedAt: new Date().toISOString() })

  await syncTree(tree.id, server.adapterFor())

  const person = await db.people.get(grace.id)
  assert.equal(person?.notes, 'a correction', 'the edit is kept')
  assert.ok(person?.deletedAt, 'and the tombstone too — they touched different fields')
})

test('two devices converge on the same family', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  await updatePerson(grace.id, { notes: 'device A' })
  remoteEdit(server, tree.id, grace.id, base, { ...base, birthDate: '1958-04-11' })

  await syncTree(tree.id, server.adapterFor())
  const deviceA = await db.people.get(grace.id)

  // A second device, starting empty, replays the same server log.
  await db.delete()
  await db.open()
  await createFamilyTree({ name: 'Okafor Family' })
  await db.syncState.put({ familyTreeId: tree.id, lastServerSeq: null, lastSyncedAt: null })
  await syncTree(tree.id, server.adapterFor())
  const deviceB = await db.people.get(grace.id)

  assert.equal(deviceB?.notes, deviceA?.notes)
  assert.equal(deviceB?.birthDate, deviceA?.birthDate)
  assert.equal(deviceB?.deletedAt, deviceA?.deletedAt)
})

// ── the cursor, and crashes ─────────────────────────────────────────

test('the cursor only moves once the events are in', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  remoteEdit(server, tree.id, grace.id, base, { ...base, notes: 'never arrives' })

  const before = (await db.syncState.get(tree.id))?.lastServerSeq ?? null
  server.failNextPullWith = 'Failed to fetch'
  const outcome = await syncTree(tree.id, server.adapterFor())

  assert.equal(outcome.failure?.kind, 'network')
  assert.equal(
    (await db.syncState.get(tree.id))?.lastServerSeq ?? null,
    before,
    'a pull that failed moved nothing',
  )
  assert.notEqual((await db.people.get(grace.id))?.notes, 'never arrives')

  // Resuming picks up exactly where it stopped.
  const resumed = await syncTree(tree.id, server.adapterFor())
  assert.equal(resumed.failure, undefined)
  assert.equal((await db.people.get(grace.id))?.notes, 'never arrives')
})

test('a pull that needs several pages applies all of them', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())
  server.pageSize = 2

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  for (let n = 1; n <= 5; n += 1) {
    remoteEdit(server, tree.id, grace.id, base, { ...base, notes: `edit ${n}` })
  }

  const outcome = await syncTree(tree.id, server.adapterFor())
  assert.equal(outcome.pulled, 5, 'every page was fetched')
  assert.equal((await db.people.get(grace.id))?.notes, 'edit 5')
  assert.equal(outcome.cursor, server.log.length, 'and the cursor reached the head')
})

test('an interrupted multi-page pull resumes without losing a page', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())
  server.pageSize = 2

  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  for (let n = 1; n <= 5; n += 1) {
    remoteEdit(server, tree.id, grace.id, base, { ...base, notes: `edit ${n}` })
  }

  // First page lands, the second request fails.
  const adapter = server.adapterFor()
  const originalPull = adapter.pull.bind(adapter)
  let calls = 0
  adapter.pull = async (treeId, cursor) => {
    calls += 1
    if (calls === 2) throw new Error('Failed to fetch')
    return originalPull(treeId, cursor)
  }

  const first = await syncTree(tree.id, adapter)
  assert.equal(first.failure?.kind, 'network')
  assert.equal(first.pulled, 2, 'the page that arrived was applied')
  assert.equal((await db.syncState.get(tree.id))?.lastServerSeq, first.cursor)

  const second = await syncTree(tree.id, server.adapterFor())
  assert.equal(second.failure, undefined)
  assert.equal(second.pulled, 3, 'and the rest followed, with nothing repeated or skipped')
  assert.equal((await db.people.get(grace.id))?.notes, 'edit 5')
})

test('a stale cursor is harmless — the events simply arrive again', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())
  const base = (await db.people.get(grace.id)) as unknown as Record<string, unknown>
  remoteEdit(server, tree.id, grace.id, base, { ...base, notes: 'x' })
  await syncTree(tree.id, server.adapterFor())
  const settled = await db.people.get(grace.id)

  await db.syncState.put({ familyTreeId: tree.id, lastServerSeq: 1, lastSyncedAt: null })
  await syncTree(tree.id, server.adapterFor())

  assert.deepEqual(await db.people.get(grace.id), settled)
})

test('an empty pull is a real answer, not a failure', async () => {
  const { tree } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  const outcome = await syncTree(tree.id, server.adapterFor())
  assert.equal(outcome.failure, undefined)
  assert.equal(outcome.pulled, 0)
})

// ── rejection and permissions ───────────────────────────────────────

test('a rejected event is kept, marked, and never offered again', async () => {
  const { tree } = await seed()
  const server = new FakeServer()
  const adapter = server.adapterFor()
  const pending = await getPendingEvents(tree.id)
  const doomed = pending[0] as ChangeEvent

  adapter.push = async (_treeId, events) => ({
    accepted: events.filter((event) => event.id !== doomed.id).map((event) => ({ ...event, serverSeq: 1, recordedAt: 'x' })),
    rejected: [{ eventId: doomed.id, reason: 'That person belongs to another family tree.' }],
  })

  const outcome = await syncTree(tree.id, adapter)
  assert.equal(outcome.rejected.length, 1)

  const rejected = await getRejectedEntries(tree.id)
  assert.equal(rejected.length, 1, 'the entry is still there')
  assert.match(rejected[0]?.rejectedReason ?? '', /another family tree/i)

  const stillPending = await getPendingEvents(tree.id)
  assert.ok(
    !stillPending.some((event) => event.id === doomed.id),
    'and it is not retried forever',
  )
  assert.ok(await db.changeEvents.where('id').equals(doomed.id).first(), 'the event itself is kept')
})

test('losing permission is reported as such, not as a network problem', async () => {
  const { tree } = await seed()
  const server = new FakeServer()
  const adapter = server.adapterFor()
  adapter.push = async () => {
    throw new Error('You do not have permission to change this family tree.')
  }

  const outcome = await syncTree(tree.id, adapter)
  assert.equal(outcome.failure?.kind, 'authorization')
  assert.ok((await getPendingEvents(tree.id)).length > 0, 'the work is kept')
})

test('failures are told apart', () => {
  assert.equal(classifyFailure(new Error('Not signed in.')).kind, 'authentication')
  assert.equal(classifyFailure(new Error('permission denied for table people')).kind, 'authorization')
  assert.equal(classifyFailure(new Error('Failed to fetch')).kind, 'network')
  assert.equal(classifyFailure(new Error('relation does not exist')).kind, 'server')
})

// ── the watermark ───────────────────────────────────────────────────

test('a new local change records how far this device had synced', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())
  const cursor = (await db.syncState.get(tree.id))?.lastServerSeq ?? null

  await updatePerson(grace.id, { notes: 'after syncing' })

  const pending = await getPendingEvents(tree.id)
  const latest = pending[pending.length - 1] as ChangeEvent
  assert.equal(latest.basedOnServerSeq, cursor, 'the watermark is the cursor it was written against')
})

test('an edit made before syncing carries no watermark', async () => {
  const { tree } = await seed()
  const pending = await getPendingEvents(tree.id)
  assert.ok(
    pending.every((event) => event.basedOnServerSeq === null),
    'a tree that has never synced claims no knowledge',
  )
})

// ── deletion through the real storage path ──────────────────────────

test('a local delete syncs as a tombstone, and the record survives', async () => {
  const { tree, grace } = await seed()
  const server = new FakeServer()
  await syncTree(tree.id, server.adapterFor())

  await deletePerson(grace.id)
  const outcome = await syncTree(tree.id, server.adapterFor())

  assert.equal(outcome.failure, undefined)
  const pushedDelete = server.log.find((event) => event.op === 'delete')
  assert.ok(pushedDelete, 'the deletion reached the server as an event')
  assert.ok(await db.people.get(grace.id), 'and the row is still here, tombstoned')
})
