// Must be the very first import: registers global indexedDB/IDBKeyRange
// before db.ts's `export const db = new FamilyTreeDatabase()` runs at
// module-load time, so Dexie has a real (if in-memory) IndexedDB to open.
// This is what lets these tests exercise the actual storage-layer code —
// including real Dexie transactions, real unique-index enforcement, and a
// real version(1)->version(2) upgrade — rather than a hand-rolled mock.
import 'fake-indexeddb/auto'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import type { Table } from 'dexie'

import { FamilyTreeDatabase } from './db'
import { createFamilyTree } from './familyTrees'
import { createPerson, getPerson } from './people'
import { deletePerson } from './people'
import {
  addFamilyGroupMember,
  createFamilyGroup,
  deleteFamilyGroup,
  DuplicateFamilyGroupMemberError,
  getFamilyGroup,
  getFamilyGroupMembers,
  getFamilyGroupMembersByTree,
  getFamilyGroupsByTree,
  InvalidFamilyGroupError,
  removeFamilyGroupMember,
  updateFamilyGroup,
} from './familyGroups'

async function createTestTree() {
  return createFamilyTree({ name: `Test Tree ${crypto.randomUUID()}` })
}

async function createTestPerson(familyTreeId: string, firstName = 'Test') {
  return createPerson({ familyTreeId, firstName, lastName: 'Person', gender: 'unknown' })
}

test('createFamilyGroup creates a group scoped to its family tree', async () => {
  const tree = await createTestTree()
  const group = await createFamilyGroup({
    familyTreeId: tree.id,
    name: "Mother's Family",
    establishedPrecision: 'unknown',
  })

  assert.equal(group.name, "Mother's Family")
  assert.equal(group.familyTreeId, tree.id)
  assert.ok(group.id)
  assert.equal(group.createdAt, group.updatedAt)

  const fetched = await getFamilyGroup(group.id)
  assert.deepEqual(fetched, group)

  const byTree = await getFamilyGroupsByTree(tree.id)
  assert.equal(byTree.length, 1)
  assert.equal(byTree[0]?.id, group.id)
})

test('updateFamilyGroup updates fields and bumps updatedAt', async () => {
  const tree = await createTestTree()
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Old Name', establishedPrecision: 'unknown' })

  await updateFamilyGroup(group.id, {
    name: 'New Name',
    establishedPrecision: 'approximate',
    establishedLabel: '1940s',
  })

  const updated = await getFamilyGroup(group.id)
  assert.equal(updated?.name, 'New Name')
  assert.equal(updated?.establishedPrecision, 'approximate')
  assert.equal(updated?.establishedLabel, '1940s')
  assert.notEqual(updated?.updatedAt, group.updatedAt)
  // familyTreeId/id/createdAt are not part of UpdateFamilyGroupInput and must be unaffected.
  assert.equal(updated?.familyTreeId, tree.id)
  assert.equal(updated?.createdAt, group.createdAt)
})

test('deleteFamilyGroup removes the group', async () => {
  const tree = await createTestTree()
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Temp', establishedPrecision: 'unknown' })

  await deleteFamilyGroup(group.id)

  assert.equal(await getFamilyGroup(group.id), undefined)
})

test('deleteFamilyGroup removes membership rows but never the people who were members', async () => {
  const tree = await createTestTree()
  const person = await createTestPerson(tree.id)
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Group', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id })

  await deleteFamilyGroup(group.id)

  const stillExists = await getPerson(person.id)
  assert.ok(stillExists, 'the person must still exist after their group is deleted')
  assert.equal(stillExists?.id, person.id)
  assert.equal((await getFamilyGroupMembers(group.id)).length, 0)
})

test('addFamilyGroupMember adds a person to a group', async () => {
  const tree = await createTestTree()
  const person = await createTestPerson(tree.id)
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Group', establishedPrecision: 'unknown' })

  const member = await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id })

  assert.equal(member.personId, person.id)
  assert.equal(member.familyGroupId, group.id)

  const members = await getFamilyGroupMembers(group.id)
  assert.equal(members.length, 1)
  assert.equal(members[0]?.personId, person.id)
})

