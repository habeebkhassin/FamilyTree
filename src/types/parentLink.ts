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
}
