// Must be the very first import: registers global indexedDB before db.ts's
// `export const db = new FamilyTreeDatabase()` runs at module-load time.
import 'fake-indexeddb/auto'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import type { Table } from 'dexie'

import { db, FamilyTreeDatabase } from '../storage/db'
import { createFamilyTree, getAllFamilyTrees, getFamilyTree, updateFamilyTree } from '../storage/familyTrees'
import { createPerson, deletePerson, getPeopleByTree, getPerson, restorePerson, updatePerson } from '../storage/people'
import {
  createParentLink,
  createUnion,
  deleteParentLink,
  getParentLinksByTree,
  getUnionsByTree,
} from '../storage/relationships'
import {
  addFamilyGroupMember,
  createFamilyGroup,
  deleteFamilyGroup,
  getFamilyGroupMembers,
  getFamilyGroupMembersByTree,
  getFamilyGroupsByTree,
  removeFamilyGroupMember,
} from '../storage/familyGroups'
import { createPersonWithRelationship } from '../storage/linkRelative'
import { restoreEntity, revertChangeEvent } from '../storage/undo'
import {
  createLocalActor,
  getCurrentLocalActor,
  listLocalActors,
  setCurrentLocalActor,
} from '../identity/localActor'
import { getChangeEvents, getChangeEventsForEntity, getChangeSet } from './changeLog'
import { getOutboxEntries, getOutboxSize } from './outbox'
import { getSyncState } from './syncState'
import type { ChangeEvent, SyncEntity } from './changeTypes'

// Node has no localStorage, so local identity gets the same treatment
// fake-indexeddb gives Dexie: a real implementation of the real interface,
// installed globally, so the production code path is what runs. Defined as
// a getter that can be made to throw, which lets a test reproduce the
// storage-unavailable case (private browsing, exhausted quota) exactly as
// the browser presents it.
const LOCAL_IDENTITY_KEY = 'familytree.localIdentity'

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
  } as Storage
}

let backingStorage: Storage | null = createMemoryStorage()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() {
    if (!backingStorage) throw new Error('localStorage is unavailable')
    return backingStorage
  },
})

/** Runs `fn` as though the browser refused access to localStorage entirely. */
async function withoutLocalStorage<T>(fn: () => Promise<T>): Promise<T> {
  const saved = backingStorage
  backingStorage = null
  try {
    return await fn()
  } finally {
    backingStorage = saved
  }
}

/** Puts the device back to "never had an identity". */
function forgetLocalIdentity(): void {
  localStorage.removeItem(LOCAL_IDENTITY_KEY)
}

async function newTree(name = 'Test Tree') {
  return createFamilyTree({ name: `${name} ${crypto.randomUUID()}` })
}

async function newPerson(familyTreeId: string, firstName = 'Test') {
  return createPerson({ familyTreeId, firstName, lastName: 'Person', gender: 'unknown' })
}

function ofEntity(events: ChangeEvent[], entity: SyncEntity, entityId?: string): ChangeEvent[] {
  return events.filter((e) => e.entity === entity && (entityId === undefined || e.entityId === entityId))
}

// ── Event creation ───────────────────────────────────────────────────

test('1. creating a person records a create event with a null before and the full record after', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Ada')

  const events = ofEntity(await getChangeEvents(tree.id), 'person', person.id)
  assert.equal(events.length, 1)
  const event = events[0] as ChangeEvent
  assert.equal(event.op, 'create')
  assert.equal(event.before, null)
  assert.deepEqual(event.after, person, 'the complete record is stored, not a diff')
  assert.equal(event.familyTreeId, tree.id)
})

test('2. updating a person records both the previous and the new complete record', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'John')

  await updatePerson(person.id, { firstName: 'Johnny' })

  const events = ofEntity(await getChangeEvents(tree.id), 'person', person.id)
  assert.equal(events.length, 2)
  const update = events[1] as ChangeEvent
  assert.equal(update.op, 'update')
  assert.equal((update.before as { firstName: string }).firstName, 'John')
  assert.equal((update.after as { firstName: string }).firstName, 'Johnny')
  // The rest of the record travels with it, not just the changed field.
  assert.equal((update.after as { lastName: string }).lastName, 'Person')
})

test('3. parent links, unions, groups and memberships all record events', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  const partner = await newPerson(tree.id, 'Partner')

  const link = await createParentLink({
    familyTreeId: tree.id,
    parentId: parent.id,
    childId: child.id,
    relationship: 'biological',
  })
  const union = await createUnion({
    familyTreeId: tree.id,
    partnerAId: parent.id,
    partnerBId: partner.id,
    status: 'married',
  })
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Group', establishedPrecision: 'unknown' })
  const member = await addFamilyGroupMember({
    familyTreeId: tree.id,
    familyGroupId: group.id,
    personId: parent.id,
  })

  const events = await getChangeEvents(tree.id)
  assert.equal(ofEntity(events, 'parentLink', link.id).length, 1)
  assert.equal(ofEntity(events, 'union', union.id).length, 1)
  assert.equal(ofEntity(events, 'familyGroup', group.id).length, 1)
  assert.equal(ofEntity(events, 'familyGroupMember', member.id).length, 1)
  assert.equal(ofEntity(events, 'familyTree', tree.id).length, 1, 'creating the tree was itself an event')
})

test('4. every event is local-only: serverSeq is null, never faked, and the actor is device-local', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  await updatePerson(person.id, { firstName: 'Renamed' })
  await deletePerson(person.id)

  const events = await getChangeEvents(tree.id)
  assert.ok(events.length >= 3)
  for (const event of events) {
    // 5B-1 fills actorId from a device-local actor. It is attribution, not
    // authentication: still no account, no server, no verification.
    assert.equal(typeof event.actorId, 'string', 'edits are attributed to the local actor')
    assert.equal(event.serverSeq, null, 'no server exists in 5A')
    assert.equal(event.recordedAt, null)
    assert.ok(event.createdAt, 'the client clock is still recorded')
  }
})

