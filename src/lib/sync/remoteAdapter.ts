import type { ChangeEvent, SyncRecord, SyncEntity } from './changeTypes'

/**
 * The seam where this application will one day meet a server — Phase A.
 *
 * Nothing behind this interface exists yet, and nothing here performs any
 * network activity. It is declared now, while it is still free to change,
 * so that the shape of synchronisation is decided by the event model this
 * codebase already has rather than by whatever a vendor's SDK happens to
 * offer later.
 *
 *
 * TRANSPORT-NEUTRAL, AND DELIBERATELY IGNORANT
 * ────────────────────────────────────────────
 * This file must never learn the name of a database, a hosting provider,
 * an authentication scheme or a protocol. It speaks only in ChangeEvents,
 * records and sequence numbers — the vocabulary lib/sync already uses. An
 * implementation may be HTTP, a websocket, a local file or a test double;
 * none of that reaches this far.
 *
 * The point is not abstraction for its own sake. It is that everything
 * above this line — storage, the reconciler, the whole application — stays
 * testable with no server, exactly as it is today.
 *
 *
 * ONE SYNCHRONISATION MODEL, NOT TWO
 * ──────────────────────────────────
 * These operations are the ones the existing design already implies:
 *
 *   push       drain the outbox      — events are minted locally, carry a
 *                                      client id that doubles as an
 *                                      idempotency key, and are already
 *                                      queued in db.outbox
 *   pull       fetch what is new     — SyncState.lastServerSeq exists for
 *                                      precisely this, and the reconciler
 *                                      already orders by serverSeq
 *   bootstrap  first copy of a tree  — materialised records plus the
 *                                      sequence they are current as of
 *
 * Nothing else belongs here. Conflict resolution is reconciler.ts's job
 * and must not be duplicated in a transport; governance is not ordinary
 * content and must travel a privileged, server-validated path rather than
 * this one.
 *
 *
 * WHAT THE SERVER OWNS
 * ────────────────────
 * `serverSeq` and `recordedAt` are assigned by the server and by nothing
 * else. They are null on every event this application has ever written,
 * deliberately, because a client that invents them corrupts the only
 * authoritative ordering reconciliation has. An implementation of `push`
 * returns the accepted events carrying the values the server gave them; it
 * does not make them up.
 */

/** Where a tree has got to, as the server sees it. */
export interface RemoteCursor {
  /** Highest serverSeq the caller already holds. Null means "nothing yet". */
  lastServerSeq: number | null
}

/**
 * What the server did with the events it was offered.
 *
 * Accepted events come back with `serverSeq` and `recordedAt` filled in,
 * so the caller can store the authoritative copy over its local one and
 * clear the matching outbox rows.
 *
 * Re-offering an event the server already holds is not an error — the
 * event id is the idempotency key, and a retry after a dropped connection
 * must be safe. Such an event comes back in `accepted` with the sequence
 * it was originally given.
 */
export interface PushResult {
  accepted: ChangeEvent[]
  /**
   * Events the server declined, with a reason. Rejection is expected, not
   * exceptional: a viewer may have queued an edit offline, or a tree may
   * have been deleted since. The caller decides what to surface; this
   * interface only reports.
   */
  rejected: { eventId: string; reason: string }[]
}

export interface PullResult {
  /** Events after the requested cursor, in serverSeq order. */
  events: ChangeEvent[]
  /** The cursor to ask from next time. */
  cursor: RemoteCursor
  /**
   * True when the server had more than it was willing to send at once.
   * The caller pulls again from the new cursor rather than assuming it is
   * up to date — a sync that silently stops half way is worse than one
   * that takes two round trips.
   */
  hasMore: boolean
}

/**
 * A tree's current state, without its history.
 *
 * This is what a device joining a tree downloads. Replaying years of
 * events to draw a family that the server can simply describe would be
 * slower and no more correct — the log is for reconciling divergence, not
 * for loading.
 */
export interface BootstrapResult {
  records: { entity: SyncEntity; record: SyncRecord }[]
  /** The sequence these records are current as of. */
  cursor: RemoteCursor
}

export interface RemoteAdapter {
  /** Trees this caller may sync. Empty when there is no account or no server. */
  listTrees(): Promise<{ familyTreeId: string; name: string }[]>
  bootstrap(familyTreeId: string): Promise<BootstrapResult>
  pull(familyTreeId: string, cursor: RemoteCursor): Promise<PullResult>
  push(familyTreeId: string, events: ChangeEvent[]): Promise<PushResult>
}

/**
 * The adapter for having no server, which is every situation today.
 *
 * Not a stub to be replaced and deleted. It is what the application uses
 * when nobody is signed in, and it is what the tests use to prove that
 * everything above the seam works without one. It accepts nothing, returns
 * nothing, and — importantly — does not pretend: `push` reports its events
 * as rejected rather than quietly dropping them, so a caller can never
 * mistake "there is no server" for "the upload succeeded".
 */
export class NullRemoteAdapter implements RemoteAdapter {
  async listTrees(): Promise<{ familyTreeId: string; name: string }[]> {
    return []
  }

  async bootstrap(): Promise<BootstrapResult> {
    return { records: [], cursor: { lastServerSeq: null } }
  }

  async pull(): Promise<PullResult> {
    return { events: [], cursor: { lastServerSeq: null }, hasMore: false }
  }

  async push(_familyTreeId: string, events: ChangeEvent[]): Promise<PushResult> {
    return {
      accepted: [],
      rejected: events.map((event) => ({
        eventId: event.id,
        reason: 'No remote is configured; this device is local-only.',
      })),
    }
  }
}
