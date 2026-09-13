import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import { createFamilyTree } from '../storage/familyTrees'
import { createPerson } from '../storage/people'
import { createParentLink } from '../storage/relationships'
import { adoptLocalTree } from './adoptTree'
import { CloudRemoteAdapter } from './cloudRemoteAdapter'
import type { CloudSyncTransport } from './cloudRemoteAdapter'
import { NoCloudTreeStore } from './cloudTrees'
import type { AdoptableTree, CloudTreeContents, CloudTreeStore, CloudTreeSummary } from './cloudTrees'
import { NullRemoteAdapter } from '../sync/remoteAdapter'

/**
 * The client half of cloud trees: what is uploaded, what is not, and what
 * happens to the local family when the cloud says no.
 *
 * Authorisation is NOT tested here — it is tested against real Postgres
 * in rls.test.ts, because a mock that agrees with the policies proves
 * only that the mock agrees with itself.
 */

/** A cloud that records what it was asked to do, and can be told to fail. */
class FakeCloud implements CloudTreeStore {
  adopted: AdoptableTree[] = []
  profiles: { email: string | null; displayName: string | null }[] = []
  trees: CloudTreeSummary[] = []
  failAdoptWith: string | null = null

  async ensureProfile(email: string | null, displayName: string | null): Promise<void> {
    this.profiles.push({ email, displayName })
  }

  async listTrees(): Promise<CloudTreeSummary[]> {
    return this.trees
  }

  async adopt(tree: AdoptableTree): Promise<string> {
    if (this.failAdoptWith) throw new Error(this.failAdoptWith)
    this.adopted.push(tree)
    return tree.familyTree.id
  }

  async fetchTree(familyTreeId: string): Promise<CloudTreeContents> {
    const adopted = this.adopted.find((tree) => tree.familyTree.id === familyTreeId)
    if (!adopted) throw new Error('That family tree is not available to your account.')
    return adopted
  }
}

/** A transport that carries nothing, for the tree-shaped tests. */
const emptyTransport: CloudSyncTransport = {
  async headSeq() {
    return 7
  },
  async pull(_treeId, cursor) {
    return { events: [], cursor, hasMore: false }
  },
  async push(_treeId, events) {
    return { accepted: events.map((event) => ({ ...event, serverSeq: 1, recordedAt: 'x' })), rejected: [] }
  },
}

