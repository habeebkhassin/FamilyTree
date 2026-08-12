import { ROLE_RANK } from './membershipTypes'
import type {
  FamilyRole,
  FamilyTreeMember,
  Governance,
  Invitation,
  PersonClaim,
} from './membershipTypes'

/**
 * The policy engine — Phase 5B-2.
 *
 * Pure, like the relationship resolver and the reconciler: it takes plain
 * record snapshots and answers a question. No Dexie, no React, no network,
 * no clock. Every input is a parameter, so the same rules can be tested
 * exhaustively offline and later re-expressed as row-level security
 * without dragging any client machinery along.
 *
 *
 * THIS IS NOT A SECURITY BOUNDARY
 * ───────────────────────────────
 * Say it plainly, because everything else depends on believing it: a
 * client that decides its own permissions is a client that grants itself
 * permissions. Today the actor is a self-asserted name on one device
 * (lib/identity), the membership rows are written by the same client that
 * reads them, and nothing is verified by anyone.
 *
 * So `can` exists to make the INTERFACE honest — to grey out a button, to
 * explain why something is unavailable, to keep offline edits sensible. It
 * is advisory. The real enforcement belongs in the backend, and when that
 * arrives these same rules must be implemented there and treated as the
 * only ones that count. Nothing in the app may treat a `true` from here as
 * proof of anything.
 *
 * A corollary worth stating: every invariant currently enforced in
 * lib/storage — the cycle check, the cross-tree guard, the duplicate
 * guards — is equally client-side, and will need the same treatment.
 */

export type PolicyAction =
  // Content. What the family archive is actually for.
  | 'tree.view'
  | 'person.create'
  | 'person.update'
  | 'person.delete'
  | 'relationship.create'
  | 'relationship.delete'
  | 'familyGroup.create'
  | 'familyGroup.update'
  | 'familyGroup.delete'
  // Governance. Who may change who may do what.
  | 'tree.rename'
  | 'member.invite'
  | 'member.changeRole'
  | 'member.remove'
  | 'claim.verify'
  // Owner only.
  | 'tree.delete'
  | 'tree.transferOwnership'

/** Why a decision came out the way it did. Lets the UI explain itself. */
export type PolicyReason =
  /** No membership records exist: an ordinary local tree, owned by nobody. */
  | 'ungovernedTree'
  /** Granted by the actor's role. */
  | 'role'
  /** Granted because the target person is the actor's own claimed record. */
  | 'ownClaimedPerson'
  /** The actor has no membership in this tree. */
  | 'notAMember'
  /** Membership exists but is invited/suspended/left. */
  | 'membershipNotActive'
  /** The actor's role is too low for this action. */
  | 'insufficientRole'
  /** Cannot act on someone of equal or higher rank. */
  | 'cannotActOnEqualOrHigherRank'
  /** Cannot grant a role above your own. */
  | 'cannotGrantAboveOwnRole'
  /** The owner's membership cannot be removed or demoted; transfer instead. */
  | 'ownerIsProtected'
  /** The action names a member or person that is not present. */
  | 'unknownTarget'

export interface PolicyDecision {
  allowed: boolean
  reason: PolicyReason
}

export interface PolicyTarget {
  /** For person.* actions, and for the self-edit exception. */
  personId?: string
  /** For member.changeRole / member.remove. */
  memberId?: string
  /** The role being granted, for member.changeRole. */
  role?: FamilyRole
}

/** The minimum role each action needs, before any special cases. */
const REQUIRED_ROLE: Record<PolicyAction, FamilyRole> = {
  'tree.view': 'viewer',

  'person.create': 'editor',
  'person.update': 'editor',
  'person.delete': 'editor',
  'relationship.create': 'editor',
  'relationship.delete': 'editor',
  'familyGroup.create': 'editor',
  'familyGroup.update': 'editor',
  'familyGroup.delete': 'editor',

  'tree.rename': 'admin',
  'member.invite': 'admin',
  'member.changeRole': 'admin',
  'member.remove': 'admin',
  'claim.verify': 'admin',

  'tree.delete': 'owner',
  'tree.transferOwnership': 'owner',
}

const allow = (reason: PolicyReason): PolicyDecision => ({ allowed: true, reason })
const deny = (reason: PolicyReason): PolicyDecision => ({ allowed: false, reason })

/** Memberships that belong to this tree and actually confer anything. */
function activeMembers(governance: Governance): FamilyTreeMember[] {
  return governance.members.filter(
    (member) => member.familyTreeId === governance.familyTreeId && member.status === 'active',
  )
}

/**
 * True when nobody has claimed governance of this tree.
 *
 * Every tree that exists today is in this state, and that must keep
 * working forever: the app has never required an account, and a tree with
 * no owner stays a perfectly valid local tree. Membership rules only
 * switch on once somebody is a member.
 */
function isUngoverned(governance: Governance): boolean {
  return !governance.members.some((member) => member.familyTreeId === governance.familyTreeId)
}

/**
 * The actor's effective role, or null if they hold none.
 *
 * Exported because the UI needs it directly ("you have view-only access").
 * Where an actor somehow holds several memberships — which the backend
 * must prevent — the highest is used, deterministically.
 */
export function roleOf(actorId: string | null, governance: Governance): FamilyRole | null {
  if (!actorId) return null

  let best: FamilyRole | null = null
  for (const member of activeMembers(governance)) {
    if (member.actorId !== actorId) continue
    if (!best || ROLE_RANK[member.role] > ROLE_RANK[best]) best = member.role
  }
  return best
}

