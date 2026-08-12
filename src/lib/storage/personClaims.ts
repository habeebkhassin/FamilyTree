import { db } from './db'
import {
  assertFamilyTreeExists,
  assertPersonIsClaimable,
  GOVERNANCE_TABLES,
  InvalidGovernanceError,
} from './governanceInternal'
import type { MemberSubjectKind, PersonClaim, PersonClaimStatus } from '../policy/membershipTypes'

/**
 * Person claim persistence — Phase 5B-2.
 *
 * A claim says "this person record is me". Locally it can only ever be
 * `selfAsserted`: there is no authority on this device to verify anything,
 * and the app must never present a self-asserted claim as a verified
 * identity. `verified` exists in the model for the account system to set,
 * and `createPersonClaim` will not mint one.
 *
 * No `recordChange` here — see governanceInternal.ts.
 */

export interface CreatePersonClaimInput {
  familyTreeId: string
  personId: string
  actorId: string
  subjectKind: MemberSubjectKind
}

/** A claim that still occupies its person and actor slots. */
const OCCUPYING: PersonClaimStatus[] = ['selfAsserted', 'verified']

export async function createPersonClaim(input: CreatePersonClaimInput): Promise<PersonClaim> {
  return db.transaction('rw', [db.familyTrees, db.people, ...GOVERNANCE_TABLES], async () => {
    await assertFamilyTreeExists(input.familyTreeId)
    // Rejects a person from another tree, and a tombstoned person.
    await assertPersonIsClaimable(input.familyTreeId, input.personId)

    const onPerson = await db.personClaims
      .where('[familyTreeId+personId]')
      .equals([input.familyTreeId, input.personId])
      .toArray()
    if (onPerson.some((claim) => OCCUPYING.includes(claim.status))) {
      throw new InvalidGovernanceError('Someone has already claimed that person.')
    }

    // You are one person: an actor holds at most one live claim per tree.
    const byActor = await db.personClaims
      .where('[familyTreeId+actorId]')
      .equals([input.familyTreeId, input.actorId])
      .toArray()
    if (byActor.some((claim) => OCCUPYING.includes(claim.status))) {
      throw new InvalidGovernanceError('You have already claimed someone in this family tree.')
    }

    const now = new Date().toISOString()
    const claim: PersonClaim = {
      id: crypto.randomUUID(),
      familyTreeId: input.familyTreeId,
      personId: input.personId,
      actorId: input.actorId,
      subjectKind: input.subjectKind,
      // Always self-asserted. Only the authoritative account system may
      // produce `verified`, and it does not exist yet.
      status: 'selfAsserted',
      createdAt: now,
      updatedAt: now,
    }
    await db.personClaims.add(claim)
    return claim
  })
}

export function getPersonClaim(id: string): Promise<PersonClaim | undefined> {
  return db.personClaims.get(id)
}

/** Every claim row for a tree, including rejected ones — the policy engine filters. */
export function getPersonClaimsByTree(familyTreeId: string): Promise<PersonClaim[]> {
  return db.personClaims.where('familyTreeId').equals(familyTreeId).toArray()
}

export async function getPersonClaimForActor(
  familyTreeId: string,
  actorId: string,
): Promise<PersonClaim | undefined> {
  const rows = await db.personClaims
    .where('[familyTreeId+actorId]')
    .equals([familyTreeId, actorId])
    .toArray()
  return rows.find((claim) => OCCUPYING.includes(claim.status)) ?? rows[0]
}

export async function updatePersonClaim(id: string, status: PersonClaimStatus): Promise<void> {
  await db.transaction('rw', [...GOVERNANCE_TABLES], async () => {
    const before = await db.personClaims.get(id)
    if (!before) throw new InvalidGovernanceError('That claim no longer exists.')

    const after: PersonClaim = { ...before, status, updatedAt: new Date().toISOString() }
    await db.personClaims.put(after)
  })
}

/** Withdraws a claim without erasing that it was made. */
export function rejectPersonClaim(id: string): Promise<void> {
  return updatePersonClaim(id, 'rejected')
}
