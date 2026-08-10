import type { ParentLink, Person, Union } from '../../types'

function isSamePartnerPair(union: Union, a: string, b: string): boolean {
  return (union.partnerAId === a && union.partnerBId === b) || (union.partnerAId === b && union.partnerBId === a)
}

function isBirthDateWithinUnionRange(birthDate: string, union: Union): boolean {
  const birthTime = new Date(birthDate).getTime()
  if (union.startDate && birthTime < new Date(union.startDate).getTime()) return false
  if (union.endDate && birthTime > new Date(union.endDate).getTime()) return false
  return true
}

/** Earliest createdAt first, tie-broken by lowest id — order-independent, deterministic. */
function pickDeterministicUnion(candidates: Union[]): Union {
  return candidates.reduce((best, candidate) => {
    const byCreated = candidate.createdAt.localeCompare(best.createdAt)
    if (byCreated !== 0) return byCreated < 0 ? candidate : best
    return candidate.id.localeCompare(best.id) < 0 ? candidate : best
  })
}

/**
 * Deterministic union-selection strategy for routing one ParentLink's
 * edge through a Union's visual junction, per the Phase 4B architecture
 * review:
 *
 * 1. Find the child's other recorded parents (besides this ParentLink's
 *    own parent). None -> nothing to route through (single-parent case).
 * 2. Collect every Union between this parent and any of those other
 *    parents. Normally exactly one (the ordinary two-parent case).
 * 3. If more than one candidate — historical remarriage between the same
 *    two people, or the rarer 3+-recorded-parents case — prefer whichever
 *    Union's date range contains the child's birthDate, when known.
 * 4. Otherwise (no birthDate, or still tied) fall back to the earliest-
 *    created Union, tie-broken by lowest id. Never array order.
 *
 * Known, documented limitation: with 3+ recorded parents, each ParentLink
 * resolves its best-matching Union independently via this same function.
 * That does not guarantee every one of a child's parents agrees on a
 * single shared Union — the domain model defines no semantics for 3+
 * parents, so this is a deliberately simple, deterministic fallback
 * rather than a global-consistency solver. It never invents a Union that
 * doesn't exist in the data, and it never merges two ParentLinks into one
 * edge.
 */
export function resolveUnionForParentLink(
  link: ParentLink,
  allLinksForSameChild: ParentLink[],
  unions: Union[],
  child: Person,
): Union | undefined {
  const otherParentIds = allLinksForSameChild
    .filter((other) => other.id !== link.id)
    .map((other) => other.parentId)
    .filter((id) => id !== link.parentId)

  if (otherParentIds.length === 0) return undefined

  const candidates = unions.filter((union) =>
    otherParentIds.some((otherId) => isSamePartnerPair(union, link.parentId, otherId)),
  )
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  if (child.birthDate) {
    const dateMatches = candidates.filter((union) => isBirthDateWithinUnionRange(child.birthDate as string, union))
    if (dateMatches.length > 0) return pickDeterministicUnion(dateMatches)
  }

  return pickDeterministicUnion(candidates)
}
