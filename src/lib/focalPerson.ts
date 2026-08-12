import type { PersonClaim } from './policy/membershipTypes'

/**
 * Who the tree is being explored FROM — Phase 5C-1.
 *
 * A viewpoint, never a genealogical root. Nothing here touches the graph:
 * the same stored People, ParentLinks and Unions produce the same ranks
 * and the same layout whoever is focused. Changing focus changes where the
 * camera points and which card is emphasised, and nothing else.
 *
 * Pure — no storage, no React, no clock. The caller supplies every
 * candidate and the set of people who actually exist, so this can be
 * tested exhaustively without a database.
 */

export type FocalPersonSource =
  /** Chosen by the user during this session. */
  | 'explicit'
  /** Remembered from a previous visit to this tree. */
  | 'stored'
  /** Established by the account system as genuinely this person. */
  | 'verifiedClaim'
  /** The user said this is them on this device; nobody checked. */
  | 'selfAssertedClaim'
  /** Nothing to focus on — the caller should offer to ask. */
  | 'none'

export interface ResolveFocalPersonInput {
  explicitPersonId?: string | null
  storedPersonId?: string | null
  /** Claims for THIS tree. Claims from other trees must not be passed in. */
  claims?: readonly PersonClaim[]
  /** Whose claims count. Null when this device has no identity yet. */
  actorId?: string | null
  /**
   * Everyone currently live in the tree. A candidate missing from here is
   * skipped — a deleted person must never remain the viewpoint, and a
   * stored id can outlive the person it names.
   */
  livePersonIds: ReadonlySet<string>
}

export interface FocalPersonResolution {
  personId: string | null
  source: FocalPersonSource
  /**
   * Set when the STORED preference named someone who is no longer live,
   * so the caller can clear it rather than re-resolving it forever. Only
   * reported for the stored candidate: that is the only one persisted.
   */
  stalePersonId: string | null
}

/** Deterministic when a subject somehow holds several claims of one status. */
function claimedPersonId(
  claims: readonly PersonClaim[],
  actorId: string,
  status: PersonClaim['status'],
  livePersonIds: ReadonlySet<string>,
): string | null {
  const matches = claims
    .filter(
      (claim) =>
        claim.actorId === actorId && claim.status === status && livePersonIds.has(claim.personId),
    )
    .map((claim) => claim.personId)
    .sort()
  return matches[0] ?? null
}

/**
 * The focal person, by the approved priority:
 *
 *   1. an explicit choice this session
 *   2. the preference remembered for this tree
 *   3. a verified claim
 *   4. a self-asserted claim
 *   5. nobody — ask
 *
 * Governance is never required. Every tree today has no members and no
 * claims, and steps 1, 2 and 5 carry that case entirely: a local user can
 * always just pick someone. A self-asserted claim is a convenience for
 * choosing a sensible default, never a statement that identity was
 * verified.
 */
export function resolveFocalPerson(input: ResolveFocalPersonInput): FocalPersonResolution {
  const { explicitPersonId, storedPersonId, claims = [], actorId, livePersonIds } = input

  if (explicitPersonId && livePersonIds.has(explicitPersonId)) {
    return { personId: explicitPersonId, source: 'explicit', stalePersonId: null }
  }

  // Whether or not it resolves, a stored id naming someone who has gone is
  // worth telling the caller about so it can be cleared.
  const stalePersonId =
    storedPersonId && !livePersonIds.has(storedPersonId) ? storedPersonId : null

  if (storedPersonId && livePersonIds.has(storedPersonId)) {
    return { personId: storedPersonId, source: 'stored', stalePersonId: null }
  }

  if (actorId) {
    const verified = claimedPersonId(claims, actorId, 'verified', livePersonIds)
    if (verified) return { personId: verified, source: 'verifiedClaim', stalePersonId }

    const selfAsserted = claimedPersonId(claims, actorId, 'selfAsserted', livePersonIds)
    if (selfAsserted) return { personId: selfAsserted, source: 'selfAssertedClaim', stalePersonId }
  }

  return { personId: null, source: 'none', stalePersonId }
}

/** How many steps back the breadcrumb keeps. Deep enough to retrace, short enough to read. */
export const FOCUS_HISTORY_LIMIT = 8

/**
 * Records a move to a new focal person.
 *
 * Re-focusing the person already in focus is not a move, so it does not
 * grow the trail. The oldest entries fall off the front once the limit is
 * reached — the recent path is what helps someone find their way back;
 * the whole session is not.
 */
export function pushFocusHistory(
  history: readonly string[],
  personId: string,
  limit: number = FOCUS_HISTORY_LIMIT,
): string[] {
  if (history[history.length - 1] === personId) return [...history]
  const next = [...history, personId]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/**
 * Steps back one focus. Returns the trail without its last entry and the
 * person that leaves in focus, or null at the start of the trail.
 */
export function popFocusHistory(history: readonly string[]): {
  history: string[]
  personId: string | null
} {
  if (history.length <= 1) return { history: [], personId: null }
  const next = history.slice(0, -1)
  return { history: next, personId: next[next.length - 1] ?? null }
}

/** Drops anyone who is no longer live, e.g. after a delete, keeping order. */
export function pruneFocusHistory(
  history: readonly string[],
  livePersonIds: ReadonlySet<string>,
): string[] {
  const pruned: string[] = []
  for (const personId of history) {
    // Also collapses the repeats that pruning can create.
    if (livePersonIds.has(personId) && pruned[pruned.length - 1] !== personId) pruned.push(personId)
  }
  return pruned
}
