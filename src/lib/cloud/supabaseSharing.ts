import type { FamilyRole } from '../policy/membershipTypes'
import type {
  CloudSharing,
  IncomingInvitation,
  InvitableRole,
  PendingInvitation,
  TreeMember,
} from './cloudSharing'
import { getSupabaseClient } from './supabaseClient'

/**
 * Sharing, through Supabase — Milestone 4.
 *
 * Every mutation is a call to a function that checks permission itself.
 * There is no table write anywhere in this file, and there must never be
 * one: membership and invitations have no write policy at all, so the only
 * way in is through a function that reads auth.uid() and enforces its own
 * invariant.
 *
 * The reads are ordinary selects, filtered by row-level security rather
 * than by anything written here. A `where` clause restricting rows to the
 * caller's own would be decoration over the real rule and would rot the
 * moment the policy changed.
 */

function unwrap<T>(result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data as T
}

interface MemberRow {
  account_id: string
  role: FamilyRole
}

interface ProfileRow {
  id: string
  email: string | null
  display_name: string | null
}

interface InvitationRow {
  id: string
  email: string
  role: FamilyRole
  expires_at: string
  status: string
}

interface MyInvitationRow {
  id: string
  tree_id: string
  tree_name: string
  role: FamilyRole
  invited_by_name: string | null
  expires_at: string
}

export class SupabaseSharing implements CloudSharing {
  readonly #accountId: () => string | null

  constructor(accountId: () => string | null) {
    this.#accountId = accountId
  }

  async listMembers(familyTreeId: string): Promise<TreeMember[]> {
    const client = await getSupabaseClient()

    const members = unwrap<MemberRow[]>(
      await client.from('tree_members').select('account_id, role').eq('tree_id', familyTreeId).eq('status', 'active'),
      'Could not read who this family is shared with',
    )
    // The profile policy only returns people who share a tree with the
    // caller, so this needs no filter of its own.
    const profiles = unwrap<ProfileRow[]>(
      await client.from('profiles').select('id, email, display_name'),
      'Could not read who this family is shared with',
    )

    const byId = new Map((profiles ?? []).map((row) => [row.id, row]))
    const me = this.#accountId()

    return (members ?? []).map((row) => {
      const profile = byId.get(row.account_id)
      return {
        accountId: row.account_id,
        role: row.role,
        email: profile?.email ?? null,
        displayName: profile?.display_name ?? null,
        isYou: row.account_id === me,
      }
    })
  }

  async listInvitations(familyTreeId: string): Promise<PendingInvitation[]> {
    const client = await getSupabaseClient()
    const rows = unwrap<InvitationRow[]>(
      await client.from('invitations').select('id, email, role, expires_at, status').eq('tree_id', familyTreeId),
      'Could not read the pending invitations',
    )
    return (rows ?? [])
      .filter((row) => row.status === 'pending')
      .map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: new Date(row.expires_at).toISOString(),
      }))
  }

  async invite(familyTreeId: string, email: string, role: InvitableRole): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('create_invitation', {
        p_tree_id: familyTreeId,
        p_email: email,
        p_role: role,
      }),
      'Could not send the invitation',
    )
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('revoke_invitation', { p_invitation_id: invitationId }),
      'Could not withdraw the invitation',
    )
  }

  async changeRole(familyTreeId: string, accountId: string, role: InvitableRole): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('change_member_role', {
        p_tree_id: familyTreeId,
        p_account_id: accountId,
        p_role: role,
      }),
      'Could not change what they can do',
    )
  }

  async removeMember(familyTreeId: string, accountId: string): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('remove_member', { p_tree_id: familyTreeId, p_account_id: accountId }),
      'Could not remove them',
    )
  }

  async transferOwnership(familyTreeId: string, accountId: string): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('transfer_ownership', { p_tree_id: familyTreeId, p_new_owner: accountId }),
      'Could not hand the family tree on',
    )
  }

  async myInvitations(): Promise<IncomingInvitation[]> {
    const client = await getSupabaseClient()
    const rows = unwrap<MyInvitationRow[]>(
      await client.rpc('my_invitations'),
      'Could not check your invitations',
    )
    return (rows ?? []).map((row) => ({
      id: row.id,
      familyTreeId: row.tree_id,
      familyTreeName: row.tree_name,
      role: row.role,
      invitedByName: row.invited_by_name,
      expiresAt: new Date(row.expires_at).toISOString(),
    }))
  }

  async acceptInvitation(invitationId: string): Promise<string> {
    const client = await getSupabaseClient()
    return unwrap<string>(
      await client.rpc('accept_invitation', { p_invitation_id: invitationId }),
      'Could not accept the invitation',
    )
  }

  async declineInvitation(invitationId: string): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('decline_invitation', { p_invitation_id: invitationId }),
      'Could not decline the invitation',
    )
  }
}
