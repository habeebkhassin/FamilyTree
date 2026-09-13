// Must be the very first import: registers global indexedDB before db.ts's
// `export const db = new FamilyTreeDatabase()` runs at module-load time.
import 'fake-indexeddb/auto'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Dexie from 'dexie'

import { db, FamilyTreeDatabase } from './db'
import { createFamilyTree } from './familyTrees'
import { createPerson, deletePerson } from './people'
import { createParentLink } from './relationships'
import {
  createFamilyTreeMember,
  getFamilyTreeMemberForActor,
  getFamilyTreeMembersByTree,
  suspendFamilyTreeMember,
  updateFamilyTreeMember,
} from './familyTreeMembers'
import {
  createPersonClaim,
  getPersonClaimForActor,
  getPersonClaimsByTree,
  rejectPersonClaim,
  updatePersonClaim,
} from './personClaims'
import { createInvitation, getInvitationsByTree, revokeInvitation } from './invitations'
import {
  ensureGovernanceConfig,
  getGovernance,
  getGovernanceConfig,
  updateGovernanceConfig,
} from './governance'
import { InvalidGovernanceError } from './governanceInternal'
import { can, roleOf } from '../policy/can'
import { invitationState } from '../policy/can'

async function newTree(name = 'Governed') {
  return createFamilyTree({ name: `${name} ${crypto.randomUUID()}` })
}

async function newPerson(familyTreeId: string, firstName = 'Test') {
  return createPerson({ familyTreeId, firstName, lastName: 'Person', gender: 'unknown' })
}

const FUTURE = '2099-01-01T00:00:00.000Z'

// ── Membership persistence ───────────────────────────────────────────

test('1. a membership round-trips and is readable by tree and by actor', async () => {
  const tree = await newTree()
  const member = await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'owner',
  })

  assert.equal(member.status, 'active')
  assert.ok(member.joinedAt, 'an active membership records when it began')
  assert.equal(member.subjectKind, 'localActor')

  assert.deepEqual(await getFamilyTreeMembersByTree(tree.id), [member])
  assert.deepEqual(await getFamilyTreeMemberForActor(tree.id, 'actor-a'), member)
  assert.equal(await getFamilyTreeMemberForActor(tree.id, 'nobody'), undefined)
})

test('2. one actor cannot hold two live memberships in the same tree', async () => {
  const tree = await newTree()
  await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'editor',
  })

  await assert.rejects(
    () => createFamilyTreeMember({
      familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'owner',
    }),
    InvalidGovernanceError,
  )
})

test('3. a member who left can rejoin — the old row does not block them forever', async () => {
  const tree = await newTree()
  const first = await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'editor',
  })
  await updateFamilyTreeMember(first.id, { status: 'left' })

  const second = await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'viewer',
  })
  assert.notEqual(second.id, first.id)
  assert.equal((await getFamilyTreeMemberForActor(tree.id, 'actor-a'))?.id, second.id, 'the live one wins')
  assert.equal((await getFamilyTreeMembersByTree(tree.id)).length, 2, 'the history is kept, not erased')
})

test('4. revoking access is a status change, never a deletion', async () => {
  const tree = await newTree()
  const member = await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'editor',
  })

  await suspendFamilyTreeMember(member.id)
  const rows = await getFamilyTreeMembersByTree(tree.id)
  assert.equal(rows.length, 1, 'the row is still there')
  assert.equal(rows[0]?.status, 'suspended')
  assert.equal('deletedAt' in (rows[0] as object), false, 'status is the vocabulary, not a tombstone')
})

test('5. a membership cannot attach to a family tree that does not exist', async () => {
  await assert.rejects(
    () => createFamilyTreeMember({
      familyTreeId: crypto.randomUUID(), actorId: 'a', subjectKind: 'localActor', role: 'owner',
    }),
    InvalidGovernanceError,
  )
})

// ── Person claims ────────────────────────────────────────────────────

