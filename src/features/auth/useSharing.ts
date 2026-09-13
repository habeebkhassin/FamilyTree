import { useCallback, useEffect, useMemo, useState } from 'react'
import { isCloudConfigured } from '../../lib/cloud/cloudConfig'
import { NoCloudSharing } from '../../lib/cloud/cloudSharing'
import type {
  CloudSharing,
  IncomingInvitation,
  InvitableRole,
  PendingInvitation,
  TreeMember,
} from '../../lib/cloud/cloudSharing'
import { SupabaseSharing } from '../../lib/cloud/supabaseSharing'
import { CloudRemoteAdapter } from '../../lib/cloud/cloudRemoteAdapter'
import { SupabaseCloudTreeStore } from '../../lib/cloud/supabaseCloudTrees'
import { materialiseCloudTree } from '../../lib/cloud/materialiseTree'

/**
 * Who a family is shared with, and what this account has been invited to.
 *
 * Every operation is a request the database answers for itself. This hook
 * carries the request, reports the refusal, and reloads — it decides
 * nothing, and a failure here is shown rather than smoothed over.
 */

export interface SharingValue {
  members: TreeMember[]
  invitations: PendingInvitation[]
  incoming: IncomingInvitation[]
  isOwner: boolean
  isLoading: boolean
  error: string | null
  invite: (email: string, role: InvitableRole) => Promise<void>
  revoke: (invitationId: string) => Promise<void>
  changeRole: (accountId: string, role: InvitableRole) => Promise<void>
  removeMember: (accountId: string) => Promise<void>
  accept: (invitation: IncomingInvitation) => Promise<void>
  decline: (invitationId: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useSharing({
  familyTreeId,
  accountId,
  /** True when this tree is saved to the account; sharing needs that first. */
  isCloudTree,
  sharing: injected,
  onTreeJoined,
}: {
  familyTreeId: string
  accountId: string | null
  isCloudTree: boolean
  sharing?: CloudSharing
  /** Called after a newly accepted tree has been brought down. */
  onTreeJoined?: (familyTreeId: string) => void
}): SharingValue {
  const sharing = useMemo<CloudSharing>(() => {
    if (injected) return injected
    if (!isCloudConfigured()) return new NoCloudSharing()
    return new SupabaseSharing(() => accountId)
  }, [injected, accountId])

  const [members, setMembers] = useState<TreeMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [incoming, setIncoming] = useState<IncomingInvitation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwner = members.some((member) => member.isYou && member.role === 'owner')

  const refresh = useCallback(async () => {
    if (!accountId) {
      setMembers([])
      setInvitations([])
      setIncoming([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      // Invitations to this account are worth knowing about whether or
      // not the tree currently open is in the cloud.
      setIncoming(await sharing.myInvitations())

      if (isCloudTree) {
        const found = await sharing.listMembers(familyTreeId)
        setMembers(found)
        // Only an owner may read the pending list, so only an owner asks.
        // Asking anyway would show everybody else a refusal they can do
        // nothing about.
        const youOwn = found.some((member) => member.isYou && member.role === 'owner')
        setInvitations(youOwn ? await sharing.listInvitations(familyTreeId) : [])
      } else {
        setMembers([])
        setInvitations([])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read who this is shared with.')
    } finally {
      setIsLoading(false)
    }
  }, [sharing, accountId, familyTreeId, isCloudTree])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Runs one governance call, then reloads whatever it changed. */
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      setError(null)
      try {
        await operation()
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not work.')
      }
    },
    [refresh],
  )

  const accept = useCallback(
    async (invitation: IncomingInvitation) => {
      setError(null)
      try {
        const treeId = await sharing.acceptInvitation(invitation.id)
        // Bring it down only after the server has said yes. A tree
        // written locally before acceptance would be a family this device
        // has no right to.
        await materialiseCloudTree(
          treeId,
          new CloudRemoteAdapter(new SupabaseCloudTreeStore()),
        )
        onTreeJoined?.(treeId)
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not join that family tree.')
      }
    },
    [sharing, refresh, onTreeJoined],
  )

  return {
    members,
    invitations,
    incoming,
    isOwner,
    isLoading,
    error,
    invite: (email, role) => run(() => sharing.invite(familyTreeId, email, role)),
    revoke: (invitationId) => run(() => sharing.revokeInvitation(invitationId)),
    changeRole: (id, role) => run(() => sharing.changeRole(familyTreeId, id, role)),
    removeMember: (id) => run(() => sharing.removeMember(familyTreeId, id)),
    accept,
    decline: (invitationId) => run(() => sharing.declineInvitation(invitationId)),
    refresh,
  }
}