test('5. per-entity history can be read back for one record', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'A')
  await updatePerson(person.id, { firstName: 'B' })
  await updatePerson(person.id, { firstName: 'C' })

  const history = await getChangeEventsForEntity('person', person.id)
  assert.deepEqual(
    history.map((event) => event.op),
    ['create', 'update', 'update'],
  )
})

// ── Ordering and immutability ────────────────────────────────────────

test('6. clientSeq increases monotonically and orders the history', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  await updatePerson(person.id, { firstName: 'Two' })
  await updatePerson(person.id, { firstName: 'Three' })

  const events = await getChangeEvents(tree.id)
  const seqs = events.map((event) => event.clientSeq)
  assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, 'already in ascending order')
  assert.equal(new Set(seqs).size, seqs.length, 'no two events share a sequence')
})

test('7. recorded events are never rewritten by later mutations', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Original')
  const [createEvent] = await getChangeEventsForEntity('person', person.id)
  const snapshot = JSON.parse(JSON.stringify(createEvent))

  await updatePerson(person.id, { firstName: 'Changed' })
  await deletePerson(person.id)
  await restorePerson(person.id)

  const [afterAll] = await getChangeEventsForEntity('person', person.id)
  assert.deepEqual(afterAll, snapshot, 'the original create event is untouched')
})

test('8. the module exposes no way to mutate the log', async () => {
  const api = await import('./index')
  for (const forbidden of ['updateChangeEvent', 'deleteChangeEvent', 'clearChangeEvents']) {
    assert.equal((api as Record<string, unknown>)[forbidden], undefined, `${forbidden} must not exist`)
  }
})

// ── Outbox ───────────────────────────────────────────────────────────

test('9. every event is queued in the outbox, keyed by the event id', async () => {
  const tree = await newTree()
  await newPerson(tree.id)

  const events = await getChangeEvents(tree.id)
  const entries = await getOutboxEntries(tree.id)
  assert.equal(entries.length, events.length, 'one queued entry per event')
  assert.deepEqual(
    entries.map((entry) => entry.eventId).sort(),
    events.map((event) => event.id).sort(),
  )
  assert.equal(await getOutboxSize(tree.id), events.length)
})

// ── Tombstones ───────────────────────────────────────────────────────

test('10. deleting a person tombstones rather than removes, and hides them from readers', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Gone')

  await deletePerson(person.id)

  assert.equal(await getPerson(person.id), undefined, 'readers hide the tombstone')
  assert.deepEqual(await getPeopleByTree(tree.id), [], 'and it is gone from the tree listing')

  const raw = await db.people.get(person.id)
  assert.ok(raw, 'but the row itself is still there')
  assert.ok(raw?.deletedAt, 'carrying a tombstone')
})

test('11. deleting a person tombstones their relationships so none stay live against them', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  const partner = await newPerson(tree.id, 'Partner')
  const link = await createParentLink({
    familyTreeId: tree.id,
    parentId: parent.id,
    childId: child.id,
    relationship: 'biological',
  })
  const union = await createUnion({
    familyTreeId: tree.id,
    partnerAId: parent.id,
    partnerBId: partner.id,
    status: 'married',
  })

  await deletePerson(parent.id)

  assert.deepEqual(await getParentLinksByTree(tree.id), [], 'no live link points at a deleted person')
  assert.deepEqual(await getUnionsByTree(tree.id), [], 'no live union either')

  // Nothing was physically erased — the history is still recoverable.
  assert.ok((await db.parentLinks.get(link.id))?.deletedAt)
  assert.ok((await db.unions.get(union.id))?.deletedAt)

  const events = await getChangeEvents(tree.id)
  assert.equal(ofEntity(events, 'parentLink', link.id).at(-1)?.op, 'delete')
  assert.equal(ofEntity(events, 'union', union.id).at(-1)?.op, 'delete')
  assert.equal(ofEntity(events, 'person', parent.id).at(-1)?.op, 'delete')
})

test('12. a cascading delete tombstones memberships and clears a group it founded', async () => {
  const tree = await newTree()
  const founder = await newPerson(tree.id, 'Founder')
  const group = await createFamilyGroup({
    familyTreeId: tree.id,
    name: 'Founded',
    originPersonId: founder.id,
    establishedPrecision: 'unknown',
  })
  const member = await addFamilyGroupMember({
    familyTreeId: tree.id,
    familyGroupId: group.id,
    personId: founder.id,
  })

  await deletePerson(founder.id)

  assert.deepEqual(await getFamilyGroupMembers(group.id), [], 'membership is no longer live')
  assert.ok((await db.familyGroupMembers.get(member.id))?.deletedAt, 'but is recoverable')

  const groups = await getFamilyGroupsByTree(tree.id)
  assert.equal(groups.length, 1, 'the group itself survives its founder')
  assert.equal(groups[0]?.originPersonId, undefined, 'with the dangling founder reference cleared')

  const groupEvents = await getChangeEventsForEntity('familyGroup', group.id)
  assert.equal(groupEvents.at(-1)?.op, 'update', 'clearing the founder is an update, not a delete')
})

test('13. deleting a group tombstones its memberships but never the people', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Doomed', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id })

  await deleteFamilyGroup(group.id)

  assert.deepEqual(await getFamilyGroupsByTree(tree.id), [])
  assert.deepEqual(await getFamilyGroupMembers(group.id), [])
  assert.ok(await getPerson(person.id), 'the person is untouched')
})