test('6. a claim round-trips and is always self-asserted locally', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Amina')

  const claim = await createPersonClaim({
    familyTreeId: tree.id, personId: person.id, actorId: 'actor-a', subjectKind: 'localActor',
  })

  assert.equal(claim.status, 'selfAsserted', 'nothing on this device can verify identity')
  assert.deepEqual(await getPersonClaimForActor(tree.id, 'actor-a'), claim)
  assert.deepEqual(await getPersonClaimsByTree(tree.id), [claim])
})

test('7. a claim can never point at a person in another family tree', async () => {
  const tree = await newTree()
  const other = await newTree('Other')
  const stranger = await newPerson(other.id, 'Stranger')

  await assert.rejects(
    () => createPersonClaim({
      familyTreeId: tree.id, personId: stranger.id, actorId: 'actor-a', subjectKind: 'localActor',
    }),
    /own family tree/,
  )
})

test('8. a deleted person cannot be newly claimed', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Doomed')
  await deletePerson(person.id)

  await assert.rejects(
    () => createPersonClaim({
      familyTreeId: tree.id, personId: person.id, actorId: 'actor-a', subjectKind: 'localActor',
    }),
    /no longer exists/,
  )
})

test('9. one person cannot be claimed twice, and one actor cannot claim two people', async () => {
  const tree = await newTree()
  const amina = await newPerson(tree.id, 'Amina')
  const yusuf = await newPerson(tree.id, 'Yusuf')
  await createPersonClaim({
    familyTreeId: tree.id, personId: amina.id, actorId: 'actor-a', subjectKind: 'localActor',
  })

  await assert.rejects(
    () => createPersonClaim({
      familyTreeId: tree.id, personId: amina.id, actorId: 'actor-b', subjectKind: 'localActor',
    }),
    /already claimed that person/,
  )
  await assert.rejects(
    () => createPersonClaim({
      familyTreeId: tree.id, personId: yusuf.id, actorId: 'actor-a', subjectKind: 'localActor',
    }),
    /already claimed someone/,
  )
})

test('10. a rejected claim frees the person for someone else', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id, 'Amina')
  const claim = await createPersonClaim({
    familyTreeId: tree.id, personId: person.id, actorId: 'actor-a', subjectKind: 'localActor',
  })

  await rejectPersonClaim(claim.id)
  const replacement = await createPersonClaim({
    familyTreeId: tree.id, personId: person.id, actorId: 'actor-b', subjectKind: 'localActor',
  })

  assert.equal(replacement.status, 'selfAsserted')
  assert.equal((await getPersonClaimsByTree(tree.id)).length, 2, 'the rejection is still on record')
})

// ── Invitations ──────────────────────────────────────────────────────

test('11. an invitation persists as a pending record and can be revoked', async () => {
  const tree = await newTree()
  const invitation = await createInvitation({
    familyTreeId: tree.id, role: 'editor', email: 'aunt@example.com',
    invitedByActorId: 'actor-a', expiresAt: FUTURE,
  })

  assert.equal(invitation.status, 'pending')
  assert.equal(invitationState(invitation, '2026-01-01T00:00:00.000Z'), 'pending')

  await revokeInvitation(invitation.id)
  const [stored] = await getInvitationsByTree(tree.id)
  assert.equal(stored?.status, 'revoked')
  assert.equal(invitationState(stored!, '2026-01-01T00:00:00.000Z'), 'revoked')
})

test('12. an invitation naming a person validates that person like a claim would', async () => {
  const tree = await newTree()
  const other = await newTree('Other')
  const stranger = await newPerson(other.id, 'Stranger')

  await assert.rejects(
    () => createInvitation({
      familyTreeId: tree.id, role: 'viewer', personId: stranger.id,
      invitedByActorId: 'actor-a', expiresAt: FUTURE,
    }),
    /own family tree/,
  )

  const mine = await newPerson(tree.id, 'Aunt')
  const ok = await createInvitation({
    familyTreeId: tree.id, role: 'viewer', personId: mine.id,
    invitedByActorId: 'actor-a', expiresAt: FUTURE,
  })
  assert.equal(ok.personId, mine.id)
  assert.equal(ok.role, 'viewer', 'the person names who they are; the role is what they may do')
})

