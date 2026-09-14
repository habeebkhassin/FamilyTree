import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FamilyGroup, FamilyGroupMember, Union } from '../../types'
import {
  connectionsFromGroup,
  familyGroupMemberIds,
  familyGroupSize,
  findFamilyConnections,
  pickHomeFamilyGroup,
} from './familyConnections'

/**
 * Marriages that join two families.
 *
 * The point of every test here is the same: a connection is DERIVED. No
 * record is created, nobody is copied into anybody else's family, and no
 * parent link is invented to make a picture work. Take the marriage away
 * or take the membership away and the connection is simply not there any
 * more, because there was never anything else holding it up.
 */

const TREE = 'tree-1'
const AT = '2026-01-01T00:00:00.000Z'

const group = (id: string, name: string): FamilyGroup => ({
  id,
  familyTreeId: TREE,
  name,
  establishedPrecision: 'unknown',
  createdAt: AT,
  updatedAt: AT,
})

const member = (id: string, familyGroupId: string, personId: string): FamilyGroupMember => ({
  id,
  familyTreeId: TREE,
  familyGroupId,
  personId,
  createdAt: AT,
  updatedAt: AT,
})

const union = (id: string, a: string, b: string, startDate?: string): Union => ({
  id,
  familyTreeId: TREE,
  partnerAId: a,
  partnerBId: b,
  status: 'married',
  ...(startDate ? { startDate } : {}),
  createdAt: AT,
  updatedAt: AT,
})

const MY = group('g-my', 'My Family')
const HERS = group('g-hers', "Sameera's Family")

// ── the rule ────────────────────────────────────────────────────────

test('a marriage inside one family connects nothing', () => {
  /*
    Families marry within themselves. Treating that as a bridge would draw
    a family to itself and offer to "open" the tree already on screen.
  */
  const connections = findFamilyConnections({
    unions: [union('u1', 'hassan', 'cousin')],
    familyGroups: [MY],
    familyGroupMembers: [
      member('m1', MY.id, 'hassan'),
      member('m2', MY.id, 'cousin'),
    ],
  })
  assert.deepEqual(connections, [])
})

test('a marriage across two families connects them', () => {
  const connections = findFamilyConnections({
    unions: [union('u1', 'hassan', 'sameera', '1992-03-08')],
    familyGroups: [MY, HERS],
    familyGroupMembers: [
      member('m1', MY.id, 'hassan'),
      member('m2', HERS.id, 'sameera'),
    ],
  })

  // Once from each side: each family sees the bridge from where it stands.
  assert.equal(connections.length, 2)

  const fromMine = connectionsFromGroup(connections, MY.id)
  assert.equal(fromMine.length, 1)
  assert.deepEqual(fromMine[0], {
    unionId: 'u1',
    status: 'married',
    startDate: '1992-03-08',
    nearPersonId: 'hassan',
    nearGroupId: MY.id,
    farPersonId: 'sameera',
    farGroupId: HERS.id,
  })
})