test('14. a tombstoned relationship no longer blocks re-adding the same one', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'P')
  const child = await newPerson(tree.id, 'C')
  const first = await createParentLink({
    familyTreeId: tree.id,
    parentId: parent.id,
    childId: child.id,
    relationship: 'biological',
  })

  await deleteParentLink(first.id)
  // Would have thrown DuplicateRelationshipError if tombstones counted.
  const second = await createParentLink({
    familyTreeId: tree.id,
    parentId: parent.id,
    childId: child.id,
    relationship: 'biological',
  })

  assert.notEqual(second.id, first.id)
  assert.equal((await getParentLinksByTree(tree.id)).length, 1)
})

test('15. re-adding a removed group member revives the row and records a restore', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'G', establishedPrecision: 'unknown' })
  const member = await addFamilyGroupMember({
    familyTreeId: tree.id,
    familyGroupId: group.id,
    personId: person.id,
  })

  await removeFamilyGroupMember(member.id)
  const readded = await addFamilyGroupMember({
    familyTreeId: tree.id,
    familyGroupId: group.id,
    personId: person.id,
  })

  assert.equal(readded.id, member.id, 'the unique index means the original row is revived')
  assert.equal((await getFamilyGroupMembers(group.id)).length, 1, 'and there is exactly one live membership')
  assert.equal((await getChangeEventsForEntity('familyGroupMember', member.id)).at(-1)?.op, 'restore')
})

// ── Restore and undo ─────────────────────────────────────────────────

test('16. restoring a person adds a new event and leaves the delete event alone', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Back')
  await deletePerson(person.id)

  const deleteEvent = (await getChangeEventsForEntity('person', person.id)).at(-1) as ChangeEvent
  const deleteSnapshot = JSON.parse(JSON.stringify(deleteEvent))

  await restorePerson(person.id)

  assert.ok(await getPerson(person.id), 'the person is live again')
  const history = await getChangeEventsForEntity('person', person.id)
  assert.equal(history.at(-1)?.op, 'restore')
  const unchanged = history.find((event) => event.clientSeq === deleteEvent.clientSeq)
  assert.deepEqual(unchanged, deleteSnapshot, 'the delete event was not rewritten')
})

test('17. reverting an update writes the previous value back as a NEW event', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'John')
  await updatePerson(person.id, { firstName: 'Johnny' })

  const updateEvent = (await getChangeEventsForEntity('person', person.id)).at(-1) as ChangeEvent
  const before = JSON.parse(JSON.stringify(updateEvent))

  assert.equal(await revertChangeEvent(updateEvent.clientSeq), true)

  assert.equal((await getPerson(person.id))?.firstName, 'John', 'the old name is back')
  const history = await getChangeEventsForEntity('person', person.id)
  assert.equal(history.length, 3, 'the revert appended rather than replaced')
  assert.deepEqual(
    history.find((event) => event.clientSeq === updateEvent.clientSeq),
    before,
    'the reverted event is untouched',
  )
})

test('18. reverting a create tombstones the record; reverting a delete restores it', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Temp')
  const createEvent = (await getChangeEventsForEntity('person', person.id))[0] as ChangeEvent

  assert.equal(await revertChangeEvent(createEvent.clientSeq), true)
  assert.equal(await getPerson(person.id), undefined, 'undoing a create removes it from view')

  const deleteEvent = (await getChangeEventsForEntity('person', person.id)).at(-1) as ChangeEvent
  assert.equal(await revertChangeEvent(deleteEvent.clientSeq), true)
  assert.ok(await getPerson(person.id), 'undoing that delete brings it back')
})

test('19. a relationship tombstoned by a cascade can be restored individually', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  const link = await createParentLink({
    familyTreeId: tree.id,
    parentId: parent.id,
    childId: child.id,
    relationship: 'biological',
  })

  await deletePerson(parent.id)
  await restorePerson(parent.id)
  assert.deepEqual(await getParentLinksByTree(tree.id), [], 'the cascade is deliberately not automatic')

  assert.equal(await restoreEntity('parentLink', link.id), true)
  assert.equal((await getParentLinksByTree(tree.id)).length, 1, 'and is recoverable on its own')
})

test('20. reverting something already undone is a no-op rather than an error', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  const createEvent = (await getChangeEventsForEntity('person', person.id))[0] as ChangeEvent

  assert.equal(await revertChangeEvent(createEvent.clientSeq), true)
  assert.equal(await revertChangeEvent(createEvent.clientSeq), false, 'second attempt does nothing')
  assert.equal(await revertChangeEvent(999_999), false, 'unknown events do not throw')
})

// ── Atomicity ────────────────────────────────────────────────────────

test('21. a rejected mutation leaves no record, no event and no outbox entry', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  await createParentLink({
    familyTreeId: tree.id,
    parentId: parent.id,
    childId: child.id,
    relationship: 'biological',
  })

  const eventsBefore = (await getChangeEvents(tree.id)).length
  const outboxBefore = await getOutboxSize(tree.id)
  const linksBefore = (await getParentLinksByTree(tree.id)).length

  // Closing the loop child -> parent must be rejected.
  await assert.rejects(() =>
    createParentLink({
      familyTreeId: tree.id,
      parentId: child.id,
      childId: parent.id,
      relationship: 'biological',
    }),
  )

  assert.equal((await getParentLinksByTree(tree.id)).length, linksBefore, 'no partial mutation')
  assert.equal((await getChangeEvents(tree.id)).length, eventsBefore, 'no orphan event')
  assert.equal(await getOutboxSize(tree.id), outboxBefore, 'no orphan outbox entry')
})

