import type { Person } from '../../types'
import type { RelativeLinkKind } from '../../lib/storage'

export type PersonChanges = Partial<Omit<Person, 'id' | 'familyTreeId' | 'createdAt' | 'updatedAt'>>

export type RelationshipKind = 'parent' | 'child' | 'spouse' | 'sibling'

export const RELATIONSHIP_LABEL: Record<RelationshipKind, string> = {
  parent: 'parent',
  child: 'child',
  spouse: 'spouse or partner',
  sibling: 'sibling',
}

/**
 * Captures "who this new person is being added in relation to, and how"
 * at the moment a person is created or connected from a relationship
 * section. useFamilyGraph reads this (plus LinkExtras) to create the
 * matching ParentLink/Union.
 */
export interface RelativeIntent {
  kind: RelationshipKind
  anchorPersonId: string
  anchorName: string
}

/**
 * The extra, kind-specific detail collected on the "add relative" screen —
 * a ParentLink relationship type, Union status/date, or nothing (siblings
 * link through an anchor's existing parents, never a direct edge). Same
 * shape lib/storage's linkRelative expects, so it's aliased rather than
 * redefined — one source of truth.
 */
export type LinkExtras = RelativeLinkKind

/**
 * A person plus an optional short label (relationship type, union status).
 * `id` identifies the underlying edge (ParentLink/Union id), not the
 * person — the same person can appear more than once in a list (e.g. two
 * separate Unions with the same partner over time), so `person.id` alone
 * is not a safe list key.
 */
export interface RelationshipItem {
  id: string
  person: Person
  badge?: string
}
