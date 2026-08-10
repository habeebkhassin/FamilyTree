import Dexie, { type Table } from 'dexie'
import type { FamilyTree, Person, ParentLink, Union, MediaRecord, FamilyGroup, FamilyGroupMember } from '../../types'

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
  }
}

export const db = new FamilyTreeDatabase()
