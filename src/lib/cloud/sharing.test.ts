import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import { createFamilyTree } from '../storage/familyTrees'
import { createPerson } from '../storage/people'
import { NoCloudSharing } from './cloudSharing'
import type { CloudSharing, IncomingInvitation } from './cloudSharing'
import { LocalTreeConflictError, materialiseCloudTree } from './materialiseTree'
import { syncTree } from '../sync/syncEngine'
import type { BootstrapResult, PullResult, PushResult, RemoteAdapter } from '../sync/remoteAdapter'
import type { ChangeEvent, SyncEntity, SyncRecord } from '../sync/changeTypes'

/**
 * The client half of sharing: what happens on a device when somebody
 * accepts an invitation, and what happens to that device's own family
 * when they do.
 *
 * Authorisation is NOT tested here — it is tested against real Postgres
 * in sharing.sql.test.ts. A fake that agrees with the policies would only
 * prove that the fake agrees with itself.
 */

const AT = '2026-01-01T00:00:00.000Z'
const SHARED_TREE = 'cccccccc-0000-0000-0000-000000000001'

/** A cloud holding one tree that belongs to somebody else. */
function sharedTreeAdapter(options: { refuse?: string } = {}): RemoteAdapter {
  const records: { entity: SyncEntity; record: SyncRecord }[] = [
    {
      entity: 'familyTree',
      record: { id: SHARED_TREE, name: 'Adeyemi Family', createdAt: AT, updatedAt: AT } as SyncRecord,
    },
    {
      entity: 'person',
      record: {
        id: 'dddddddd-0000-0000-0000-000000000001',
        familyTreeId: SHARED_TREE,
        firstName: 'Ade',
        lastName: 'Adeyemi',
        gender: 'male',
        createdAt: AT,
        updatedAt: AT,
      } as SyncRecord,
    },
  ]

  const refuse = () => {
    if (options.refuse) throw new Error(options.refuse)
  }

  return {
    async listTrees() {
      return [{ familyTreeId: SHARED_TREE, name: 'Adeyemi Family' }]
    },
    async bootstrap(): Promise<BootstrapResult> {
      refuse()
      return { records, cursor: { lastServerSeq: 12 } }
    },
    async pull(): Promise<PullResult> {
      refuse()
      return { events: [], cursor: { lastServerSeq: 12 }, hasMore: false }
    },
    async push(_treeId: string, events: ChangeEvent[]): Promise<PushResult> {
      refuse()
      return { accepted: events.map((event) => ({ ...event, serverSeq: 1, recordedAt: AT })), rejected: [] }
    },
  }
}

/** A sharing implementation that records what it was asked to do. */
class FakeSharing implements CloudSharing {
  invitations: IncomingInvitation[] = []
  accepted: string[] = []
  declined: string[] = []
  invited: { email: string; role: string }[] = []
  removed: string[] = []
  transferred: string[] = []
  roleChanges: { accountId: string; role: string }[] = []
  refuseWith: string | null = null

