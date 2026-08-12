import { db } from './db'
import { isLive } from './internal'

/**
 * Shared internals for the governance storage modules — Phase 5B-2.
 *
 * Not exported from the package barrel; nothing outside lib/storage needs
 * these.
 *
 *
 * GOVERNANCE IS NOT ORDINARY CONTENT
 * ──────────────────────────────────
 * None of the governance tables appears in SYNC_TABLES, and no function in
 * familyTreeMembers.ts, personClaims.ts, invitations.ts or governance.ts
 * calls `recordChange`. That is a deliberate architectural boundary, not an
 * oversight, and it must not be "fixed" later by adding a governance entity
 * to SyncEntity.
 *
 * A birth date and a role are not the same kind of fact. Content events
 * are append-only, client-minted, and merged by last-writer-wins — which
 * is exactly right for family facts and exactly wrong for permissions. If
 * membership travelled that stream, a client could grant itself Owner by
 * constructing or replaying an ordinary change event, and the reconciler
 * would faithfully merge it, because the reconciler's whole job is to
 * trust the events it is given.
 *
 * So governance changes will need a privileged, server-authorized path
 * when a backend exists: validated per mutation, never accepted from the
 * content outbox, and never resolved by LWW.
 *
 *
 * AND NONE OF IT IS A SECURITY BOUNDARY TODAY
 * ───────────────────────────────────────────
 * Everything written here lives in the user's own IndexedDB. Anyone who
 * can open devtools can award themselves any role they like. Local
 * governance exists so the interface can behave sensibly offline — to grey
 * out a button and explain why — and for no other purpose.
 *
 * The future backend must independently validate every mutation, must not
 * trust any client-supplied role or claim, must establish `verified`
 * claims through the authoritative account system, and must treat these
 * local rows as a cache of its own decisions rather than as input.
 */

/** Governance transactions touch these; content transactions never do. */
export const GOVERNANCE_TABLES = [
  db.familyTreeMembers,
  db.personClaims,
  db.invitations,
  db.governance,
] as const

export class InvalidGovernanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidGovernanceError'
  }
}

/**
 * The single cross-tree check for governance, so the four storage modules
 * share one definition rather than each rolling their own.
 *
 * Mirrors `assertPeopleBelongToTree` in relationships.ts on purpose — same
 * two conditions, deliberately a different error type and message, because
 * "you cannot claim someone from another family" is a governance failure
 * rather than a malformed relationship.
 */
export async function assertPersonIsClaimable(familyTreeId: string, personId: string): Promise<void> {
  const person = await db.people.get(personId)

  // A tombstoned person counts as gone: a deleted record must not become
  // newly claimable, exactly as it cannot gain a new relationship.
  if (!isLive(person)) {
    throw new InvalidGovernanceError('That person no longer exists.')
  }
  if (person.familyTreeId !== familyTreeId) {
    throw new InvalidGovernanceError('A person can only be claimed within their own family tree.')
  }
}

/** A governance row can only attach to a family tree that actually exists. */
export async function assertFamilyTreeExists(familyTreeId: string): Promise<void> {
  const tree = await db.familyTrees.get(familyTreeId)
  if (!isLive(tree)) {
    throw new InvalidGovernanceError('That family tree no longer exists.')
  }
}