test('13. accepting an invitation locally grants nothing on its own', async () => {
  const tree = await newTree()
  const invitation = await createInvitation({
    familyTreeId: tree.id, role: 'owner', invitedByActorId: 'actor-a', expiresAt: FUTURE,
  })

  const { updateInvitationStatus } = await import('./invitations')
  await updateInvitationStatus(invitation.id, 'accepted')

  // No membership appeared. Redemption is a server's job.
  assert.deepEqual(await getFamilyTreeMembersByTree(tree.id), [])
  assert.equal(roleOf('anyone', await getGovernance(tree.id)), null)
})

// ── Governance configuration ─────────────────────────────────────────

test('14. governance settings are created once and are not what makes a tree governed', async () => {
  const tree = await newTree()

  const config = await ensureGovernanceConfig(tree.id, 'actor-a')
  assert.equal(config.defaultInviteRole, 'viewer')
  assert.equal(config.establishedByActorId, 'actor-a')

  const again = await ensureGovernanceConfig(tree.id, 'actor-b')
  assert.deepEqual(again, config, 'an existing row is left alone')

  // Crucially: settings exist, but with no members the tree is still open.
  const decision = can('anyone', 'person.delete', await getGovernance(tree.id))
  assert.equal(decision.reason, 'ungovernedTree')

  await updateGovernanceConfig(tree.id, { defaultInviteRole: 'editor' })
  assert.equal((await getGovernanceConfig(tree.id))?.defaultInviteRole, 'editor')
})

// ── Policy over persisted records ────────────────────────────────────

test('15. an existing tree with no governance rows stays fully editable', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)

  const governance = await getGovernance(tree.id)
  assert.deepEqual(governance.members, [])
  for (const action of ['person.update', 'person.delete', 'tree.delete'] as const) {
    assert.equal(can(null, action, governance, { personId: person.id }).allowed, true, action)
  }
})

test('16. persisted roles drive the policy engine end to end', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'owner-1', subjectKind: 'localActor', role: 'owner',
  })
  const viewer = await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'viewer-1', subjectKind: 'localActor', role: 'viewer',
  })

  let governance = await getGovernance(tree.id)
  assert.equal(can('owner-1', 'person.delete', governance, { personId: person.id }).allowed, true)
  assert.equal(can('viewer-1', 'person.update', governance, { personId: person.id }).reason, 'insufficientRole')
  assert.equal(can('stranger', 'tree.view', governance).reason, 'notAMember')

  // Promote, and the answer changes with no code path in between.
  await updateFamilyTreeMember(viewer.id, { role: 'editor' })
  governance = await getGovernance(tree.id)
  assert.equal(can('viewer-1', 'person.update', governance, { personId: person.id }).allowed, true)

  // Suspend, and they are distinguishable from a stranger.
  await suspendFamilyTreeMember(viewer.id)
  governance = await getGovernance(tree.id)
  assert.equal(can('viewer-1', 'person.update', governance, { personId: person.id }).reason, 'membershipNotActive')
})

test('17. a persisted self-claim grants self-edit and nothing more', async () => {
  const tree = await newTree()
  const me = await newPerson(tree.id, 'Me')
  const someoneElse = await newPerson(tree.id, 'Other')
  await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'owner-1', subjectKind: 'localActor', role: 'owner',
  })
  await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'viewer-1', subjectKind: 'localActor', role: 'viewer',
  })
  const claim = await createPersonClaim({
    familyTreeId: tree.id, personId: me.id, actorId: 'viewer-1', subjectKind: 'localActor',
  })

  let governance = await getGovernance(tree.id)
  assert.equal(can('viewer-1', 'person.update', governance, { personId: me.id }).reason, 'ownClaimedPerson')
  assert.equal(can('viewer-1', 'person.delete', governance, { personId: me.id }).reason, 'insufficientRole')
  assert.equal(can('viewer-1', 'person.update', governance, { personId: someoneElse.id }).allowed, false)
  assert.equal(can('viewer-1', 'member.invite', governance).allowed, false, 'a claim is not a promotion')

  await updatePersonClaim(claim.id, 'rejected')
  governance = await getGovernance(tree.id)
  assert.equal(can('viewer-1', 'person.update', governance, { personId: me.id }).allowed, false)
})