async function seedLocalFamily() {
  const tree = await createFamilyTree({ name: 'Okafor Family' })
  const grace = await createPerson({ familyTreeId: tree.id, firstName: 'Grace', lastName: 'Okafor', gender: 'female' })
  const sam = await createPerson({ familyTreeId: tree.id, firstName: 'Sam', lastName: 'Okafor', gender: 'male' })
  await createParentLink({ familyTreeId: tree.id, parentId: grace.id, childId: sam.id, relationship: 'biological' })
  return { tree, grace, sam }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

// ── with no cloud at all ────────────────────────────────────────────

test('with no cloud, nothing is listed and saving is refused rather than faked', async () => {
  const store = new NoCloudTreeStore()
  assert.deepEqual(await store.listTrees(), [])
  await store.ensureProfile(null, null) // a no-op, not a failure
  await assert.rejects(() => store.adopt(), /no cloud configured/i)
  await assert.rejects(() => store.fetchTree(), /no cloud configured/i)
})

test('the null adapter is still what an unconfigured build syncs through', async () => {
  const adapter = new NullRemoteAdapter()
  assert.deepEqual(await adapter.listTrees(), [])
  const push = await adapter.push('tree', [])
  assert.deepEqual(push.accepted, [])
})

// ── what adoption sends ─────────────────────────────────────────────

test('adoption uploads the family and keeps the local ids', async () => {
  const { tree, grace } = await seedLocalFamily()
  const cloud = new FakeCloud()

  const returnedId = await adoptLocalTree(tree.id, cloud)

  assert.equal(returnedId, tree.id, 'the tree keeps the id it already had')
  assert.equal(cloud.adopted.length, 1)

  const sent = cloud.adopted[0]
  assert.equal(sent?.familyTree.id, tree.id)
  assert.equal(sent?.people.length, 2)
  assert.equal(sent?.parentLinks.length, 1)
  assert.ok(
    sent?.people.some((person) => person.id === grace.id),
    'people are sent under the ids they were created with',
  )
})

test('adoption sends the family and nothing else', async () => {
  const { tree } = await seedLocalFamily()
  const cloud = new FakeCloud()
  await adoptLocalTree(tree.id, cloud)

  const sent = cloud.adopted[0] as unknown as Record<string, unknown>
  assert.deepEqual(
    Object.keys(sent).sort(),
    ['familyGroupMembers', 'familyGroups', 'familyTree', 'parentLinks', 'people', 'unions'],
    'no history, no outbox, no cursor, no governance and no media',
  )
  for (const forbidden of ['changeEvents', 'outbox', 'syncState', 'familyTreeMembers', 'personClaims', 'invitations', 'governance', 'media']) {
    assert.ok(!(forbidden in sent), `${forbidden} must not be uploaded`)
  }
})

test('the local change log is untouched by adoption', async () => {
  const { tree } = await seedLocalFamily()
  const before = await db.changeEvents.count()
  await adoptLocalTree(tree.id, new FakeCloud())
  assert.equal(await db.changeEvents.count(), before, 'adoption records no events; it is not a sync')
})

// ── when the cloud says no ──────────────────────────────────────────

test('a failed adoption leaves the local family exactly as it was', async () => {
  const { tree } = await seedLocalFamily()
  const cloud = new FakeCloud()
  cloud.failAdoptWith = 'That family tree is already saved to an account.'

  const before = {
    trees: await db.familyTrees.count(),
    people: await db.people.count(),
    links: await db.parentLinks.count(),
    events: await db.changeEvents.count(),
  }

  await assert.rejects(() => adoptLocalTree(tree.id, cloud), /already saved/i)

  assert.deepEqual(
    {
      trees: await db.familyTrees.count(),
      people: await db.people.count(),
      links: await db.parentLinks.count(),
      events: await db.changeEvents.count(),
    },
    before,
    'nothing local was created, changed or removed',
  )

  const stillThere = await db.familyTrees.get(tree.id)
  assert.equal(stillThere?.name, 'Okafor Family', 'and the tree is still usable')
})

test('adopting a tree that does not exist locally fails before reaching the cloud', async () => {
  const cloud = new FakeCloud()
  await assert.rejects(() => adoptLocalTree('no-such-tree', cloud), /Cannot export/i)
  assert.equal(cloud.adopted.length, 0, 'nothing was sent')
})

// ── listing and bootstrap through the existing adapter ──────────────

test('the adapter lists what the account can reach', async () => {
  const cloud = new FakeCloud()
  cloud.trees = [
    { id: 't1', name: 'Okafor Family', role: 'owner', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 't2', name: 'Adeyemi Family', role: 'viewer', updatedAt: '2026-01-02T00:00:00.000Z' },
  ]

  const adapter = new CloudRemoteAdapter(cloud, emptyTransport)
  assert.deepEqual(await adapter.listTrees(), [
    { familyTreeId: 't1', name: 'Okafor Family' },
    { familyTreeId: 't2', name: 'Adeyemi Family' },
  ])
})

test('bootstrap returns materialised records, not a replay', async () => {
  const { tree } = await seedLocalFamily()
  const cloud = new FakeCloud()
  await adoptLocalTree(tree.id, cloud)

  const adapter = new CloudRemoteAdapter(cloud, emptyTransport)
  const result = await adapter.bootstrap(tree.id)

  const entities = result.records.map((entry) => entry.entity)
  assert.equal(entities.filter((entity) => entity === 'familyTree').length, 1)
  assert.equal(entities.filter((entity) => entity === 'person').length, 2)
  assert.equal(entities.filter((entity) => entity === 'parentLink').length, 1)
  assert.equal(
    result.cursor.lastServerSeq,
    7,
    'the cursor is the position the server reports, read after the rows',
  )
})

test('bootstrap refuses a tree the account cannot reach', async () => {
  const adapter = new CloudRemoteAdapter(new FakeCloud(), emptyTransport)
  await assert.rejects(() => adapter.bootstrap('someone-elses-tree'), /not available to your account/i)
})

test('the adapter carries events through its transport', async () => {
  const adapter = new CloudRemoteAdapter(new FakeCloud(), emptyTransport)

  const pulled = await adapter.pull('t1', { lastServerSeq: null })
  assert.deepEqual(pulled.events, [], 'nothing newer, which is a real answer')

  const pushed = await adapter.push('t1', [
    { id: 'e1' } as unknown as Parameters<CloudRemoteAdapter['push']>[1][number],
  ])
  assert.equal(pushed.accepted.length, 1)
  assert.equal(pushed.accepted[0]?.serverSeq, 1, 'and the server sequence comes back on it')
})

test('a transport failure stays a failure', async () => {
  const failing: CloudSyncTransport = {
    async headSeq() {
      throw new Error('Failed to fetch')
    },
    async pull() {
      throw new Error('Failed to fetch')
    },
    async push() {
      throw new Error('Failed to fetch')
    },
  }
  const adapter = new CloudRemoteAdapter(new FakeCloud(), failing)
  await assert.rejects(
    () => adapter.pull('t1', { lastServerSeq: null }),
    /Failed to fetch/,
    'never turned into an empty list, which a caller would record as progress',
  )
})