test('the connection names both families, each from its own side', () => {
  const connections = findFamilyConnections({
    unions: [union('u1', 'hassan', 'sameera')],
    familyGroups: [MY, HERS],
    familyGroupMembers: [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')],
  })

  const mine = connectionsFromGroup(connections, MY.id)[0]
  const theirs = connectionsFromGroup(connections, HERS.id)[0]
  assert.ok(mine && theirs)
  assert.equal(mine.farGroupId, HERS.id)
  assert.equal(theirs.farGroupId, MY.id)
  assert.equal(mine.unionId, theirs.unionId, 'one marriage, read from two ends')
})

test('a partner who belongs to no family is not a second family', () => {
  // Otherwise half the tree sprouts "connected family" chips the moment
  // somebody starts filing people into groups.
  const connections = findFamilyConnections({
    unions: [union('u1', 'hassan', 'unfiled')],
    familyGroups: [MY],
    familyGroupMembers: [member('m1', MY.id, 'hassan')],
  })
  assert.deepEqual(connections, [])
})

test('sharing any family at all means one family, not two', () => {
  // Both are in My Family; she is also in hers. They have not married
  // across anything.
  const connections = findFamilyConnections({
    unions: [union('u1', 'hassan', 'sameera')],
    familyGroups: [MY, HERS],
    familyGroupMembers: [
      member('m1', MY.id, 'hassan'),
      member('m2', MY.id, 'sameera'),
      member('m3', HERS.id, 'sameera'),
    ],
  })
  assert.deepEqual(connections, [])
})

test('a deleted marriage connects nothing, and neither does a deleted family', () => {
  const both = [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')]

  assert.deepEqual(
    findFamilyConnections({
      unions: [{ ...union('u1', 'hassan', 'sameera'), deletedAt: AT }],
      familyGroups: [MY, HERS],
      familyGroupMembers: both,
    }),
    [],
  )

  assert.deepEqual(
    findFamilyConnections({
      unions: [union('u1', 'hassan', 'sameera')],
      familyGroups: [MY, { ...HERS, deletedAt: AT }],
      familyGroupMembers: both,
    }),
    [],
  )
})

test('removing the membership removes the connection and nothing else', () => {
  /*
    What "Remove family connection" does. The marriage is untouched, both
    families still exist, and both people still exist — the two families
    simply stop reading as connected, because the only thing that made
    them read that way was the membership.
  */
  const unions = [union('u1', 'hassan', 'sameera')]
  const familyGroups = [MY, HERS]
  const before = [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')]
  assert.equal(findFamilyConnections({ unions, familyGroups, familyGroupMembers: before }).length, 2)

  const after = before.map((m) => (m.id === 'm2' ? { ...m, deletedAt: AT } : m))
  assert.deepEqual(findFamilyConnections({ unions, familyGroups, familyGroupMembers: after }), [])

  assert.equal(unions.length, 1, 'the marriage is still a marriage')
  assert.equal(familyGroups.length, 2, 'both families still exist')
  assert.equal(after.length, 2, 'no membership record was destroyed, only tombstoned')
})

// ── counting and membership ─────────────────────────────────────────

test('a family reports the size the screens show', () => {
  const members = [
    member('m1', HERS.id, 'sameera'),
    member('m2', HERS.id, 'salman'),
    member('m3', HERS.id, 'rukiya'),
    { ...member('m4', HERS.id, 'gone'), deletedAt: AT },
    member('m5', MY.id, 'hassan'),
  ]
  assert.equal(familyGroupSize(members, HERS.id), 3)
  assert.deepEqual([...familyGroupMemberIds(members, HERS.id)].sort(), [
    'rukiya',
    'salman',
    'sameera',
  ])
})

test('the same person counted once however many times they are filed', () => {
  const members = [member('m1', HERS.id, 'sameera'), member('m2', HERS.id, 'sameera')]
  assert.equal(familyGroupSize(members, HERS.id), 1)
})

// ── whose tree is this ──────────────────────────────────────────────

test('home is the family of whoever this device says it is', () => {
  const members = [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')]
  assert.equal(pickHomeFamilyGroup(members, { claimedPersonId: 'hassan' }), MY.id)
  assert.equal(pickHomeFamilyGroup(members, { claimedPersonId: 'sameera' }), HERS.id)
})

test('failing that, the family of whoever is focused', () => {
  const members = [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')]
  assert.equal(
    pickHomeFamilyGroup(members, { claimedPersonId: null, focalPersonId: 'sameera' }),
    HERS.id,
  )
})

test('failing that, the largest family, and never a different answer twice', () => {
  const members = [
    member('m1', MY.id, 'a'),
    member('m2', MY.id, 'b'),
    member('m3', HERS.id, 'c'),
  ]
  assert.equal(pickHomeFamilyGroup(members, {}), MY.id)
  assert.equal(pickHomeFamilyGroup(members, {}), MY.id, 'stable between renders')
  assert.equal(pickHomeFamilyGroup([], {}), null)
})

test('one marriage joining two families produces one chip, not two', () => {
  // Both directions exist, but a tree anchored on one family shows the
  // bridge once — pointing outwards.
  const connections = findFamilyConnections({
    unions: [union('u1', 'hassan', 'sameera')],
    familyGroups: [MY, HERS],
    familyGroupMembers: [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')],
  })
  const home = pickHomeFamilyGroup(
    [member('m1', MY.id, 'hassan'), member('m2', HERS.id, 'sameera')],
    { claimedPersonId: 'hassan' },
  )
  assert.ok(home)
  const shown = connections.filter((connection) => connection.nearGroupId === home)
  assert.equal(shown.length, 1)
  assert.equal(shown[0]?.farGroupId, HERS.id)
})
