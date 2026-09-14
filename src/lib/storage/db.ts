import Dexie, { type Table } from 'dexie'
import type {
  FamilyTree,
  Person,
  ParentLink,
  Union,
  MediaRecord,
  MediaBlob,
  FamilyGroup,
  FamilyGroupMember,
} from '../../types'
import type { ChangeEvent, OutboxEntry, SyncState } from '../sync/changeTypes'
import type {
  FamilyTreeMember,
  GovernanceConfig,
  Invitation,
  PersonClaim,
} from '../policy/membershipTypes'
import type { MediaUpload } from '../media/mediaTypes'

/**
 * Exported (rather than kept module-private) only so tests can open a
 * second instance under a different database name — e.g. to seed a
 * pre-v2 database and verify the real version(1)->version(2) migration
 * below against it. Application code should still only ever import the
 * `db` singleton below, never construct this directly.
 */
export class FamilyTreeDatabase extends Dexie {
  familyTrees!: Table<FamilyTree, string>
  people!: Table<Person, string>
  parentLinks!: Table<ParentLink, string>
  unions!: Table<Union, string>
  media!: Table<MediaRecord, string>
  /** Local-only bytes. Never synced, never backed up. See MediaBlob. */
  mediaBlobs!: Table<MediaBlob, string>
  /** Photos waiting to reach object storage. See lib/media. */
  mediaUploads!: Table<MediaUpload, string>
  familyGroups!: Table<FamilyGroup, string>
  familyGroupMembers!: Table<FamilyGroupMember, string>
  /**
   * Phase 5A sync foundation. These live in the same database as the
   * records they describe so a mutation and its event can share one
   * transaction — the property that makes "record changed but event
   * missing" impossible. The Dexie handle is shared infrastructure; the
   * API layering (storage above sync) is enforced by the modules, not by
   * having two databases.
   */
  changeEvents!: Table<ChangeEvent, number>
  outbox!: Table<OutboxEntry, string>
  syncState!: Table<SyncState, string>
  /**
   * Phase 5B-2 governance. Kept in the same database so a multi-record
   * governance change can be one transaction, but deliberately OUTSIDE the
   * change log: none of these tables appears in SYNC_TABLES, and no
   * governance mutation calls recordChange.
   */
  familyTreeMembers!: Table<FamilyTreeMember, string>
  personClaims!: Table<PersonClaim, string>
  invitations!: Table<Invitation, string>
  governance!: Table<GovernanceConfig, string>