test('18. the account/claim/person chain a focal person will hang off already resolves', async () => {
  // Not the focal-person feature — just proof the model can carry it:
  // subject -> membership -> claim -> person, with nothing assuming one
  // account per tree or one tree per account.
  const paternal = await newTree('Paternal')
  const maternal = await newTree('Maternal')
  const meThere = await newPerson(paternal.id, 'Me')
  const meHere = await newPerson(maternal.id, 'Me')

  for (const [tree, person] of [[paternal, meThere], [maternal, meHere]] as const) {
    await createFamilyTreeMember({
      familyTreeId: tree.id, actorId: 'account-123', subjectKind: 'account', role: 'editor',
    })
    await createPersonClaim({
      familyTreeId: tree.id, personId: person.id, actorId: 'account-123', subjectKind: 'localActor',
    })
  }

  for (const [tree, person] of [[paternal, meThere], [maternal, meHere]] as const) {
    const claim = await getPersonClaimForActor(tree.id, 'account-123')
    assert.equal(claim?.personId, person.id, 'one subject, a different focal person per tree')
    assert.equal(roleOf('account-123', await getGovernance(tree.id)), 'editor')
  }

  // And the subject namespace is recorded rather than assumed.
  const member = await getFamilyTreeMemberForActor(paternal.id, 'account-123')
  assert.equal(member?.subjectKind, 'account')
})

// ── Governance stays out of the change log ───────────────────────────

test('19. no governance mutation writes a change event or queues an upload', async () => {
  const tree = await newTree()
  const person = await newPerson(tree.id)
  const eventsBefore = await db.changeEvents.where('familyTreeId').equals(tree.id).count()
  const outboxBefore = await db.outbox.where('familyTreeId').equals(tree.id).count()

  const member = await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'owner',
  })
  await updateFamilyTreeMember(member.id, { role: 'admin' })
  await suspendFamilyTreeMember(member.id)
  const claim = await createPersonClaim({
    familyTreeId: tree.id, personId: person.id, actorId: 'actor-a', subjectKind: 'localActor',
  })
  await rejectPersonClaim(claim.id)
  const invitation = await createInvitation({
    familyTreeId: tree.id, role: 'editor', invitedByActorId: 'actor-a', expiresAt: FUTURE,
  })
  await revokeInvitation(invitation.id)
  await ensureGovernanceConfig(tree.id, 'actor-a')
  await updateGovernanceConfig(tree.id, { defaultInviteRole: 'admin' })

  assert.equal(
    await db.changeEvents.where('familyTreeId').equals(tree.id).count(),
    eventsBefore,
    'permissions are not family facts and must never enter the content log',
  )
  assert.equal(await db.outbox.where('familyTreeId').equals(tree.id).count(), outboxBefore)
})

test('20. no governance entity is reachable through the sync entity list', async () => {
  const { getChangeEvents } = await import('../sync/changeLog')
  const tree = await newTree()
  await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'owner',
  })

  const entities = new Set((await getChangeEvents(tree.id)).map((event) => event.entity))
  for (const forbidden of ['familyTreeMember', 'personClaim', 'invitation', 'governance']) {
    assert.equal(entities.has(forbidden as never), false, `${forbidden} must not be a SyncEntity`)
  }
})

// ── Migration ────────────────────────────────────────────────────────

