// Pure, like the reconciler: no fake-indexeddb, no browser environment.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { can, claimsOf, invitationState, roleOf } from './can'
import type { PolicyAction } from './can'
import type {
  FamilyRole,
  FamilyTreeMember,
  Governance,
  Invitation,
  MembershipStatus,
  PersonClaim,
  PersonClaimStatus,
} from './membershipTypes'

const TREE = 'tree-1'
const AT = '2026-06-01T00:00:00.000Z'

let counter = 0
const uid = (prefix: string) => `${prefix}-${++counter}`

function member(
  actorId: string,
  role: FamilyRole,
  status: MembershipStatus = 'active',
  overrides: Partial<FamilyTreeMember> = {},
): FamilyTreeMember {
  return {
    id: uid('member'),
    familyTreeId: TREE,
    actorId,
    subjectKind: 'localActor',
    role,
    status,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

function claim(
  actorId: string,
  personId: string,
  status: PersonClaimStatus = 'verified',
): PersonClaim {
  return {
    id: uid('claim'),
    familyTreeId: TREE,
    personId,
    actorId,
    subjectKind: 'localActor',
    status,
    createdAt: AT,
    updatedAt: AT,
  }
}

function governance(members: FamilyTreeMember[], claims: PersonClaim[] = []): Governance {
  return { familyTreeId: TREE, members, claims }
}

const CONTENT_ACTIONS: PolicyAction[] = [
  'person.create',
  'person.update',
  'person.delete',
  'relationship.create',
  'relationship.delete',
  'familyGroup.create',
  'familyGroup.update',
  'familyGroup.delete',
]

const ALL_ACTIONS: PolicyAction[] = [
  'tree.view',
  ...CONTENT_ACTIONS,
  'tree.rename',
  'member.invite',
  'member.changeRole',
  'member.remove',
  'claim.verify',
  'tree.delete',
  'tree.transferOwnership',
]

// ── Ungoverned trees: the compatibility guarantee ────────────────────

test('1. a tree with no members grants everything — every existing tree is like this', () => {
  const open = governance([])

  for (const action of ALL_ACTIONS) {
    const decision = can('actor-a', action, open, { memberId: 'x', role: 'editor' })
    assert.equal(decision.allowed, true, `${action} must stay available on a local tree`)
    assert.equal(decision.reason, 'ungovernedTree')
  }
})

test('2. an ungoverned tree grants everything even with no local identity at all', () => {
  const decision = can(null, 'person.delete', governance([]))
  assert.equal(decision.allowed, true)
  assert.equal(decision.reason, 'ungovernedTree')
})

test('3. members of a DIFFERENT tree do not make this tree governed', () => {
  const elsewhere = member('actor-a', 'owner', 'active', { familyTreeId: 'other-tree' })
  const decision = can(null, 'person.create', governance([elsewhere]))
  assert.equal(decision.reason, 'ungovernedTree', 'governance is per tree, never global')
})

// ── Roles ────────────────────────────────────────────────────────────

test('4. a viewer may read and nothing else', () => {
  const g = governance([member('viewer-1', 'viewer')])

  assert.equal(can('viewer-1', 'tree.view', g).allowed, true)
  for (const action of CONTENT_ACTIONS) {
    const decision = can('viewer-1', action, g, { personId: 'p1' })
    assert.equal(decision.allowed, false, `${action} must be denied`)
    assert.equal(decision.reason, 'insufficientRole')
  }
})

test('5. an editor may change the archive but not who may change it', () => {
  const g = governance([member('editor-1', 'editor')])

  for (const action of CONTENT_ACTIONS) {
    assert.equal(can('editor-1', action, g, { personId: 'p1' }).allowed, true, action)
  }
  for (const action of ['tree.rename', 'member.invite', 'claim.verify', 'tree.delete'] as PolicyAction[]) {
    assert.equal(can('editor-1', action, g).allowed, false, action)
  }
})

test('6. an admin governs members but cannot delete or hand over the tree', () => {
  const g = governance([member('admin-1', 'admin')])

  assert.equal(can('admin-1', 'member.invite', g).allowed, true)
  assert.equal(can('admin-1', 'claim.verify', g).allowed, true)
  assert.equal(can('admin-1', 'tree.rename', g).allowed, true)
  assert.equal(can('admin-1', 'tree.delete', g).reason, 'insufficientRole')
  assert.equal(can('admin-1', 'tree.transferOwnership', g).reason, 'insufficientRole')
})

test('7. an owner may do everything', () => {
  const owner = member('owner-1', 'owner')
  const other = member('editor-1', 'editor')
  const g = governance([owner, other])

  for (const action of ALL_ACTIONS) {
    const decision = can('owner-1', action, g, { memberId: other.id, role: 'admin' })
    assert.equal(decision.allowed, true, `${action} must be allowed for the owner`)
  }
})

test('8. roleOf reports the effective role, and the highest when several exist', () => {
  const g = governance([member('a', 'viewer'), member('a', 'admin'), member('b', 'editor')])
  assert.equal(roleOf('a', g), 'admin', 'deterministically the highest')
  assert.equal(roleOf('b', g), 'editor')
  assert.equal(roleOf('nobody', g), null)
  assert.equal(roleOf(null, g), null)
})

// ── Non-members and inactive memberships ─────────────────────────────

test('9. a stranger to a governed tree is denied, and told they are a stranger', () => {
  const g = governance([member('owner-1', 'owner')])
  const decision = can('outsider', 'tree.view', g)
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'notAMember')
})

test('10. an inactive membership is distinguished from never having had one', () => {
  for (const status of ['invited', 'suspended', 'left'] as MembershipStatus[]) {
    const g = governance([member('owner-1', 'owner'), member('actor-x', 'editor', status)])
    const decision = can('actor-x', 'person.update', g, { personId: 'p1' })
    assert.equal(decision.allowed, false, status)
    assert.equal(decision.reason, 'membershipNotActive', `${status} must read as inactive, not absent`)
  }
})

test('11. no local identity in a governed tree grants nothing', () => {
  const g = governance([member('owner-1', 'owner')])
  assert.deepEqual(can(null, 'tree.view', g), { allowed: false, reason: 'notAMember' })
})

// ── Self-edit through a claim ────────────────────────────────────────

test('12. a viewer may correct their own claimed record', () => {
  const g = governance([member('viewer-1', 'viewer')], [claim('viewer-1', 'p1')])

  const decision = can('viewer-1', 'person.update', g, { personId: 'p1' })
  assert.equal(decision.allowed, true)
  assert.equal(decision.reason, 'ownClaimedPerson')
})

test('13. self-edit does not extend to deleting yourself out of the family history', () => {
  const g = governance([member('viewer-1', 'viewer')], [claim('viewer-1', 'p1')])

  assert.equal(can('viewer-1', 'person.delete', g, { personId: 'p1' }).reason, 'insufficientRole')
  assert.equal(can('viewer-1', 'relationship.delete', g, { personId: 'p1' }).reason, 'insufficientRole')
})

test('14. a claim grants nothing on anyone else', () => {
  const g = governance([member('viewer-1', 'viewer')], [claim('viewer-1', 'p1')])
  assert.equal(can('viewer-1', 'person.update', g, { personId: 'p2' }).reason, 'insufficientRole')
})

test('15. a rejected claim grants nothing, a self-asserted one still does locally', () => {
  const rejected = governance([member('v', 'viewer')], [claim('v', 'p1', 'rejected')])
  assert.equal(can('v', 'person.update', rejected, { personId: 'p1' }).allowed, false)

  const asserted = governance([member('v', 'viewer')], [claim('v', 'p1', 'selfAsserted')])
  assert.equal(can('v', 'person.update', asserted, { personId: 'p1' }).allowed, true)
})

test('16. claims belonging to another tree or another actor are ignored', () => {
  const foreign: PersonClaim = { ...claim('viewer-1', 'p1'), familyTreeId: 'other-tree' }
  const someoneElse = claim('viewer-2', 'p1')
  const g = governance([member('viewer-1', 'viewer')], [foreign, someoneElse])

  assert.equal(can('viewer-1', 'person.update', g, { personId: 'p1' }).allowed, false)
})

test('17. an editor updating their own record is granted by role, not by the claim', () => {
  const g = governance([member('editor-1', 'editor')], [claim('editor-1', 'p1')])
  assert.equal(can('editor-1', 'person.update', g, { personId: 'p1' }).reason, 'role')
})

test('18. claimsOf lists what an actor claims, excluding rejections', () => {
  const g = governance(
    [member('a', 'viewer')],
    [claim('a', 'p1'), claim('a', 'p2', 'rejected'), claim('b', 'p3')],
  )
  assert.deepEqual(claimsOf('a', g).map((entry) => entry.personId), ['p1'])
  assert.deepEqual(claimsOf(null, g), [])
})

// ── Rank rules ───────────────────────────────────────────────────────

test('19. an admin may not act on another admin, but may act on an editor', () => {
  const admin = member('admin-1', 'admin')
  const peer = member('admin-2', 'admin')
  const editor = member('editor-1', 'editor')
  const g = governance([admin, peer, editor])

  assert.equal(
    can('admin-1', 'member.remove', g, { memberId: peer.id }).reason,
    'cannotActOnEqualOrHigherRank',
  )
  assert.equal(can('admin-1', 'member.remove', g, { memberId: editor.id }).allowed, true)
})

test('20. the owner is protected from removal and demotion alike', () => {
  const owner = member('owner-1', 'owner')
  const admin = member('admin-1', 'admin')
  const g = governance([owner, admin])

  assert.equal(can('admin-1', 'member.remove', g, { memberId: owner.id }).reason, 'ownerIsProtected')
  assert.equal(
    can('admin-1', 'member.changeRole', g, { memberId: owner.id, role: 'viewer' }).reason,
    'ownerIsProtected',
  )
  // Even the owner themselves: handing over is a transfer, not a role edit.
  assert.equal(can('owner-1', 'member.remove', g, { memberId: owner.id }).reason, 'ownerIsProtected')
})

test('21. nobody may promote anyone above their own rank', () => {
  const admin = member('admin-1', 'admin')
  const editor = member('editor-1', 'editor')
  const g = governance([member('owner-1', 'owner'), admin, editor])

  assert.equal(
    can('admin-1', 'member.changeRole', g, { memberId: editor.id, role: 'owner' }).reason,
    'cannotGrantAboveOwnRole',
    'an admin is told the honest reason: owner is above them',
  )
  // Promoting to their own level is fine; the rank rule is about exceeding it.
  assert.equal(can('admin-1', 'member.changeRole', g, { memberId: editor.id, role: 'admin' }).allowed, true)
})

test('22. an owner may promote to admin but still not mint another owner this way', () => {
  const editor = member('editor-1', 'editor')
  const g = governance([member('owner-1', 'owner'), editor])

  assert.equal(can('owner-1', 'member.changeRole', g, { memberId: editor.id, role: 'admin' }).allowed, true)
  assert.equal(
    can('owner-1', 'member.changeRole', g, { memberId: editor.id, role: 'owner' }).reason,
    'ownerIsProtected',
  )
})

test('23. leaving is always yours to do, unless you are the owner', () => {
  const admin = member('admin-1', 'admin')
  const g = governance([member('owner-1', 'owner'), admin])

  assert.equal(can('admin-1', 'member.remove', g, { memberId: admin.id }).allowed, true, 'may leave')
})

test('24. member actions naming nothing, or naming a stranger, are refused', () => {
  const g = governance([member('admin-1', 'admin'), member('editor-1', 'editor')])

  assert.equal(can('admin-1', 'member.remove', g).reason, 'unknownTarget')
  assert.equal(can('admin-1', 'member.remove', g, { memberId: 'nope' }).reason, 'unknownTarget')
  const editorId = (g.members[1] as FamilyTreeMember).id
  assert.equal(can('admin-1', 'member.changeRole', g, { memberId: editorId }).reason, 'unknownTarget')
})

// ── Invitations: the pure part only ──────────────────────────────────

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: uid('invite'),
    familyTreeId: TREE,
    email: 'aunt@example.com',
    role: 'editor',
    invitedByActorId: 'admin-1',
    expiresAt: '2026-07-01T00:00:00.000Z',
    status: 'pending',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

test('25. an invitation expires on its own, without anything having to run', () => {
  const invite = invitation()
  assert.equal(invitationState(invite, '2026-06-15T00:00:00.000Z'), 'pending')
  assert.equal(invitationState(invite, '2026-07-01T00:00:00.000Z'), 'expired', 'boundary is inclusive')
  assert.equal(invitationState(invite, '2026-08-01T00:00:00.000Z'), 'expired')
})

test('26. revoked and accepted invitations ignore the clock entirely', () => {
  const long = '2099-01-01T00:00:00.000Z'
  assert.equal(invitationState(invitation({ status: 'revoked' }), '2026-06-02T00:00:00.000Z'), 'revoked')
  assert.equal(invitationState(invitation({ status: 'accepted' }), long), 'accepted')
  // A revoked invitation stays revoked even once its expiry passes.
  assert.equal(invitationState(invitation({ status: 'revoked' }), long), 'revoked')
})

test('27. only admins and owners may invite', () => {
  for (const [role, expected] of [
    ['viewer', false],
    ['editor', false],
    ['admin', true],
    ['owner', true],
  ] as [FamilyRole, boolean][]) {
    const g = governance([member('actor-1', role)])
    assert.equal(can('actor-1', 'member.invite', g).allowed, expected, role)
  }
})

test('28. an invitation naming a person is a claim, not a restriction on scope', () => {
  // Recorded as a test because the distinction is easy to lose: personId
  // says "this node is them", and capability still comes from `role`.
  const invite = invitation({ personId: 'p1', role: 'viewer' })
  assert.equal(invite.role, 'viewer')
  assert.equal(invite.personId, 'p1')

  // What acceptance would produce, once a server can do it: a viewer
  // membership plus a verified claim — which grants self-edit on p1 only.
  const g = governance([member('aunt', invite.role)], [claim('aunt', 'p1')])
  assert.equal(can('aunt', 'person.update', g, { personId: 'p1' }).reason, 'ownClaimedPerson')
  assert.equal(can('aunt', 'person.update', g, { personId: 'p2' }).allowed, false)
})

// ── Purity ───────────────────────────────────────────────────────────

test('29. the engine mutates nothing, even when everything is frozen', () => {
  const members = [member('owner-1', 'owner'), member('editor-1', 'editor')]
  const claims = [claim('editor-1', 'p1')]
  const g: Governance = Object.freeze({ familyTreeId: TREE, members, claims })
  members.forEach((entry) => Object.freeze(entry))
  claims.forEach((entry) => Object.freeze(entry))
  Object.freeze(members)
  Object.freeze(claims)

  const snapshot = JSON.stringify(g)
  for (const action of ALL_ACTIONS) {
    can('owner-1', action, g, { memberId: (members[1] as FamilyTreeMember).id, role: 'admin' })
  }
  assert.equal(JSON.stringify(g), snapshot, 'inputs are untouched')
})

test('30. the same question always gets the same answer, whatever the record order', () => {
  const owner = member('owner-1', 'owner')
  const admin = member('admin-1', 'admin')
  const editor = member('editor-1', 'editor')
  const claims = [claim('editor-1', 'p1'), claim('admin-1', 'p2')]

  const forwards = governance([owner, admin, editor], claims)
  const backwards = governance([editor, admin, owner], [...claims].reverse())

  for (const action of ALL_ACTIONS) {
    assert.deepEqual(
      can('admin-1', action, forwards, { memberId: editor.id, role: 'editor' }),
      can('admin-1', action, backwards, { memberId: editor.id, role: 'editor' }),
      action,
    )
  }
})

test('31. every action has a rule — none falls through unhandled', () => {
  const g = governance([member('owner-1', 'owner'), member('nobody-1', 'viewer')])

  for (const action of ALL_ACTIONS) {
    const decision = can('nobody-1', action, g, { memberId: 'unknown', role: 'viewer' })
    assert.equal(typeof decision.allowed, 'boolean', action)
    assert.ok(decision.reason, `${action} must explain itself`)
  }
})

test('32. the decision never depends on the genealogy graph', () => {
  // There is no graph here at all — no people, no links — and every
  // question is still answerable. That is the flat-permission constraint
  // holding: one membership row, optionally one claim row.
  const g = governance([member('editor-1', 'editor')])
  assert.equal(can('editor-1', 'person.update', g, { personId: 'someone-unknown' }).allowed, true)
  assert.equal(can('editor-1', 'relationship.create', g).allowed, true)
})
