import { db } from './db'
import {
  assertFamilyTreeExists,
  GOVERNANCE_TABLES,
  InvalidGovernanceError,
} from './governanceInternal'
import type { FamilyTreeMember, FamilyRole, MembershipStatus, MemberSubjectKind } from '../policy/membershipTypes'

/**
 * Membership persistence — Phase 5B-2.
 *
 * No `recordChange` anywhere in this file, and that is load-bearing: see
 * governanceInternal.ts for why permissions must never travel the content
 * change log.
 *
 * Membership is never physically removed and carries no `deletedAt`.
 * Withdrawing access is a status change, which keeps the fact that someone
 * was once here — and why they no longer are — instead of erasing it.
 */

export interface CreateFamilyTreeMemberInput {
  familyTreeId: string
  actorId: string
  subjectKind: MemberSubjectKind
  role: FamilyRole
  status?: MembershipStatus
  invitedByActorId?: string
}

export type UpdateFamilyTreeMemberInput = Partial<Pick<FamilyTreeMember, 'role' | 'status' | 'joinedAt'>>

/** Statuses that still occupy an actor's single membership slot in a tree. */
const OCCUPYING: MembershipStatus[] = ['active', 'invited', 'suspended']

export async function createFamilyTreeMember(
  input: CreateFamilyTreeMemberInput,
): Promise<FamilyTreeMember> {
  return db.transaction('rw', [db.familyTrees, ...GOVERNANCE_TABLES], async () => {
    await assertFamilyTreeExists(input.familyTreeId)

    // One membership per actor per tree. Enforced here rather than by a
    // unique index so a `left` membership can be superseded when someone
    // rejoins, without the old row blocking them forever.
    const existing = await db.familyTreeMembers
      .where('[familyTreeId+actorId]')
      .equals([input.familyTreeId, input.actorId])
      .toArray()
    if (existing.some((member) => OCCUPYING.includes(member.status))) {
      throw new InvalidGovernanceError('That person already has a membership in this family tree.')
    }

    const now = new Date().toISOString()
    const status = input.status ?? 'active'
    const member: FamilyTreeMember = {
      id: crypto.randomUUID(),
      familyTreeId: input.familyTreeId,
      actorId: input.actorId,
      subjectKind: input.subjectKind,
      role: input.role,
      status,
      ...(input.invitedByActorId ? { invitedByActorId: input.invitedByActorId } : {}),
      ...(status === 'active' ? { joinedAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await db.familyTreeMembers.add(member)
    return member
  })
}

export function getFamilyTreeMember(id: string): Promise<FamilyTreeMember | undefined> {
  return db.familyTreeMembers.get(id)
}

/**
 * Every membership row for a tree, whatever its status.
 *
 * Revoked and suspended rows are included on purpose: the policy engine
 * needs them to tell "never a member" apart from "no longer a member", and
 * the UI says something different in each case.
 */
export function getFamilyTreeMembersByTree(familyTreeId: string): Promise<FamilyTreeMember[]> {
  return db.familyTreeMembers.where('familyTreeId').equals(familyTreeId).toArray()
}

/** The membership an actor holds in one tree, in whatever state. */
export async function getFamilyTreeMemberForActor(
  familyTreeId: string,
  actorId: string,
): Promise<FamilyTreeMember | undefined> {
  const rows = await db.familyTreeMembers
    .where('[familyTreeId+actorId]')
    .equals([familyTreeId, actorId])
    .toArray()

  // Prefer a currently-occupying row over a historical `left` one, so a
  // rejoined member reads as their current membership.
  return rows.find((member) => OCCUPYING.includes(member.status)) ?? rows[0]
}

export async function updateFamilyTreeMember(
  id: string,
  changes: UpdateFamilyTreeMemberInput,
): Promise<void> {
  await db.transaction('rw', [...GOVERNANCE_TABLES], async () => {
    const before = await db.familyTreeMembers.get(id)
    if (!before) throw new InvalidGovernanceError('That membership no longer exists.')

    const becomingActive = changes.status === 'active' && before.status !== 'active'
    const after: FamilyTreeMember = {
      ...before,
      ...changes,
      // Records when they actually joined, without overwriting an earlier
      // join date on a second status change.
      ...(becomingActive && !before.joinedAt ? { joinedAt: new Date().toISOString() } : {}),
      updatedAt: new Date().toISOString(),
    }
    await db.familyTreeMembers.put(after)
  })
}

/**
 * Withdraws access without erasing the record of it.
 *
 * There is deliberately no hard delete: `suspended` and `left` are the
 * vocabulary, and both stay visible to the audit trail.
 */
export function suspendFamilyTreeMember(id: string): Promise<void> {
  return updateFamilyTreeMember(id, { status: 'suspended' })
}
