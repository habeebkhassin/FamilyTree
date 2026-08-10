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
}