test('22. a failed create-with-relationship rolls back the person AND its event together', async () => {
  const tree = await newTree()
  const otherTree = await newTree('Other')
  const foreignAnchor = await newPerson(otherTree.id, 'Foreign Anchor')

  const eventsBefore = (await getChangeEvents(tree.id)).length
  const peopleBefore = (await getPeopleByTree(tree.id)).length

  // createPersonWithRelationship writes the Person and its event FIRST,
  // then links. Anchoring to somebody in another tree makes the link fail
  // the cross-tree guard afterwards — so if the two halves were not in one
  // transaction, a person and an event would survive with nothing joining
  // them to anything.
  await assert.rejects(() =>
    createPersonWithRelationship(
      { familyTreeId: tree.id, firstName: 'Never', lastName: 'Committed', gender: 'unknown' },
      foreignAnchor.id,
      { kind: 'parent', relationship: 'biological' },
    ),
  )

  const peopleAfter = await getPeopleByTree(tree.id)
  assert.equal(peopleAfter.length, peopleBefore, 'the half-written person rolled back')
  assert.ok(!peopleAfter.some((person) => person.lastName === 'Committed'))
  assert.equal((await getChangeEvents(tree.id)).length, eventsBefore, 'and so did its event')
  assert.equal(await getOutboxSize(tree.id), eventsBefore, 'leaving nothing queued')
})

test('23. an explicit transaction abort leaves neither the record nor its event', async () => {
  const tree = await newTree()
  const eventsBefore = (await getChangeEvents(tree.id)).length
  const peopleBefore = (await getPeopleByTree(tree.id)).length
  const orphanId = crypto.randomUUID()

  await assert.rejects(() =>
    db.transaction('rw', [db.people, db.changeEvents, db.outbox], async () => {
      await db.people.add({
        id: orphanId,
        familyTreeId: tree.id,
        firstName: 'Orphan',
        lastName: '',
        gender: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      throw new Error('abort')
    }),
  )

  assert.equal(await db.people.get(orphanId), undefined, 'the row rolled back')
  assert.equal((await getPeopleByTree(tree.id)).length, peopleBefore)
  assert.equal((await getChangeEvents(tree.id)).length, eventsBefore)
})

// ── Local-only trees and sync state ──────────────────────────────────

test('24. a new tree is local-only: sync state exists but records no position', async () => {
  const tree = await newTree()
  const state = await getSyncState(tree.id)

  assert.ok(state, 'the row exists so the concept is there from the start')
  assert.equal(state?.lastServerSeq, null, 'nothing has ever been synced')
  assert.equal(state?.lastSyncedAt, null)
})

test('25. trees need no owner and no account to be usable', async () => {
  const tree = await newTree('Local Only')
  await updateFamilyTree(tree.id, { name: 'Renamed Locally' })

  const reloaded = await getFamilyTree(tree.id)
  assert.equal(reloaded?.name, 'Renamed Locally')
  assert.ok(!('ownerUserId' in (reloaded as object)), 'no ownership concept was introduced')
  assert.ok((await getAllFamilyTrees()).some((candidate) => candidate.id === tree.id))
})

// ── Migration from the pre-5A schema ─────────────────────────────────

interface LegacyRecord {
  id: string
  familyTreeId?: string
  [key: string]: unknown
}

/** A byte-for-byte replica of the version(1)+(2) schema, before tombstones existed. */
class LegacyV2Database extends Dexie {
  familyTrees!: Table<LegacyRecord, string>
  people!: Table<LegacyRecord, string>
  parentLinks!: Table<LegacyRecord, string>
  familyGroups!: Table<LegacyRecord, string>
  familyGroupMembers!: Table<LegacyRecord, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      familyTrees: 'id, updatedAt',
      people: 'id, familyTreeId',
      parentLinks: 'id, familyTreeId, parentId, childId',
      unions: 'id, familyTreeId, partnerAId, partnerBId',
      media: 'id, familyTreeId, kind, *personIds',
    })
    this.version(2).stores({
      familyGroups: 'id, familyTreeId, originPersonId',
      familyGroupMembers: 'id, familyTreeId, familyGroupId, personId, &[familyGroupId+personId]',
    })
  }
}