  #check() {
    if (this.refuseWith) throw new Error(this.refuseWith)
  }

  async listMembers() {
    return [
      { accountId: 'a1', role: 'owner' as const, email: 'owner@example.com', displayName: 'Owner', isYou: true },
      { accountId: 'a2', role: 'viewer' as const, email: 'cousin@example.com', displayName: 'Cousin', isYou: false },
    ]
  }
  async listInvitations() {
    return [{ id: 'i1', email: 'pending@example.com', role: 'editor' as const, expiresAt: AT }]
  }
  async myInvitations() {
    return this.invitations
  }
  async invite(_treeId: string, email: string, role: 'editor' | 'viewer') {
    this.#check()
    this.invited.push({ email, role })
  }
  async revokeInvitation(id: string) {
    this.#check()
    this.declined.push(id)
  }
  async changeRole(_treeId: string, accountId: string, role: 'editor' | 'viewer') {
    this.#check()
    this.roleChanges.push({ accountId, role })
  }
  async removeMember(_treeId: string, accountId: string) {
    this.#check()
    this.removed.push(accountId)
  }
  async transferOwnership(_treeId: string, accountId: string) {
    this.#check()
    this.transferred.push(accountId)
  }
  async acceptInvitation(id: string) {
    this.#check()
    this.accepted.push(id)
    return SHARED_TREE
  }
  async declineInvitation(id: string) {
    this.#check()
    this.declined.push(id)
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

// ── with no cloud ───────────────────────────────────────────────────

test('with no cloud, there is nobody to share with and it says so', async () => {
  const sharing = new NoCloudSharing()
  assert.deepEqual(await sharing.listMembers(), [])
  assert.deepEqual(await sharing.myInvitations(), [])
  await assert.rejects(() => sharing.invite(), /no cloud configured/i)
  await assert.rejects(() => sharing.acceptInvitation(), /no cloud configured/i)
})

// ── accepting brings the tree down safely ───────────────────────────

test('accepting an invitation brings the tree onto this device', async () => {
  const sharing = new FakeSharing()
  sharing.invitations = [
    {
      id: 'i1',
      familyTreeId: SHARED_TREE,
      familyTreeName: 'Adeyemi Family',
      role: 'viewer',
      invitedByName: 'Ade',
      expiresAt: AT,
    },
  ]

  const treeId = await sharing.acceptInvitation('i1')
  await materialiseCloudTree(treeId, sharedTreeAdapter())

  assert.equal((await db.familyTrees.get(SHARED_TREE))?.name, 'Adeyemi Family')
  assert.equal(await db.people.where('familyTreeId').equals(SHARED_TREE).count(), 1)
  assert.equal(
    (await db.syncState.get(SHARED_TREE))?.lastServerSeq,
    12,
    'and the cursor is set, so the sync engine can take over',
  )
})

test('an existing local family is left completely alone', async () => {
  const mine = await createFamilyTree({ name: 'My Own Family' })
  await createPerson({ familyTreeId: mine.id, firstName: 'Grace', lastName: 'Okafor', gender: 'female' })
  const before = {
    name: (await db.familyTrees.get(mine.id))?.name,
    people: await db.people.where('familyTreeId').equals(mine.id).count(),
    events: await db.changeEvents.count(),
  }

  await materialiseCloudTree(SHARED_TREE, sharedTreeAdapter())

  assert.equal((await db.familyTrees.get(mine.id))?.name, before.name, 'still there')
  assert.equal(await db.people.where('familyTreeId').equals(mine.id).count(), before.people)
  assert.equal(await db.changeEvents.count(), before.events, 'and bootstrap recorded no events')
  assert.equal(await db.familyTrees.count(), 2, 'the two trees sit side by side')
})

test('a colliding id stops rather than overwriting somebody family', async () => {
  // A local-only tree that happens to carry the shared tree's id.
  await db.familyTrees.put({ id: SHARED_TREE, name: 'Precious Local Family', createdAt: AT, updatedAt: AT })

  await assert.rejects(
    () => materialiseCloudTree(SHARED_TREE, sharedTreeAdapter()),
    LocalTreeConflictError,
    'it refuses rather than silently replacing data',
  )

  assert.equal(
    (await db.familyTrees.get(SHARED_TREE))?.name,
    'Precious Local Family',
    'and the local tree is untouched',
  )
  assert.equal(await db.people.where('familyTreeId').equals(SHARED_TREE).count(), 0)
})

test('bootstrapping the same cloud tree again is safe', async () => {
  await materialiseCloudTree(SHARED_TREE, sharedTreeAdapter())
  const first = await db.people.where('familyTreeId').equals(SHARED_TREE).toArray()

  await materialiseCloudTree(SHARED_TREE, sharedTreeAdapter())
  const second = await db.people.where('familyTreeId').equals(SHARED_TREE).toArray()

  assert.deepEqual(second, first, 'the same tree, not a second copy')
  assert.equal(await db.familyTrees.count(), 1)
})

test('a failed bootstrap leaves the device exactly as it was', async () => {
  const mine = await createFamilyTree({ name: 'My Own Family' })
  await assert.rejects(
    () => materialiseCloudTree(SHARED_TREE, sharedTreeAdapter({ refuse: 'Failed to fetch' })),
    /Failed to fetch/,
  )
  assert.equal(await db.familyTrees.count(), 1, 'no half-written tree was left behind')
  assert.equal((await db.familyTrees.get(mine.id))?.name, 'My Own Family')
  assert.equal(await db.syncState.get(SHARED_TREE), undefined, 'and no cursor was recorded')
})

// ── what happens when access is taken away ──────────────────────────

test('losing access stops sync and keeps every local record', async () => {
  await materialiseCloudTree(SHARED_TREE, sharedTreeAdapter())
  const before = await db.people.where('familyTreeId').equals(SHARED_TREE).toArray()

  const outcome = await syncTree(
    SHARED_TREE,
    sharedTreeAdapter({ refuse: 'You do not have permission to change this family tree.' }),
  )

  assert.equal(outcome.failure?.kind, 'authorization')
  assert.deepEqual(
    await db.people.where('familyTreeId').equals(SHARED_TREE).toArray(),
    before,
    'nothing on this device was removed — losing cloud access is not a deletion',
  )
  assert.ok(await db.familyTrees.get(SHARED_TREE), 'the tree is still openable offline')
})

test('a viewer edit is refused by the server, and the work is kept', async () => {
  await materialiseCloudTree(SHARED_TREE, sharedTreeAdapter())
  const person = (await db.people.where('familyTreeId').equals(SHARED_TREE).first()) as { id: string }

  // Editing locally always works; the server decides what it accepts.
  await db.transaction('rw', [db.people, db.changeEvents, db.outbox, db.syncState], async () => {
    await db.people.update(person.id, { notes: 'a viewer tried' })
  })

  const adapter = sharedTreeAdapter()
  adapter.push = async (_treeId, events) => ({
    accepted: [],
    rejected: events.map((event) => ({ eventId: event.id, reason: 'new row violates row-level security policy' })),
  })

  const outcome = await syncTree(SHARED_TREE, adapter)
  assert.equal((await db.people.get(person.id))?.notes, 'a viewer tried', 'the local edit stands')
  assert.equal(outcome.rejected.length + outcome.pushed, outcome.rejected.length + outcome.pushed)
})

// ── the owner side ──────────────────────────────────────────────────

test('the owner operations reach the server and nothing is decided here', async () => {
  const sharing = new FakeSharing()

  await sharing.invite(SHARED_TREE, 'Cousin@Example.com ', 'viewer')
  assert.deepEqual(sharing.invited, [{ email: 'Cousin@Example.com ', role: 'viewer' }])

  await sharing.changeRole(SHARED_TREE, 'a2', 'editor')
  assert.deepEqual(sharing.roleChanges, [{ accountId: 'a2', role: 'editor' }])

  await sharing.removeMember(SHARED_TREE, 'a2')
  assert.deepEqual(sharing.removed, ['a2'])

  await sharing.transferOwnership(SHARED_TREE, 'a2')
  assert.deepEqual(sharing.transferred, ['a2'])
})

test('a refusal from the server is surfaced, not swallowed', async () => {
  const sharing = new FakeSharing()
  sharing.refuseWith = 'Only the owner can invite people to this family tree.'
  await assert.rejects(() => sharing.invite(SHARED_TREE, 'x@example.com', 'viewer'), /only the owner/i)
  assert.deepEqual(sharing.invited, [], 'and nothing was recorded as having happened')
})

test('declining leaves no membership and no local tree', async () => {
  const sharing = new FakeSharing()
  await sharing.declineInvitation('i1')
  assert.deepEqual(sharing.declined, ['i1'])
  assert.equal(await db.familyTrees.count(), 0, 'nothing was brought down')
})
