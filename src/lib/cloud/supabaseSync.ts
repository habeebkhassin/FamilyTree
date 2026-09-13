import type { ChangeEvent, SyncEntity, SyncRecord } from '../sync/changeTypes'
import type { PullResult, PushResult, RemoteCursor } from '../sync/remoteAdapter'
import { getSupabaseClient } from './supabaseClient'

/**
 * Push and pull, through Supabase — Milestone 3.
 *
 * Both sides of the wire, and nothing else: no merging, no cursor
 * bookkeeping, no retry policy. Those belong to the sync engine, which
 * works against the RemoteAdapter interface and does not know this file
 * exists.
 *
 * Every value the server owns — serverSeq, recordedAt, who pushed — is
 * read back from the server's answer rather than assumed. Nothing here
 * fills one in.
 */

/** How many events to send or ask for at once. Large enough that a normal
    session is one round trip, small enough that a long-offline device does
    not build a single enormous request. */
export const SYNC_BATCH_SIZE = 200

interface PushRow {
  event_id: string
  status: 'accepted' | 'already_processed' | 'rejected'
  server_seq: string | number | null
  recorded_at: string | null
  reason: string | null
}

interface EventRow {
  server_seq: string | number
  id: string
  tree_id: string
  change_set_id: string
  actor_id: string | null
  entity: string
  entity_id: string
  op: string
  before: unknown
  after: unknown
  created_at: string
  based_on_server_seq: string | number | null
  recorded_at: string
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A stored row back into the application's own event shape. */
function toChangeEvent(row: EventRow): ChangeEvent {
  return {
    // Local ordering belongs to the device that wrote the event. A row
    // pulled from the server has none of ours, and inventing one would be
    // meaningless — the reconciler never reads clientSeq for exactly this
    // reason. Dexie assigns a real one when the event is stored.
    clientSeq: 0,
    id: row.id,
    changeSetId: row.change_set_id,
    familyTreeId: row.tree_id,
    actorId: row.actor_id,
    entity: row.entity as SyncEntity,
    entityId: row.entity_id,
    op: row.op as ChangeEvent['op'],
    before: (row.before ?? null) as SyncRecord | null,
    after: (row.after ?? null) as SyncRecord | null,
    createdAt: new Date(row.created_at).toISOString(),
    serverSeq: toNumber(row.server_seq),
    recordedAt: new Date(row.recorded_at).toISOString(),
    basedOnServerSeq: toNumber(row.based_on_server_seq),
  }
}

function unwrap<T>(result: { data: unknown; error: { message: string } | null }, what: string): T {
  // A failure stays a failure. Turning one into an empty list would let a
  // caller record progress it never made — the single worst thing a sync
  // layer can do.
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data as T
}

/**
 * Offer events to the server.
 *
 * The response says what happened to each one, because an empty
 * successful reply must never be read as "all accepted". An event the
 * server already held comes back as accepted carrying the sequence it was
 * originally given — that is what makes a retry after a dropped
 * connection safe, and it is why the id is minted on the client and never
 * reassigned.
 */
export async function pushEvents(familyTreeId: string, events: ChangeEvent[]): Promise<PushResult> {
  if (events.length === 0) return { accepted: [], rejected: [] }

  const client = await getSupabaseClient()
  const rows = unwrap<PushRow[]>(
    await client.rpc('push_change_events', { p_tree_id: familyTreeId, p_events: events }),
    'Could not upload your changes',
  )

  const byId = new Map(events.map((event) => [event.id, event]))
  const accepted: ChangeEvent[] = []
  const rejected: { eventId: string; reason: string }[] = []

  for (const row of rows ?? []) {
    const original = byId.get(row.event_id)
    if (!original) continue

    if (row.status === 'rejected') {
      rejected.push({ eventId: row.event_id, reason: row.reason ?? 'The server refused this change.' })
      continue
    }

    // Accepted now, or accepted earlier and recognised by its id. Both
    // are successes and both carry the authoritative values.
    accepted.push({
      ...original,
      serverSeq: toNumber(row.server_seq),
      recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : null,
    })
  }

  return { accepted, rejected }
}

/**
 * Ask for everything after a cursor.
 *
 * Ordered strictly by sequence, and `hasMore` says whether the server had
 * more than it was willing to send — the caller pulls again rather than
 * assuming it is up to date.
 */
export async function pullEvents(
  familyTreeId: string,
  cursor: RemoteCursor,
  limit = SYNC_BATCH_SIZE,
): Promise<PullResult> {
  const client = await getSupabaseClient()
  const after = cursor.lastServerSeq ?? 0

  const rows = unwrap<EventRow[]>(
    await client.rpc('pull_change_events', {
      p_tree_id: familyTreeId,
      p_after: after,
      p_limit: limit,
    }),
    'Could not download the latest changes',
  )

  const events = (rows ?? []).map(toChangeEvent)
  const highest = events.reduce<number | null>(
    (seq, event) => (event.serverSeq !== null && (seq === null || event.serverSeq > seq) ? event.serverSeq : seq),
    cursor.lastServerSeq,
  )

  return {
    events,
    cursor: { lastServerSeq: highest },
    // Exactly a full page means there may be another. One extra empty
    // round trip is a far better failure than stopping half way and
    // recording the cursor as though everything had arrived.
    hasMore: events.length === limit,
  }
}

/** The highest sequence this tree has, for bootstrap to record as its position. */
export async function fetchHeadSeq(familyTreeId: string): Promise<number | null> {
  const client = await getSupabaseClient()
  const value = unwrap<string | number | null>(
    await client.rpc('tree_head_seq', { p_tree_id: familyTreeId }),
    'Could not read the family tree position',
  )
  return toNumber(value ?? null)
}