test('26. a real v2 database upgrades to v3 with every record intact and usable', async () => {
  const dbName = `FamilyTreeDatabase-5a-migration-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const treeId = crypto.randomUUID()
  const parentId = crypto.randomUUID()
  const childId = crypto.randomUUID()
  const linkId = crypto.randomUUID()
  const groupId = crypto.randomUUID()
  const memberId = crypto.randomUUID()

  const legacy = new LegacyV2Database(dbName)
  await legacy.open()
  await legacy.familyTrees.add({ id: treeId, name: 'Legacy Tree', createdAt: now, updatedAt: now })
  await legacy.people.add({
    id: parentId, familyTreeId: treeId, firstName: 'Legacy', lastName: 'Parent',
    gender: 'unknown', createdAt: now, updatedAt: now,
  })
  await legacy.people.add({
    id: childId, familyTreeId: treeId, firstName: 'Legacy', lastName: 'Child',
    gender: 'unknown', createdAt: now, updatedAt: now,
  })
  await legacy.parentLinks.add({
    id: linkId, familyTreeId: treeId, parentId, childId,
    relationship: 'biological', createdAt: now, updatedAt: now,
  })
  await legacy.familyGroups.add({
    id: groupId, familyTreeId: treeId, name: 'Legacy Group',
    establishedPrecision: 'unknown', createdAt: now, updatedAt: now,
  })
  await legacy.familyGroupMembers.add({
    id: memberId, familyTreeId: treeId, familyGroupId: groupId,
    personId: parentId, createdAt: now, updatedAt: now,
  })
  legacy.close()

  // Reopen the SAME database under the real, current schema.
  const upgraded = new FamilyTreeDatabase(dbName)
  await upgraded.open()

  try {
    assert.equal((await upgraded.familyTrees.get(treeId))?.name, 'Legacy Tree')
    assert.equal((await upgraded.people.get(parentId))?.firstName, 'Legacy')
    assert.equal((await upgraded.parentLinks.get(linkId))?.relationship, 'biological')
    assert.equal((await upgraded.familyGroups.get(groupId))?.name, 'Legacy Group')
    assert.equal((await upgraded.familyGroupMembers.get(memberId))?.personId, parentId)

    // Records predating tombstones have no deletedAt, which reads as live.
    assert.equal((await upgraded.people.get(parentId))?.deletedAt, undefined)

    // The new stores exist and are empty — no fabricated history.
    assert.equal(await upgraded.changeEvents.count(), 0)
    assert.equal(await upgraded.outbox.count(), 0)
    assert.equal(await upgraded.syncState.count(), 0)

    // And the pre-existing unique index still holds after the upgrade.
    await assert.rejects(() =>
      upgraded.familyGroupMembers.add({
        id: crypto.randomUUID(), familyTreeId: treeId, familyGroupId: groupId,
        personId: parentId, createdAt: now, updatedAt: now,
      }),
    )
  } finally {
    upgraded.close()
    await Dexie.delete(dbName)
  }
})

test('27. legacy records with no deletedAt are treated as live by the storage readers', async () => {
  // Written straight to the table without a deletedAt, exactly as a
  // pre-5A record would be.
  const tree = await newTree()
  const legacyPersonId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.people.add({
    id: legacyPersonId,
    familyTreeId: tree.id,
    firstName: 'Pre-5A',
    lastName: 'Person',
    gender: 'unknown',
    createdAt: now,
    updatedAt: now,
  })

  assert.ok(await getPerson(legacyPersonId), 'reads as live')
  assert.ok((await getPeopleByTree(tree.id)).some((person) => person.id === legacyPersonId))
})

// ── Phase 5A hardening: change sets ──────────────────────────────────
// One user action can touch many records. Each record mutation stays its
// own immutable event; `changeSetId` is what says they were one action.

test('28. an ordinary single-record mutation still gets its own change set', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Solo')

  const events = await getChangeEventsForEntity('person', person.id)
  assert.equal(events.length, 1)
  const changeSetId = (events[0] as ChangeEvent).changeSetId
  assert.ok(changeSetId, 'a change set of one is still a change set')

  const set = await getChangeSet(changeSetId)
  assert.equal(set.length, 1)
})

test('29. a cascading delete emits one event per record, all sharing one change set', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  const partner = await newPerson(tree.id, 'Partner')
  const link = await createParentLink({
    familyTreeId: tree.id, parentId: parent.id, childId: child.id, relationship: 'biological',
  })
  const union = await createUnion({
    familyTreeId: tree.id, partnerAId: parent.id, partnerBId: partner.id, status: 'married',
  })
  const group = await createFamilyGroup({
    familyTreeId: tree.id, name: 'Founded', originPersonId: parent.id, establishedPrecision: 'unknown',
  })
  const member = await addFamilyGroupMember({
    familyTreeId: tree.id, familyGroupId: group.id, personId: parent.id,
  })

  const before = (await getChangeEvents(tree.id)).length
  await deletePerson(parent.id)
  const produced = (await getChangeEvents(tree.id)).slice(before)

  // Nothing was merged: every touched record still has its own event.
  assert.equal(produced.length, 5, 'person + link + union + membership + group founder update')
  const changeSetIds = new Set(produced.map((event) => event.changeSetId))
  assert.equal(changeSetIds.size, 1, 'but they are one logical action')

  const [changeSetId] = [...changeSetIds]
  const set = await getChangeSet(changeSetId as string)
  assert.equal(set.length, 5)
  assert.deepEqual(
    set.map((event) => `${event.entity}:${event.op}`).sort(),
    [
      'familyGroup:update',
      'familyGroupMember:delete',
      'parentLink:delete',
      'person:delete',
      'union:delete',
    ],
    'each entity keeps its own operation',
  )
  // And each names the right record.
  assert.ok(set.some((e) => e.entityId === link.id))
  assert.ok(set.some((e) => e.entityId === union.id))
  assert.ok(set.some((e) => e.entityId === member.id))
  assert.ok(set.some((e) => e.entityId === group.id))
  assert.ok(set.some((e) => e.entityId === parent.id))
})

test('30. nested storage calls join their caller’s change set rather than starting their own', async () => {
  const tree = await newTree()
  const anchor = await newPerson(tree.id, 'Anchor')
  const before = (await getChangeEvents(tree.id)).length

  // createPersonWithRelationship writes a Person AND a ParentLink through
  // two separate storage functions, each of which opens its own nested
  // transaction. They must still count as one action.
  await createPersonWithRelationship(
    { familyTreeId: tree.id, firstName: 'Nested', lastName: 'Child', gender: 'unknown' },
    anchor.id,
    { kind: 'child', relationship: 'biological' },
  )

  const produced = (await getChangeEvents(tree.id)).slice(before)
  assert.equal(produced.length, 2, 'a person event and a parent-link event')
  assert.equal(new Set(produced.map((event) => event.changeSetId)).size, 1, 'grouped as one action')
  assert.deepEqual(produced.map((event) => event.entity).sort(), ['parentLink', 'person'])
})

test('31. separate user actions never share a change set', async () => {
  const tree = await newTree()
  const first = await newPerson(tree.id, 'First')
  const second = await newPerson(tree.id, 'Second')
  await updatePerson(first.id, { firstName: 'Renamed' })

  const ids = [
    (await getChangeEventsForEntity('person', first.id))[0]?.changeSetId,
    (await getChangeEventsForEntity('person', second.id))[0]?.changeSetId,
    (await getChangeEventsForEntity('person', first.id))[1]?.changeSetId,
  ]
  assert.equal(new Set(ids).size, 3, 'three actions, three change sets')
})

test('32. an undo is its own action, not part of the change set it reverses', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'John')
  await updatePerson(person.id, { firstName: 'Johnny' })

  const updateEvent = (await getChangeEventsForEntity('person', person.id)).at(-1) as ChangeEvent
  await revertChangeEvent(updateEvent.clientSeq)

  const history = await getChangeEventsForEntity('person', person.id)
  const undoEvent = history.at(-1) as ChangeEvent
  assert.notEqual(undoEvent.changeSetId, updateEvent.changeSetId, 'undoing is a new action in its own right')
  assert.equal((await getChangeSet(updateEvent.changeSetId)).length, 1, 'the reversed set is unchanged')
})

test('33. a rolled-back cascade leaves no events, no outbox entries and no change set', async () => {
  const tree = await newTree()
  const otherTree = await newTree('Other')
  const foreignAnchor = await newPerson(otherTree.id, 'Foreign')

  const eventsBefore = (await getChangeEvents(tree.id)).length
  const outboxBefore = await getOutboxSize(tree.id)
  const allSetsBefore = new Set((await getChangeEvents(tree.id)).map((event) => event.changeSetId))

  await assert.rejects(() =>
    createPersonWithRelationship(
      { familyTreeId: tree.id, firstName: 'Never', lastName: 'Committed', gender: 'unknown' },
      foreignAnchor.id,
      { kind: 'parent', relationship: 'biological' },
    ),
  )

  const after = await getChangeEvents(tree.id)
  assert.equal(after.length, eventsBefore, 'no partial events survived')
  assert.equal(await getOutboxSize(tree.id), outboxBefore, 'and none were queued')
  assert.equal(
    new Set(after.map((event) => event.changeSetId)).size,
    allSetsBefore.size,
    'no half-formed change set was left behind',
  )
})

test('34. change sets do not weaken event immutability', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Immutable')
  const original = JSON.parse(JSON.stringify((await getChangeEventsForEntity('person', person.id))[0]))

  await updatePerson(person.id, { firstName: 'Changed' })
  await deletePerson(person.id)
  await restorePerson(person.id)

  const [createEvent] = await getChangeEventsForEntity('person', person.id)
  assert.deepEqual(createEvent, original, 'including its changeSetId')
})

// ── Tombstone safety at the storage boundary ─────────────────────────
// The derived algorithms are pure functions over whatever snapshot they
// are handed. They are not modified; instead this proves the snapshot
// they receive can never contain a tombstoned record.

test('35. every storage read path hides tombstoned records from the genealogy snapshot', async () => {
  const tree = await newTree()
  const keep = await newPerson(tree.id, 'Keep')
  const remove = await newPerson(tree.id, 'Remove')
  const link = await createParentLink({
    familyTreeId: tree.id, parentId: keep.id, childId: remove.id, relationship: 'biological',
  })
  const union = await createUnion({
    familyTreeId: tree.id, partnerAId: keep.id, partnerBId: remove.id, status: 'married',
  })
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'G', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: remove.id })

  await deletePerson(remove.id)

  // This is exactly the snapshot useFamilyGraph/useFamilyGroups build and
  // hand to graphAdapter, relationshipResolver, groupProjection, rank,
  // layout and deriveRelationships.
  const snapshot = {
    people: await getPeopleByTree(tree.id),
    parentLinks: await getParentLinksByTree(tree.id),
    unions: await getUnionsByTree(tree.id),
    familyGroups: await getFamilyGroupsByTree(tree.id),
    members: await getFamilyGroupMembersByTree(tree.id),
  }

  for (const [name, records] of Object.entries(snapshot)) {
    for (const record of records as { deletedAt?: string }[]) {
      assert.equal(record.deletedAt, undefined, `${name} must never carry a tombstone into the graph`)
    }
  }

  assert.ok(!snapshot.people.some((person) => person.id === remove.id))
  assert.ok(!snapshot.parentLinks.some((candidate) => candidate.id === link.id))
  assert.ok(!snapshot.unions.some((candidate) => candidate.id === union.id))
  assert.equal(snapshot.members.length, 0)
  assert.equal(snapshot.people.length, 1, 'only the live person remains')
})

test('36. a tombstoned person cannot be reached by relationship derivation', async () => {
  const tree = await newTree()
  const grand = await newPerson(tree.id, 'Grand')
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  await createParentLink({
    familyTreeId: tree.id, parentId: grand.id, childId: parent.id, relationship: 'biological',
  })
  await createParentLink({
    familyTreeId: tree.id, parentId: parent.id, childId: child.id, relationship: 'biological',
  })

  const { resolveRelationships } = await import('../relationships/relationshipResolver')

  const liveSnapshot = async () => ({
    people: await getPeopleByTree(tree.id),
    parentLinks: await getParentLinksByTree(tree.id),
    unions: await getUnionsByTree(tree.id),
  })

  const before = resolveRelationships(grand.id, child.id, await liveSnapshot())
  assert.equal(before.length, 1, 'grandparent is derived while the chain is intact')

  // Deleting the middle person tombstones the links either side of them,
  // so the chain is genuinely broken in the snapshot.
  await deletePerson(parent.id)

  const after = resolveRelationships(grand.id, child.id, await liveSnapshot())
  assert.deepEqual(after, [], 'no relationship is derived through a deleted person')
})

test('37. a tombstoned person is not offered as a live member or founder', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Doomed')
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'G', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id })

  await deletePerson(person.id)

  assert.deepEqual(await getFamilyGroupMembers(group.id), [], 'membership is gone from the live view')

  // And a deleted person can no longer be attached to anything new.
  await assert.rejects(
    () => addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id }),
    /no longer exists/,
  )
  await assert.rejects(
    () =>
      createFamilyGroup({
        familyTreeId: tree.id, name: 'Bad', originPersonId: person.id, establishedPrecision: 'unknown',
      }),
    /no longer exists/,
  )
})

// ── Phase 5B-1: device-local actor and attribution ───────────────────
// The change log stops recording `null` for "who did this". The actor is
// a name on this device — attribution, never authentication.

test('38. the first edit on a device creates a local actor and attributes itself to it', async () => {
  forgetLocalIdentity()
  assert.equal(getCurrentLocalActor(), null, 'no identity before first use')

  const tree = await newTree()
  const person = await newPerson(tree.id, 'FirstUse')

  const actor = getCurrentLocalActor()
  assert.ok(actor, 'first use created one')
  assert.ok(actor.displayName, 'and gave it a name rather than leaving it blank')

  const [event] = await getChangeEventsForEntity('person', person.id)
  assert.equal((event as ChangeEvent).actorId, actor.id)
})

test('39. the actor survives a reload, because localStorage is its only home', async () => {
  forgetLocalIdentity()
  const actor = createLocalActor('Habeeb')

  // Whatever crosses a reload is exactly this string and nothing else.
  const persisted = localStorage.getItem(LOCAL_IDENTITY_KEY)
  assert.ok(persisted, 'the identity was written to persistent storage')

  // Wiping it proves there is no hidden in-memory copy propping it up...
  localStorage.clear()
  assert.equal(getCurrentLocalActor(), null, 'nothing is cached in module state')

  // ...and restoring only that string is enough to come back, which is
  // precisely what a page reload does.
  localStorage.setItem(LOCAL_IDENTITY_KEY, persisted)
  assert.deepEqual(getCurrentLocalActor(), actor, 'the same actor, after reinitialization')
})

test('40. a new mutation is attributed to whichever actor is current', async () => {
  forgetLocalIdentity()
  const actor = createLocalActor('Ayesha')

  const tree = await newTree()
  const person = await newPerson(tree.id, 'Attributed')

  const [event] = await getChangeEventsForEntity('person', person.id)
  assert.equal((event as ChangeEvent).actorId, actor.id)
})

test('41. consecutive mutations by the same actor all carry that actor', async () => {
  forgetLocalIdentity()
  const actor = createLocalActor('Steady')

  const tree = await newTree()
  const person = await newPerson(tree.id, 'Same')
  await updatePerson(person.id, { firstName: 'Same Again' })
  await updatePerson(person.id, { lastName: 'Still' })

  const events = await getChangeEventsForEntity('person', person.id)
  assert.equal(events.length, 3)
  assert.deepEqual([...new Set(events.map((event) => event.actorId))], [actor.id])
  assert.equal(new Set(events.map((event) => event.changeSetId)).size, 3, 'three actions, unchanged')
})

test('42. switching actor changes future attribution and rewrites no history', async () => {
  forgetLocalIdentity()
  const first = createLocalActor('Habeeb')

  const tree = await newTree()
  const person = await newPerson(tree.id, 'Witness')
  const beforeSwitch = await getChangeEventsForEntity('person', person.id)

  const second = createLocalActor('Ayesha')
  assert.equal(getCurrentLocalActor()?.id, second.id, 'creating an actor makes it current')

  await updatePerson(person.id, { firstName: 'Renamed' })

  const events = await getChangeEventsForEntity('person', person.id)
  assert.equal(events[0]?.actorId, first.id, 'the earlier event still names who actually did it')
  assert.equal(events[1]?.actorId, second.id, 'the later event names the new actor')
  assert.deepEqual([events[0]], beforeSwitch, 'the earlier event is byte-for-byte untouched')

  // And switching back is just as inert.
  setCurrentLocalActor(first.id)
  await updatePerson(person.id, { lastName: 'Third' })
  const after = await getChangeEventsForEntity('person', person.id)
  assert.deepEqual(
    after.map((event) => event.actorId),
    [first.id, second.id, first.id],
  )
})

test('43. an event written with no identity available stays unattributed forever', async () => {
  const tree = await newTree()

  // Reproduces both the pre-5B-1 world and a browser that refuses storage.
  const person = await withoutLocalStorage(async () => newPerson(tree.id, 'Anonymous'))

  const [event] = await getChangeEventsForEntity('person', person.id)
  assert.equal((event as ChangeEvent).actorId, null, 'no actor is invented to fill the gap')

  // Identity arriving later must not retroactively claim earlier work.
  forgetLocalIdentity()
  const actor = createLocalActor('Latecomer')
  await updatePerson(person.id, { firstName: 'Named' })

  const events = await getChangeEventsForEntity('person', person.id)
  assert.equal(events[0]?.actorId, null, 'history is not backfilled')
  assert.equal(events[1]?.actorId, actor.id)
})

test('44. creating or switching actors never touches an existing event', async () => {
  forgetLocalIdentity()
  createLocalActor('Original')

  const tree = await newTree()
  await newPerson(tree.id, 'Frozen')
  // Each read returns fresh objects from Dexie, so this is a real snapshot
  // and not an alias of what the second read will return.
  const snapshot = await getChangeEvents(tree.id)

  const other = createLocalActor('Other')
  setCurrentLocalActor(other.id)
  createLocalActor('Third')

  assert.deepEqual(await getChangeEvents(tree.id), snapshot, 'the log is untouched by identity changes')
})

test('45. a cascade is attributed to one actor and remains one change set', async () => {
  forgetLocalIdentity()
  const actor = createLocalActor('Cascader')

  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  const partner = await newPerson(tree.id, 'Partner')
  await createParentLink({
    familyTreeId: tree.id, parentId: parent.id, childId: child.id, relationship: 'biological',
  })
  await createUnion({
    familyTreeId: tree.id, partnerAId: parent.id, partnerBId: partner.id, status: 'married',
  })
  const group = await createFamilyGroup({
    familyTreeId: tree.id, name: 'Founded', originPersonId: parent.id, establishedPrecision: 'unknown',
  })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: parent.id })

  const before = (await getChangeEvents(tree.id)).length
  await deletePerson(parent.id)
  const produced = (await getChangeEvents(tree.id)).slice(before)

  assert.equal(produced.length, 5, 'the 5A cascade shape is unchanged')
  assert.deepEqual([...new Set(produced.map((event) => event.actorId))], [actor.id], 'one person did one thing')
  assert.equal(new Set(produced.map((event) => event.changeSetId)).size, 1, 'still one change set')

  // Restoring is a separate action by whoever is current at the time.
  const restorer = createLocalActor('Restorer')
  await restorePerson(parent.id)
  const restoreEvent = (await getChangeEventsForEntity('person', parent.id)).at(-1) as ChangeEvent
  assert.equal(restoreEvent.op, 'restore')
  assert.equal(restoreEvent.actorId, restorer.id)
})

test('46. a rolled-back mutation leaves no attributed event and no outbox entry', async () => {
  forgetLocalIdentity()
  createLocalActor('Doomed Writer')

  const tree = await newTree()
  const otherTree = await newTree('Other')
  const foreignAnchor = await newPerson(otherTree.id, 'Foreign')

  const eventsBefore = await getChangeEvents(tree.id)
  const outboxBefore = await getOutboxSize(tree.id)

  await assert.rejects(() =>
    createPersonWithRelationship(
      { familyTreeId: tree.id, firstName: 'Never', lastName: 'Committed', gender: 'unknown' },
      foreignAnchor.id,
      { kind: 'parent', relationship: 'biological' },
    ),
  )

  const after = await getChangeEvents(tree.id)
  assert.deepEqual(after, eventsBefore, 'no event, attributed or otherwise, survived')
  assert.equal(await getOutboxSize(tree.id), outboxBefore)
})

test('47. two people sharing one device produce a history that tells them apart', async () => {
  forgetLocalIdentity()
  const habeeb = createLocalActor('Habeeb')

  const tree = await newTree()
  const person = await newPerson(tree.id, 'Grandmother')
  await updatePerson(person.id, { firstName: 'Grandma' })

  const ayesha = createLocalActor('Ayesha')
  await updatePerson(person.id, { lastName: 'Bello' })
  await updatePerson(person.id, { notes: 'Remembers the move in 1974.' })

  setCurrentLocalActor(habeeb.id)
  await updatePerson(person.id, { notes: 'Remembers the move in 1975.' })

  const history = await getChangeEventsForEntity('person', person.id)
  assert.deepEqual(
    history.map((event) => event.actorId),
    [habeeb.id, habeeb.id, ayesha.id, ayesha.id, habeeb.id],
  )

  // Which is enough to answer "who last corrected this?" from the log alone.
  const last = history.at(-1) as ChangeEvent
  const names = new Map(listLocalActors().map((candidate) => [candidate.id, candidate.displayName]))
  assert.equal(names.get(last.actorId as string), 'Habeeb')
  assert.ok(listLocalActors().length >= 2, 'both actors remain known to the device')
})

test('48. the actor roster rejects nonsense rather than corrupting attribution', async () => {
  forgetLocalIdentity()

  assert.throws(() => createLocalActor('   '), /display name/i, 'a blank name is not an identity')
  assert.throws(() => setCurrentLocalActor(crypto.randomUUID()), /Unknown local actor/)

  // Corrupt storage degrades to "no identity", never to a broken app.
  localStorage.setItem(LOCAL_IDENTITY_KEY, '{ not json')
  assert.equal(getCurrentLocalActor(), null)
  assert.deepEqual(listLocalActors(), [])

  // And a selection pointing at an actor that no longer exists is ignored.
  forgetLocalIdentity()
  const actor = createLocalActor('Real')
  localStorage.setItem(
    LOCAL_IDENTITY_KEY,
    JSON.stringify({ actors: [actor], currentActorId: crypto.randomUUID() }),
  )
  assert.equal(getCurrentLocalActor(), null, 'a dangling selection is not trusted')

  // The next edit adopts the known actor rather than inventing a second.
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Adopted')
  const [event] = await getChangeEventsForEntity('person', person.id)
  assert.equal((event as ChangeEvent).actorId, actor.id)
  assert.equal(listLocalActors().length, 1, 'no duplicate identity was created')
})

test('49. attribution is recorded for every logged entity, not just people', async () => {
  forgetLocalIdentity()
  const actor = createLocalActor('Everywhere')

  const tree = await newTree()
  const a = await newPerson(tree.id, 'A')
  const b = await newPerson(tree.id, 'B')
  await createParentLink({ familyTreeId: tree.id, parentId: a.id, childId: b.id, relationship: 'biological' })
  await createUnion({ familyTreeId: tree.id, partnerAId: a.id, partnerBId: b.id, status: 'married' })
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'G', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: a.id })
  await updateFamilyTree(tree.id, { name: 'Renamed Tree' })

  const events = await getChangeEvents(tree.id)
  assert.equal(new Set(events.map((event) => event.entity)).size, 6, 'every syncable entity is represented')
  for (const event of events) {
    assert.equal(event.actorId, actor.id, event.entity + ' must be attributed too')
  }
})
