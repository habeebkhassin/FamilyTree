import type {
  BootstrapResult,
  PullResult,
  PushResult,
  RemoteAdapter,
  RemoteCursor,
} from '../sync/remoteAdapter'
import type { ChangeEvent, SyncEntity, SyncRecord } from '../sync/changeTypes'
import type { CloudTreeStore } from './cloudTrees'
import { fetchHeadSeq, pullEvents, pushEvents } from './supabaseSync'

/**
 * The event side of the wire.
 *
 * Separate from CloudTreeStore because they are two jobs: one reads and
 * writes whole trees, the other carries events. Both are injected, so the
 * adapter can be tested end to end without a network — reaching around an
 * injected collaborator to call a module directly would have made this
 * class untestable, which is how the split came to be noticed.
 */
export interface CloudSyncTransport {
  headSeq(familyTreeId: string): Promise<number | null>
  pull(familyTreeId: string, cursor: RemoteCursor): Promise<PullResult>
  push(familyTreeId: string, events: ChangeEvent[]): Promise<PushResult>
}

/** The real one, talking to Supabase. */
export const supabaseSyncTransport: CloudSyncTransport = {
  headSeq: fetchHeadSeq,
  pull: pullEvents,
  push: pushEvents,
}

/**
 * The cloud, behind the adapter the application already had — Milestone 2.
 *
 * RemoteAdapter was declared before any backend existed, precisely so
 * that arriving at one would not change the shape of synchronisation.
 * That held: two of its four methods are implemented here with no change
 * to the interface.
 *
 *   listTrees   what this account can reach
 *   bootstrap   one tree's current records plus the position they are
 *               current as of — materialised rows, never a replay
 *   pull        events after a cursor, in sequence order
 *   push        offer this device's queued events
 *
 * All four now, with the interface unchanged from the day it was written
 * against no backend at all.
 */
export class CloudRemoteAdapter implements RemoteAdapter {
  readonly #trees: CloudTreeStore
  readonly #sync: CloudSyncTransport

  constructor(trees: CloudTreeStore, sync: CloudSyncTransport = supabaseSyncTransport) {
    this.#trees = trees
    this.#sync = sync
  }

  async listTrees(): Promise<{ familyTreeId: string; name: string }[]> {
    const summaries = await this.#trees.listTrees()
    return summaries.map((summary) => ({ familyTreeId: summary.id, name: summary.name }))
  }

  async bootstrap(familyTreeId: string): Promise<BootstrapResult> {
    const contents = await this.#trees.fetchTree(familyTreeId)

    const records: { entity: SyncEntity; record: SyncRecord }[] = [
      { entity: 'familyTree', record: contents.familyTree },
      ...contents.people.map((record) => ({ entity: 'person' as const, record })),
      ...contents.parentLinks.map((record) => ({ entity: 'parentLink' as const, record })),
      ...contents.unions.map((record) => ({ entity: 'union' as const, record })),
      ...contents.familyGroups.map((record) => ({ entity: 'familyGroup' as const, record })),
      ...contents.familyGroupMembers.map((record) => ({
        entity: 'familyGroupMember' as const,
        record,
      })),
    ]

    /*
      Read AFTER the rows, deliberately.

      A sequence taken first could name a position later than the rows
      reflect if an event landed in between, and the device would then
      skip it forever. Taken afterwards, the worst case is a position
      slightly BEHIND the rows — which costs one harmless re-application
      of an event already reflected, because applying a remote event
      twice is the same as applying it once.
    */
    const head = await this.#sync.headSeq(familyTreeId)
    return { records, cursor: { lastServerSeq: head } }
  }

  async pull(familyTreeId: string, cursor: RemoteCursor): Promise<PullResult> {
    return this.#sync.pull(familyTreeId, cursor)
  }

  async push(familyTreeId: string, events: ChangeEvent[]): Promise<PushResult> {
    return this.#sync.push(familyTreeId, events)
  }
}
