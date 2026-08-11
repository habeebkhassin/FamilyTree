export type ParentRelationship = 'biological' | 'adopted' | 'step' | 'foster'

/**
 * A directed edge from a parent to a child. Sibling, half-sibling, and most
 * step relationships are intentionally NOT stored records — they are derived
 * from the set of ParentLinks in lib/relationships instead.
 */
export interface ParentLink {
  id: string
  familyTreeId: string
  parentId: string
  childId: string
  relationship: ParentRelationship
  createdAt: string
  updatedAt: string
  /**
   * Set when the record is deleted. Deletion is a tombstone rather than a
   * physical removal so the change log stays replayable and the record can
   * be restored; readers in lib/storage filter these out, so nothing above
   * the storage layer ever sees a tombstoned record.
   */
  deletedAt?: string
}
