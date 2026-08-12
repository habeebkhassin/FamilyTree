import { db } from './db'
import {
  assertFamilyTreeExists,
  GOVERNANCE_TABLES,
  InvalidGovernanceError,
} from './governanceInternal'
import { getFamilyTreeMembersByTree } from './familyTreeMembers'
import { getPersonClaimsByTree } from './personClaims'
import type { FamilyRole, Governance, GovernanceConfig } from '../policy/membershipTypes'

/**
 * Governance configuration, and the snapshot the policy engine reads.
 *
 * No `recordChange` here — see governanceInternal.ts.
 */

export type UpdateGovernanceConfigInput = Partial<Pick<GovernanceConfig, 'defaultInviteRole'>>

/**
 * The governance snapshot for one tree: exactly what `can()` takes.
 *
 * Assembled here and handed over as plain records, the same way the
 * genealogy hooks hand plain snapshots to the relationship engine. The
 * policy layer stays pure and never learns that Dexie exists.
 *
 * A tree with no members comes back with empty arrays, which `can()` reads
 * as ungoverned — the state every existing tree is in, and must stay in
 * until somebody deliberately adds a member.
 */
export async function getGovernance(familyTreeId: string): Promise<Governance> {
  const [members, claims] = await Promise.all([
    getFamilyTreeMembersByTree(familyTreeId),
    getPersonClaimsByTree(familyTreeId),
  ])
  return { familyTreeId, members, claims }
}

export function getGovernanceConfig(familyTreeId: string): Promise<GovernanceConfig | undefined> {
  return db.governance.get(familyTreeId)
}

/**
 * Creates the settings row if a tree has none, leaving an existing one
 * alone. Mirrors ensureSyncState: the concept exists from the start
 * without inventing a state the tree is not in.
 *
 * Creating this row does NOT make a tree governed. That is answered by
 * whether the tree has members, so there is exactly one answer to it.
 */
export async function ensureGovernanceConfig(
  familyTreeId: string,
  establishedByActorId: string | null,
  defaultInviteRole: FamilyRole = 'viewer',
): Promise<GovernanceConfig> {
  return db.transaction('rw', [db.familyTrees, ...GOVERNANCE_TABLES], async () => {
    const existing = await db.governance.get(familyTreeId)
    if (existing) return existing

    await assertFamilyTreeExists(familyTreeId)

    const now = new Date().toISOString()
    const config: GovernanceConfig = {
      familyTreeId,
      defaultInviteRole,
      establishedAt: now,
      establishedByActorId,
      createdAt: now,
      updatedAt: now,
    }
    await db.governance.add(config)
    return config
  })
}

export async function updateGovernanceConfig(
  familyTreeId: string,
  changes: UpdateGovernanceConfigInput,
): Promise<void> {
  await db.transaction('rw', [...GOVERNANCE_TABLES], async () => {
    const before = await db.governance.get(familyTreeId)
    if (!before) throw new InvalidGovernanceError('That family tree has no governance settings.')

    const after: GovernanceConfig = { ...before, ...changes, updatedAt: new Date().toISOString() }
    await db.governance.put(after)
  })
}
