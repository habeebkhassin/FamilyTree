import { useCallback, useEffect, useMemo, useState } from 'react'
import { ensureCurrentLocalActor } from '../../lib/identity/localActor'
import { can, roleOf } from '../../lib/policy/can'
import type { PolicyAction, PolicyDecision, PolicyTarget } from '../../lib/policy/can'
import type { FamilyRole, Governance } from '../../lib/policy/membershipTypes'
import { createPersonClaim, getGovernance } from '../../lib/storage'

type Status = 'loading' | 'ready' | 'error'

/**
 * The single place the interface consults the policy engine.
 *
 * Components ask this what they may offer; none of them reason about roles
 * themselves. That keeps the rules in one testable pure module instead of
 * scattered through the UI, and means the eventual server-side port has
 * one client-side counterpart to stay in step with rather than a dozen.
 *
 * NOT A SECURITY BOUNDARY. Everything below is read from the user's own
 * IndexedDB, which they can edit. This decides what to grey out, nothing
 * more; the backend will have to validate every mutation independently and
 * must never trust a role or claim that came from here.
 *
 * While governance is loading the tree reads as ungoverned, so actions are
 * briefly offered before any restriction applies. That is the right
 * default — every tree that has never been shared is genuinely ungoverned
 * — and it is a UX affordance, so a moment of optimism costs nothing.
 */
export function usePolicy(familyTreeId: string) {
  const [governance, setGovernance] = useState<Governance>(() => ({
    familyTreeId,
    members: [],
    claims: [],
  }))
  const [actorId, setActorId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  const reload = useCallback(async () => {
    setStatus('loading')
    try {
      // Re-read the actor too: switching who is editing changes what the
      // interface should offer, not just how edits are attributed.
      setActorId(ensureCurrentLocalActor()?.id ?? null)
      setGovernance(await getGovernance(familyTreeId))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [familyTreeId])

  useEffect(() => {
    void reload()
  }, [reload])

  const check = useCallback(
    (action: PolicyAction, target?: PolicyTarget): PolicyDecision =>
      can(actorId, action, governance, target),
    [actorId, governance],
  )

  /** The person this device's actor has said is them, if any. */
  const claimedPersonId = useMemo(() => {
    if (!actorId) return null
    return (
      governance.claims.find(
        (claim) => claim.actorId === actorId && claim.status !== 'rejected',
      )?.personId ?? null
    )
  }, [actorId, governance])

  /** Whether someone else has already said a person is them. */
  const isClaimedByAnother = useCallback(
    (personId: string) =>
      governance.claims.some(
        (claim) =>
          claim.personId === personId && claim.status !== 'rejected' && claim.actorId !== actorId,
      ),
    [actorId, governance],
  )

  const claimPerson = useCallback(
    async (personId: string) => {
      const actor = ensureCurrentLocalActor()
      if (!actor) return
      await createPersonClaim({
        familyTreeId,
        personId,
        actorId: actor.id,
        subjectKind: 'localActor',
      })
      await reload()
    },
    [familyTreeId, reload],
  )

  const role: FamilyRole | null = useMemo(
    () => roleOf(actorId, governance),
    [actorId, governance],
  )

  return {
    status,
    actorId,
    role,
    /**
     * Raw claim rows for this tree, including rejected ones. Consumed by
     * the focal-person resolver, which needs the verified/self-asserted
     * distinction that `claimedPersonId` collapses.
     */
    claims: governance.claims,
    /** False for every tree that has never had a member — which is all of them today. */
    isGoverned: governance.members.some((member) => member.familyTreeId === familyTreeId),
    check,
    claimedPersonId,
    isClaimedByAnother,
    claimPerson,
    reload,
  }
}
