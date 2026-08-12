import { db } from './db'
import {
  assertFamilyTreeExists,
  assertPersonIsClaimable,
  GOVERNANCE_TABLES,
  InvalidGovernanceError,
} from './governanceInternal'
import type { FamilyRole, Invitation, InvitationStatus } from '../policy/membershipTypes'

/**
 * Invitation persistence — Phase 5B-2.
 *
 * A DURABLE RECORD OF INTENT, NOT A WORKING INVITATION. There is no token,
 * no email delivery, no redemption and no account creation, because all
 * four need a server: a token nobody can verify is theatre, and a client
 * that accepts its own invitations is not an access control system.
 *
 * What exists here is the row, so the model is real and a future backend
 * inherits a shape. Whether a row is still usable is `invitationState()`
 * in lib/policy, which stays pure.
 *
 * No `recordChange` here — see governanceInternal.ts.
 */

export interface CreateInvitationInput {
  familyTreeId: string
  role: FamilyRole
  email?: string
  /**
   * The person record this invitee represents, if known.
   *
   * "This node is them", not "they may only edit this node". Capability
   * comes from `role`; naming a person means acceptance would also create
   * a claim, which adds self-edit on that one record.
   */
  personId?: string
  invitedByActorId: string
  expiresAt: string
}

export async function createInvitation(input: CreateInvitationInput): Promise<Invitation> {
  return db.transaction('rw', [db.familyTrees, db.people, ...GOVERNANCE_TABLES], async () => {
    await assertFamilyTreeExists(input.familyTreeId)
    if (input.personId) {
      await assertPersonIsClaimable(input.familyTreeId, input.personId)
    }

    const now = new Date().toISOString()
    const invitation: Invitation = {
      id: crypto.randomUUID(),
      familyTreeId: input.familyTreeId,
      ...(input.email ? { email: input.email } : {}),
      role: input.role,
      ...(input.personId ? { personId: input.personId } : {}),
      invitedByActorId: input.invitedByActorId,
      expiresAt: input.expiresAt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    await db.invitations.add(invitation)
    return invitation
  })
}

export function getInvitation(id: string): Promise<Invitation | undefined> {
  return db.invitations.get(id)
}

export function getInvitationsByTree(familyTreeId: string): Promise<Invitation[]> {
  return db.invitations.where('familyTreeId').equals(familyTreeId).toArray()
}

/**
 * Changes an invitation's status.
 *
 * Note what is absent: nothing here grants a membership. Marking an
 * invitation accepted locally is bookkeeping, not redemption — the
 * membership and any claim it implies must be created by the server that
 * verified the invitee, which is why acceptance is not modelled as a
 * side effect of this function.
 */
export async function updateInvitationStatus(id: string, status: InvitationStatus): Promise<void> {
  await db.transaction('rw', [...GOVERNANCE_TABLES], async () => {
    const before = await db.invitations.get(id)
    if (!before) throw new InvalidGovernanceError('That invitation no longer exists.')

    const after: Invitation = { ...before, status, updatedAt: new Date().toISOString() }
    await db.invitations.put(after)
  })
}

export function revokeInvitation(id: string): Promise<void> {
  return updateInvitationStatus(id, 'revoked')
}
