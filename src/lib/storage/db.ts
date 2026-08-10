import Dexie, { type Table } from 'dexie'
import type { FamilyTree, Person, ParentLink, Union, MediaRecord } from '../../types'

/**
 * Internal to lib/storage — nothing outside this folder should import
 * this class directly. Everything else goes through the per-entity
 * modules (familyTrees.ts, people.ts, relationships.ts, media.ts).
 */
class FamilyTreeDatabase extends Dexie {
  familyTrees!: Table<FamilyTree, string>
  people!: Table<Person, string>
  parentLinks!: Table<ParentLink, string>
  unions!: Table<Union, string>
  media!: Table<MediaRecord, string>

  constructor() {
    super('FamilyTreeDatabase')

    this.version(1).stores({
      familyTrees: 'id, updatedAt',
      people: 'id, familyTreeId',
      parentLinks: 'id, familyTreeId, parentId, childId',
      unions: 'id, familyTreeId, partnerAId, partnerBId',
      media: 'id, familyTreeId, kind, *personIds',
    })
  }
}

export const db = new FamilyTreeDatabase()
