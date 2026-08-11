export type UnionStatus =
  | 'married'
  | 'partnered'
  | 'engaged'
  | 'divorced'
  | 'separated'
  | 'widowed'

/**
 * An edge between two partners. A person can appear in multiple Unions
 * over time (remarriage, prior partners) — there is no single "spouse"
 * field on Person, since that would go stale.
 */
export interface Union {
  id: string
  familyTreeId: string
  partnerAId: string
  partnerBId: string
  status: UnionStatus
  startDate?: string
  endDate?: string
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
