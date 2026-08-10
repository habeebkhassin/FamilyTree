export type FamilyOriginPrecision = 'exact' | 'month' | 'year' | 'approximate' | 'unknown'

/**
 * An organizational/historical lineage layer over the real genealogy
 * graph (ParentLink/Union) — never a substitute for either. A person's
 * membership in a FamilyGroup is a separate, explicit fact recorded via
 * FamilyGroupMember, never a field on Person.
 */
export interface FamilyGroup {
  id: string
  familyTreeId: string
  name: string
  /**
   * The founder/origin person, if known. This is the SINGLE authoritative
   * source of truth for "who founded this family" — FamilyGroupMember
   * intentionally carries no competing role/founder field, so there is
   * exactly one place this fact lives.
   */
  originPersonId?: string
  establishedPrecision: FamilyOriginPrecision
  /** ISO date; meaningful when establishedPrecision is 'exact' | 'month' | 'year'. */
  establishedDate?: string
  /** Free-text display override, e.g. "1940s", "before the war" — mainly for 'approximate'. */
  establishedLabel?: string
  notes?: string
  createdAt: string
  updatedAt: string
}