test('getFamilyGroupMembersByTree returns membership rows across every group in the tree, scoped to that tree', async () => {
  const treeA = await createTestTree()
  const treeB = await createTestTree()
  const personA1 = await createTestPerson(treeA.id, 'A1')
  const personA2 = await createTestPerson(treeA.id, 'A2')
  const personB1 = await createTestPerson(treeB.id, 'B1')
  const groupA1 = await createFamilyGroup({ familyTreeId: treeA.id, name: 'A Group 1', establishedPrecision: 'unknown' })
  const groupA2 = await createFamilyGroup({ familyTreeId: treeA.id, name: 'A Group 2', establishedPrecision: 'unknown' })
  const groupB = await createFamilyGroup({ familyTreeId: treeB.id, name: 'B Group', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: treeA.id, familyGroupId: groupA1.id, personId: personA1.id })
  await addFamilyGroupMember({ familyTreeId: treeA.id, familyGroupId: groupA2.id, personId: personA2.id })
  await addFamilyGroupMember({ familyTreeId: treeB.id, familyGroupId: groupB.id, personId: personB1.id })

  const membersInA = await getFamilyGroupMembersByTree(treeA.id)

  assert.equal(membersInA.length, 2)
  assert.deepEqual(
    new Set(membersInA.map((m) => m.personId)),
    new Set([personA1.id, personA2.id]),
  )
})

test('removeFamilyGroupMember removes only the membership row', async () => {
  const tree = await createTestTree()
  const person = await createTestPerson(tree.id)
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Group', establishedPrecision: 'unknown' })
  const member = await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id })

  await removeFamilyGroupMember(member.id)

  assert.equal((await getFamilyGroupMembers(group.id)).length, 0)
  assert.ok(await getPerson(person.id), 'removing a membership must never delete the person')
})

test('addFamilyGroupMember rejects a duplicate (familyGroupId, personId) pair', async () => {
  const tree = await createTestTree()
  const person = await createTestPerson(tree.id)
  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'Group', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id })

  await assert.rejects(
    () => addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: person.id }),
    DuplicateFamilyGroupMemberError,
  )

  assert.equal((await getFamilyGroupMembers(group.id)).length, 1, 'the duplicate attempt must not create a second row')
})

test('addFamilyGroupMember rejects a person from a different family tree than the membership input', async () => {
  const treeA = await createTestTree()
  const treeB = await createTestTree()
  const personInB = await createTestPerson(treeB.id)
  const groupInA = await createFamilyGroup({ familyTreeId: treeA.id, name: 'Group A', establishedPrecision: 'unknown' })

  await assert.rejects(() =>
    addFamilyGroupMember({ familyTreeId: treeA.id, familyGroupId: groupInA.id, personId: personInB.id }),
  )
})

test('addFamilyGroupMember rejects a group from a different family tree than the membership input', async () => {
  const treeA = await createTestTree()
  const treeB = await createTestTree()
  const personInB = await createTestPerson(treeB.id)
  const groupInA = await createFamilyGroup({ familyTreeId: treeA.id, name: 'Group A', establishedPrecision: 'unknown' })

  await assert.rejects(
    () => addFamilyGroupMember({ familyTreeId: treeB.id, familyGroupId: groupInA.id, personId: personInB.id }),
    InvalidFamilyGroupError,
  )
})

test('createFamilyGroup accepts a valid originPersonId from the same family tree', async () => {
  const tree = await createTestTree()
  const founder = await createTestPerson(tree.id, 'Founder')

  const group = await createFamilyGroup({
    familyTreeId: tree.id,
    name: 'Khassin Family',
    originPersonId: founder.id,
    establishedPrecision: 'approximate',
    establishedLabel: '~1948',
  })

  assert.equal(group.originPersonId, founder.id)
})

test('createFamilyGroup rejects an originPersonId from a different family tree', async () => {
  const treeA = await createTestTree()
  const treeB = await createTestTree()
  const personInB = await createTestPerson(treeB.id)

  await assert.rejects(() =>
    createFamilyGroup({
      familyTreeId: treeA.id,
      name: 'Group A',
      originPersonId: personInB.id,
      establishedPrecision: 'unknown',
    }),
  )
})

test('updateFamilyGroup rejects an originPersonId from a different family tree', async () => {
  const treeA = await createTestTree()
  const treeB = await createTestTree()
  const personInB = await createTestPerson(treeB.id)
  const group = await createFamilyGroup({ familyTreeId: treeA.id, name: 'Group A', establishedPrecision: 'unknown' })

  await assert.rejects(() => updateFamilyGroup(group.id, { originPersonId: personInB.id }))

  const unchanged = await getFamilyGroup(group.id)
  assert.equal(unchanged?.originPersonId, undefined)
})

