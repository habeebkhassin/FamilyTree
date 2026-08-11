import Dexie, { type Table } from 'dexie'
import type { FamilyTree, Person, ParentLink, Union, MediaRecord, FamilyGroup, FamilyGroupMember } from '../../types'
import type { ChangeEvent, OutboxEntry, SyncState } from '../sync/changeTypes'

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
  }
}

export const db = new FamilyTreeDatabase()
