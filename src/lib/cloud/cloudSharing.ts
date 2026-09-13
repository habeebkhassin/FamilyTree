import type { FamilyRole } from '../policy/membershipTypes'

/**
 * Who a family tree is shared with — Milestone 4.
 *
 * A seam of its own, beside CloudTreeStore and CloudSyncTransport, for the
 * same reason they are separate from each other: three jobs, three
 * interfaces, each testable on its own.
 *
 * Nothing here decides anything. Every call below is a request that the
 * database will accept or refuse on its own terms — the client cannot
 * grant a role, cannot accept an invitation on somebody else's behalf, and
 * cannot see a membership it is not entitled to. What this interface does
 * is carry the request and report the answer.
 *
 * `can.ts` still decides which buttons to show. It is not, and never
 * becomes, the reason an operation succeeds.
 */

/** A role somebody can be invited as. Owner is transferred, never offered. */
export type InvitableRole = Extract<FamilyRole, 'editor' | 'viewer'>

export interface TreeMember {
  accountId: string
  role: FamilyRole
  email: string | null
  displayName: string | null
  /** True for the signed-in account, so the list can say "you". */
  isYou: boolean
}

export interface PendingInvitation {
  id: string
  email: string
  role: FamilyRole
  expiresAt: string
}

/** An invitation waiting for the signed-in account. */
export interface IncomingInvitation {
  id: string
  familyTreeId: string
  familyTreeName: string
  role: FamilyRole
  invitedByName: string | null
  expiresAt: string
}

export interface CloudSharing {
  listMembers(familyTreeId: string): Promise<TreeMember[]>
  listInvitations(familyTreeId: string): Promise<PendingInvitation[]>
  invite(familyTreeId: string, email: string, role: InvitableRole): Promise<void>
  revokeInvitation(invitationId: string): Promise<void>
  changeRole(familyTreeId: string, accountId: string, role: InvitableRole): Promise<void>
  removeMember(familyTreeId: string, accountId: string): Promise<void>
  transferOwnership(familyTreeId: string, accountId: string): Promise<void>
  /** What this account has been invited to. */
  myInvitations(): Promise<IncomingInvitation[]>
  /** Returns the family tree id to bootstrap. */
  acceptInvitation(invitationId: string): Promise<string>
  declineInvitation(invitationId: string): Promise<void>
}

/** Sharing when there is no cloud: nothing to share, and it says so. */
export class NoCloudSharing implements CloudSharing {
  async listMembers(): Promise<TreeMember[]> {
    return []
  }
  async listInvitations(): Promise<PendingInvitation[]> {
    return []
  }
  async myInvitations(): Promise<IncomingInvitation[]> {
    return []
  }
  async invite(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured, so there is nobody to share with.')
  }
  async revokeInvitation(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
  async changeRole(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
  async removeMember(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
  async transferOwnership(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
  async acceptInvitation(): Promise<string> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
  async declineInvitation(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
}
