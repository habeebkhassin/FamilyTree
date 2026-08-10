/**
 * Explicit many-to-many membership between a Person and a FamilyGroup. A
 * person is not limited to one FamilyGroup — they may have any number of
 * these rows (e.g. mother's family, father's family, spouse's family).
 *
 * Deliberately carries no `role` field: "founder" is fully represented by
 * FamilyGroup.originPersonId, and a second role field here would create
 * two possibly-conflicting sources of truth for the same fact. This also
 * deliberately does not model authorization/permissions — that belongs
 * to a future User/FamilyTree membership model, kept separate from this
 * purely genealogical membership record.
 */
export interface FamilyGroupMember {
  id: string
  familyTreeId: string
  familyGroupId: string
  personId: string
  createdAt: string
  updatedAt: string
}