/** The membership row itself, for rank comparisons. */
function memberById(memberId: string, governance: Governance): FamilyTreeMember | null {
  return (
    governance.members.find(
      (member) => member.id === memberId && member.familyTreeId === governance.familyTreeId,
    ) ?? null
  )
}

/**
 * Whether the actor holds a claim on this person that grants self-edit.
 *
 * A rejected claim grants nothing. A self-asserted one is honoured here
 * because it is all an offline device can produce — but the SERVER must
 * require 'verified', otherwise anyone could claim anyone. That gap is
 * real and is named here rather than hidden.
 */
function hasClaimOn(actorId: string, personId: string, governance: Governance): boolean {
  return governance.claims.some(
    (claim) =>
      claim.familyTreeId === governance.familyTreeId &&
      claim.actorId === actorId &&
      claim.personId === personId &&
      (claim.status === 'verified' || claim.status === 'selfAsserted'),
  )
}

/**
 * May `actorId` perform `action`?
 *
 * Answerable from one membership row plus, for the self-edit case, one
 * claim row. It never walks the genealogy graph — see the note on
 * FamilyRole for why that constraint matters.
 */
export function can(
  actorId: string | null,
  action: PolicyAction,
  governance: Governance,
  target: PolicyTarget = {},
): PolicyDecision {
  // An ordinary local tree. The sole user is effectively its owner, and
  // always has been; nothing about adding a permission model may take
  // that away from trees that predate it.
  if (isUngoverned(governance)) return allow('ungovernedTree')

  const role = roleOf(actorId, governance)

  if (!role) {
    // Distinguish "never involved" from "involved, but not currently" so
    // the UI can say something useful to a suspended member.
    const known = governance.members.some(
      (member) => member.familyTreeId === governance.familyTreeId && member.actorId === actorId,
    )
    return deny(known ? 'membershipNotActive' : 'notAMember')
  }

  const actor = actorId as string
  const meetsRole = ROLE_RANK[role] >= ROLE_RANK[REQUIRED_ROLE[action]]

  // The one person-level capability: your own record is yours to correct,
  // whatever your role. Deliberately does NOT extend to deleting yourself
  // out of the family history, which affects everyone else's graph.
  if (action === 'person.update' && !meetsRole) {
    if (target.personId && hasClaimOn(actor, target.personId, governance)) {
      return allow('ownClaimedPerson')
    }
  }

  if (!meetsRole) return deny('insufficientRole')

  if (action === 'member.changeRole' || action === 'member.remove') {
    return decideMemberAction(actor, role, action, governance, target)
  }

  return allow('role')
}

/**
 * Rank rules for acting on another membership.
 *
 * Kept separate because they are the only rules that compare two people
 * rather than reading one row.
 */
function decideMemberAction(
  actorId: string,
  role: FamilyRole,
  action: 'member.changeRole' | 'member.remove',
  governance: Governance,
  target: PolicyTarget,
): PolicyDecision {
  if (!target.memberId) return deny('unknownTarget')

  const subject = memberById(target.memberId, governance)
  if (!subject) return deny('unknownTarget')

  // The owner's own membership is not editable through these actions.
  // Handing the tree over is `tree.transferOwnership`, which is a
  // deliberate act rather than a side effect of member management.
  if (subject.role === 'owner') return deny('ownerIsProtected')

  // Leaving is always yours to do — you are not acting on someone else.
  const isSelf = subject.actorId === actorId
  if (action === 'member.remove' && isSelf) return allow('role')

  if (ROLE_RANK[subject.role] >= ROLE_RANK[role] && !isSelf) {
    return deny('cannotActOnEqualOrHigherRank')
  }

  if (action === 'member.changeRole') {
    if (!target.role) return deny('unknownTarget')
    // Nobody may mint someone more powerful than themselves.
    if (ROLE_RANK[target.role] > ROLE_RANK[role]) return deny('cannotGrantAboveOwnRole')
    // Promoting to owner is a transfer, not a role change.
    if (target.role === 'owner') return deny('ownerIsProtected')
  }

  return allow('role')
}

/**
 * What an invitation currently is, given a clock reading.
 *
 * `now` is a parameter rather than read from the system clock, so this
 * stays pure and testable — the same discipline the reconciler follows.
 *
 * This is the whole of what can honestly be implemented offline. Issuing a
 * token, delivering it, and redeeming it all need a server; without one
 * there is nobody to verify a token against, and a client that accepts its
 * own invitations is not an access control system. Acceptance must create
 * the membership (and any claim) server-side.
 */
export function invitationState(
  invitation: Invitation,
  now: string,
): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (invitation.status === 'accepted') return 'accepted'
  if (invitation.status === 'revoked') return 'revoked'
  return invitation.expiresAt <= now ? 'expired' : 'pending'
}

/**
 * The claims an actor holds in this tree — what a "this is you" badge reads.
 */
export function claimsOf(actorId: string | null, governance: Governance): PersonClaim[] {
  if (!actorId) return []
  return governance.claims.filter(
    (claim) =>
      claim.familyTreeId === governance.familyTreeId &&
      claim.actorId === actorId &&
      claim.status !== 'rejected',
  )
}

/*
 * ON PERSISTENCE — deliberately absent.
 *
 * No Dexie table, no schema version, no SyncEntity additions. Membership
 * records are meaningless while a single self-asserted local actor can
 * write them, and persisting them through the ordinary change log would
 * mean a client could grant itself Owner by appending an event. When a
 * backend exists, governance changes should travel a privileged path that
 * the server validates — not the same last-writer-wins stream that
 * carries birth dates.
 */