  constructor(name = 'FamilyTreeDatabase') {
    super(name)

    this.version(1).stores({
      familyTrees: 'id, updatedAt',
      people: 'id, familyTreeId',
      parentLinks: 'id, familyTreeId, parentId, childId',
      unions: 'id, familyTreeId, partnerAId, partnerBId',
      media: 'id, familyTreeId, kind, *personIds',
    })

    // Purely additive: two brand-new, optional tables. No .upgrade() is
    // needed since nothing about the version(1) stores changes shape —
    // existing People/ParentLinks/Unions/MediaRecords are untouched.
    // originPersonId is indexed so deletePerson (people.ts) can clear a
    // FamilyGroup's founder reference in one query when that person is
    // deleted. The compound `&[familyGroupId+personId]` index is unique,
    // enforcing "a person can't be added to the same group twice" at the
    // schema level as a backstop to the same check in familyGroups.ts.
    this.version(2).stores({
      familyGroups: 'id, familyTreeId, originPersonId',
      familyGroupMembers: 'id, familyTreeId, familyGroupId, personId, &[familyGroupId+personId]',
    })

    // Phase 5A: the local change log, plus tombstone support.
    //
    // Additive in the sense that matters — no existing row is rewritten,
    // no field is removed, and every record from a version(1) or (2)
    // database stays exactly as it was. The syncable stores are re-listed
    // only to add a `deletedAt` index so tombstoned rows can be filtered
    // cheaply; re-declaring a store replaces its index definition, not its
    // contents. Records written before this version simply have no
    // `deletedAt`, which reads as "not deleted" everywhere.
    //
    // A record with no `deletedAt` is live. That is why the field is
    // optional rather than defaulted: existing data needed no rewrite.
    this.version(3).stores({
      familyTrees: 'id, updatedAt, deletedAt',
      people: 'id, familyTreeId, deletedAt',
      parentLinks: 'id, familyTreeId, parentId, childId, deletedAt',
      unions: 'id, familyTreeId, partnerAId, partnerBId, deletedAt',
      familyGroups: 'id, familyTreeId, originPersonId, deletedAt',
      familyGroupMembers: 'id, familyTreeId, familyGroupId, personId, &[familyGroupId+personId], deletedAt',

      // clientSeq is the autoincrement primary key, which gives every
      // event a monotonic local order for free and inside the same
      // transaction as the mutation. `id` is unique because it doubles as
      // the upload idempotency key.
      changeEvents: '++clientSeq, &id, changeSetId, familyTreeId, entity, entityId, [entity+entityId], createdAt',
      outbox: 'eventId, familyTreeId, createdAt',
      syncState: 'familyTreeId',
    })

    // Phase 5B-2: governance. Four brand-new stores and nothing else — no
    // version(1)/(2)/(3) store is re-declared, so every existing
    // FamilyTree, Person, ParentLink, Union, FamilyGroup, membership and
    // change event is left exactly as it was and no upgrade function is
    // needed. A tree with no rows in any of these is an ungoverned local
    // tree, which is what every existing tree is and must remain.
    //
    // These stores are NOT part of the change log. Governance is not an
    // ordinary family fact — see governanceInternal.ts for why permissions
    // must never travel the content event stream.
    //
    // Indexes are deliberately not unique. A revoked membership or a
    // rejected claim keeps its row for the audit trail, and a unique
    // compound index would let one of those permanently occupy the slot
    // and block a later legitimate row. Uniqueness is enforced in the
    // storage modules instead, where "ignoring revoked and rejected rows"
    // can actually be expressed.
    this.version(4).stores({
      familyTreeMembers: 'id, familyTreeId, actorId, [familyTreeId+actorId], status',
      personClaims: 'id, familyTreeId, personId, actorId, [familyTreeId+actorId], [familyTreeId+personId]',
      invitations: 'id, familyTreeId, status, expiresAt',
      governance: 'familyTreeId',
    })

    // Milestone 3: two-way sync.
    //
    // Two stores gain an index and nothing else. `changeEvents` gains
    // `serverSeq` so the events a tree has already had accepted can be
    // found without scanning, and `outbox` gains `rejectedAt` so the
    // pending queue can be read without walking the refused ones.
    //
    // Additive in the way that matters: no row is rewritten and no field
    // is removed. Every event written before this has no
    // `basedOnServerSeq`, which reads as "this device knew nothing",
    // and every outbox entry has no `rejectedAt`, which reads as "still
    // pending" — both the correct meaning, so no data migration is
    // needed. That is the same property the deletedAt migration relied
    // on in version 3.
    this.version(5).stores({
      changeEvents:
        '++clientSeq, &id, changeSetId, familyTreeId, entity, entityId, [entity+entityId], createdAt, serverSeq',
      outbox: 'eventId, familyTreeId, createdAt, rejectedAt',
    })

    /*
      Milestone 5: photographs.

      The one migration in this project that MOVES data rather than only
      adding to the schema, and it is worth saying why.

      A MediaRecord used to carry its Blob inline, which is exactly why
      media was excluded from the change log — a complete before/after
      snapshot containing binary would have gone into every event and
      every sync payload. Rather than bend that rule, the bytes move: the
      record keeps the description and gains a path, and the bytes go to
      `mediaBlobs`, which is local-only and never synced or backed up.

      The upgrade below carries every existing blob across, so a photo
      somebody already has stays exactly where they can see it. Nothing is
      dropped: a record that had no blob simply has no row on the other
      side.

      `media` also gains `deletedAt`, because a syncable record tombstones
      rather than vanishing — that is what lets a deletion reach another
      device, and what stops a queued upload resurrecting a photo somebody
      removed.
    */
    this.version(6)
      .stores({
        media: 'id, familyTreeId, kind, *personIds, deletedAt',
        mediaBlobs: 'mediaId, familyTreeId',
        mediaUploads: 'mediaId, familyTreeId, state',
      })
      .upgrade(async (transaction) => {
        const media = transaction.table('media')
        const blobs = transaction.table('mediaBlobs')
        const now = new Date().toISOString()

        await media.toCollection().modify((record: MediaRecord & { blob?: Blob }) => {
          const { blob } = record
          if (!blob) return
          // Queued on the same transaction, so the move is atomic with
          // the field being cleared: there is no state where the bytes
          // are in neither place.
          void blobs.put({
            mediaId: record.id,
            familyTreeId: record.familyTreeId,
            blob,
            updatedAt: now,
          })
          delete record.blob
        })
      })
  }
}

export const db = new FamilyTreeDatabase()