test('deleting the origin person clears FamilyGroup.originPersonId but keeps the group and its other members', async () => {
  const tree = await createTestTree()
  const founder = await createTestPerson(tree.id, 'Founder')
  const otherMember = await createTestPerson(tree.id, 'Other')
  const group = await createFamilyGroup({
    familyTreeId: tree.id,
    name: 'Group',
    originPersonId: founder.id,
    establishedPrecision: 'unknown',
  })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: founder.id })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: otherMember.id })

  await deletePerson(founder.id)

  const updated = await getFamilyGroup(group.id)
  assert.ok(updated, 'the group itself must survive its founder being deleted')
  assert.equal(updated?.originPersonId, undefined)

  const members = await getFamilyGroupMembers(group.id)
  assert.equal(members.length, 1, "the founder's own membership row is gone, but the other member remains")
  assert.equal(members[0]?.personId, otherMember.id)
})

interface LegacyFamilyTree {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface LegacyPerson {
  id: string
  familyTreeId: string
  firstName: string
  lastName: string
  gender: string
  createdAt: string
  updatedAt: string
}

/** A byte-for-byte replica of db.ts's version(1) schema, used only to seed a database that predates FamilyGroup. */
class LegacyV1Database extends Dexie {
  familyTrees!: Table<LegacyFamilyTree, string>
  people!: Table<LegacyPerson, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      familyTrees: 'id, updatedAt',
      people: 'id, familyTreeId',
      parentLinks: 'id, familyTreeId, parentId, childId',
      unions: 'id, familyTreeId, partnerAId, partnerBId',
      media: 'id, familyTreeId, kind, *personIds',
    })
  }
}

test('existing v1 data remains usable after the v2 migration, and the new tables work', async () => {
  const dbName = `FamilyTreeDatabase-migration-test-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const legacyTreeId = crypto.randomUUID()
  const legacyPersonId = crypto.randomUUID()

  // Simulate a real pre-existing user: a database that only ever saw the
  // version(1) schema, with real data already in it.
  const legacyDb = new LegacyV1Database(dbName)
  await legacyDb.open()
  await legacyDb.familyTrees.add({ id: legacyTreeId, name: 'Legacy Tree', createdAt: now, updatedAt: now })
  await legacyDb.people.add({
    id: legacyPersonId,
    familyTreeId: legacyTreeId,
    firstName: 'Legacy',
    lastName: 'Person',
    gender: 'unknown',
    createdAt: now,
    updatedAt: now,
  })
  legacyDb.close()

  // Reopen the SAME underlying database, this time under the app's real,
  // current schema (version(1) then version(2)) -- exercising Dexie's
  // actual upgrade path, not a simulation of it.
  const upgradedDb = new FamilyTreeDatabase(dbName)
  await upgradedDb.open()

  try {
    const survivedTree = await upgradedDb.familyTrees.get(legacyTreeId)
    const survivedPerson = await upgradedDb.people.get(legacyPersonId)
    assert.equal(survivedTree?.name, 'Legacy Tree', 'pre-existing FamilyTree data must survive the migration untouched')
    assert.equal(survivedPerson?.firstName, 'Legacy', 'pre-existing Person data must survive the migration untouched')

    // The new tables exist and are fully usable on the upgraded database.
    const groupId = crypto.randomUUID()
    await upgradedDb.familyGroups.add({
      id: groupId,
      familyTreeId: legacyTreeId,
      name: 'New Group',
      establishedPrecision: 'unknown',
      createdAt: now,
      updatedAt: now,
    })
    const group = await upgradedDb.familyGroups.get(groupId)
    assert.equal(group?.name, 'New Group')

    const memberId = crypto.randomUUID()
    await upgradedDb.familyGroupMembers.add({
      id: memberId,
      familyTreeId: legacyTreeId,
      familyGroupId: groupId,
      personId: legacyPersonId,
      createdAt: now,
      updatedAt: now,
    })
    const members = await upgradedDb.familyGroupMembers.where('familyGroupId').equals(groupId).toArray()
    assert.equal(members.length, 1)
    assert.equal(members[0]?.personId, legacyPersonId)
  } finally {
    upgradedDb.close()
    await Dexie.delete(dbName)
  }
})
