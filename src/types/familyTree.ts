export interface FamilyTree {
  id: string
  name: string
  description?: string
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
