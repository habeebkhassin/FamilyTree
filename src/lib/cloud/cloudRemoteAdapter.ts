import type {
  BootstrapResult,
  PullResult,
  PushResult,
  RemoteAdapter,
  RemoteCursor,
} from '../sync/remoteAdapter'
import type { ChangeEvent, SyncEntity, SyncRecord } from '../sync/changeTypes'
import type { CloudTreeStore } from './cloudTrees'

/**
 * The cloud, behind the adapter the application already had — Milestone 2.
 *
 * RemoteAdapter was declared before any backend existed, precisely so
 * that arriving at one would not change the shape of synchronisation.
 * That held: two of its four methods are implemented here with no change
 * to the interface.
 *
 *   listTrees   what this account can reach
 *   bootstrap   one tree's current records, which is what a device
 *               joining downloads — the interface always said this is
 *               materialised rows rather than a replay of history
 *
 * The other two are not implemented, and they FAIL rather than return
 * nothing. A `pull` that answered "no events" would be indistinguishable
 * from "you are up to date", and a caller would believe it. Refusing is
 * the honest answer while there is no change log in the cloud to read.
 *
 * The cursor is null everywhere below for the same reason `serverSeq` is
 * null on every event this application has ever written: no server has
 * assigned one yet, and inventing a value would corrupt the ordering that
 * reconciliation will depend on.
 */
export class CloudRemoteAdapter implements RemoteAdapter {
  readonly #trees: CloudTreeStore

  constructor(trees: CloudTreeStore) {
    this.#trees = trees
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

    // Null, and honestly so: there is no change log in the cloud yet, so
    // there is no sequence these records could be "current as of".
    return { records, cursor: { lastServerSeq: null } }
  }

  async pull(_familyTreeId: string, _cursor: RemoteCursor): Promise<PullResult> {
    throw new Error('Downloading changes arrives with synchronisation, in a later milestone.')
  }

  async push(_familyTreeId: string, events: ChangeEvent[]): Promise<PushResult> {
    // Reported as rejected rather than thrown, matching NullRemoteAdapter:
    // a caller draining an outbox must be able to see that nothing was
    // accepted without the drain itself blowing up.
    return {
      accepted: [],
      rejected: events.map((event) => ({
        eventId: event.id,
        reason: 'Uploading changes arrives with synchronisation, in a later milestone.',
      })),
    }
  }
}