test('21. a real v1 database upgrades through every later version with each record intact', async () => {
  const dbName = `FamilyTreeDatabase-5b2-migration-${crypto.randomUUID()}`
  const treeId = crypto.randomUUID()
  const parentId = crypto.randomUUID()
  const childId = crypto.randomUUID()
  const linkId = crypto.randomUUID()
  const now = '2026-01-01T00:00:00.000Z'

  // A genuine version(1) database, with only the stores v1 ever had.
  const legacy = new Dexie(dbName)
  legacy.version(1).stores({
    familyTrees: 'id, updatedAt',
    people: 'id, familyTreeId',
    parentLinks: 'id, familyTreeId, parentId, childId',
    unions: 'id, familyTreeId, partnerAId, partnerBId',
    media: 'id, familyTreeId, kind, *personIds',
  })
  await legacy.open()
  await legacy.table('familyTrees').add({ id: treeId, name: 'Legacy', createdAt: now, updatedAt: now })
  await legacy.table('people').bulkAdd([
    { id: parentId, familyTreeId: treeId, firstName: 'Old', lastName: 'Parent', gender: 'unknown', createdAt: now, updatedAt: now },
    { id: childId, familyTreeId: treeId, firstName: 'Old', lastName: 'Child', gender: 'unknown', createdAt: now, updatedAt: now },
  ])
  await legacy.table('parentLinks').add({
    id: linkId, familyTreeId: treeId, parentId, childId, relationship: 'biological', createdAt: now, updatedAt: now,
  })
  legacy.close()

  // Reopen through the real application schema, which runs every
  // upgrade in turn.
  const upgraded = new FamilyTreeDatabase(dbName)
  await upgraded.open()
  assert.equal(upgraded.verno, 5, 'the database is now at version 5')

  const tree = await upgraded.familyTrees.get(treeId)
  assert.equal(tree?.name, 'Legacy', 'the pre-existing tree survived untouched')
  assert.equal(tree?.deletedAt, undefined, 'legacy records read as live')

  const people = await upgraded.people.where('familyTreeId').equals(treeId).toArray()
  assert.equal(people.length, 2)
  const link = await upgraded.parentLinks.get(linkId)
  assert.equal(link?.relationship, 'biological', 'the relationship is intact')

  // The v4 stores exist and are empty, which is what makes the tree
  // ungoverned — exactly the state it was in before governance existed.
  assert.equal(await upgraded.familyTreeMembers.where('familyTreeId').equals(treeId).count(), 0)
  assert.equal(await upgraded.personClaims.count(), 0)

  /*
    Version 5 added sync. A record that predates it has no watermark and
    no rejection, and both absences read correctly — "this device knew
    nothing" and "still pending" — which is why no row had to be
    rewritten to introduce them.
  */
  assert.equal(await upgraded.changeEvents.count(), 0, 'a legacy database has no history to carry')
  assert.equal(await upgraded.outbox.count(), 0)
  assert.equal(
    await upgraded.syncState.get(treeId),
    undefined,
    'and no sync position was invented for a tree that has never synced',
  )
  assert.equal(await upgraded.invitations.count(), 0)
  assert.equal(await upgraded.governance.count(), 0)

  const governance = {
    familyTreeId: treeId,
    members: await upgraded.familyTreeMembers.where('familyTreeId').equals(treeId).toArray(),
    claims: await upgraded.personClaims.where('familyTreeId').equals(treeId).toArray(),
  }
  assert.equal(can(null, 'person.delete', governance).reason, 'ungovernedTree', 'a legacy tree stays editable')

  upgraded.close()
})

test('22. governance rows survive alongside genealogy in the live database', async () => {
  const tree = await newTree()
  const parent = await newPerson(tree.id, 'Parent')
  const child = await newPerson(tree.id, 'Child')
  await createParentLink({
    familyTreeId: tree.id, parentId: parent.id, childId: child.id, relationship: 'biological',
  })
  await createFamilyTreeMember({
    familyTreeId: tree.id, actorId: 'actor-a', subjectKind: 'localActor', role: 'owner',
  })
  await createPersonClaim({
    familyTreeId: tree.id, personId: parent.id, actorId: 'actor-a', subjectKind: 'localActor',
  })

  // The genealogy is unaffected by governance existing.
  const { getPeopleByTree, getParentLinksByTree } = await import('./people').then(async (people) => ({
    getPeopleByTree: people.getPeopleByTree,
    getParentLinksByTree: (await import('./relationships')).getParentLinksByTree,
  }))
  assert.equal((await getPeopleByTree(tree.id)).length, 2)
  assert.equal((await getParentLinksByTree(tree.id)).length, 1)

  const governance = await getGovernance(tree.id)
  assert.equal(governance.members.length, 1)
  assert.equal(governance.claims.length, 1)
})
