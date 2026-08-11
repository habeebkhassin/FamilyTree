import type { ParentLink, Person, Union } from '../../types'

/**
 * The genealogical facts a relationship is derived from. Deliberately a
 * plain snapshot of records rather than a storage handle: the resolver is
 * a pure domain service, so it works identically over IndexedDB-loaded
 * data today and cloud-loaded data later.
 */
export interface RelationshipGraph {
  people: Person[]
  parentLinks: ParentLink[]
  unions: Union[]
}

/**
 * What A is to B. Neutral by design — gendered wording ("aunt" vs
 * "uncle") is a display concern applied later, and only when the person's
 * gender is actually recorded.
 */
export type RelationshipKind =
  | 'parent'
  | 'child'
  | 'adoptiveParent'
  | 'adoptedChild'
  | 'fosterParent'
  | 'fosterChild'
  | 'stepParent'
  | 'stepChild'
  | 'sibling'
  | 'halfSibling'
  | 'stepSibling'
  | 'grandparent'
  | 'grandchild'
  | 'greatGrandparent'
  | 'greatGrandchild'
  | 'auntUncle'
  | 'niblingByBlood'
  | 'auntUncleByMarriage'
  | 'niblingByMarriage'
  | 'cousin'
  | 'spouse'
  | 'partner'

/**
 * When a relationship held. Both ends are null when the stored facts
 * cannot support a date — the resolver never invents one.
 *
 * `end: null` means it still holds ("Present"), which is only meaningful
 * once you know the relationship exists at all.
 */
export interface RelationshipPeriod {
  start: string | null
  end: string | null
}

export interface ResolvedRelationship {
  /** Stable and deterministic, so a UI can key or persist a preference on it. */
  id: string
  /** What person A is to person B. */
  kind: RelationshipKind
  /** What person B is to person A. */
  reciprocalKind: RelationshipKind
  period: RelationshipPeriod
  /**
   * Person ids from A to B explaining the connection, e.g. for an aunt:
   * [ava, grandparent, habeebsParent, habeeb]. Always starts at A and
   * ends at B.
   */
  path: string[]
  /**
   * Which stored facts produced this. `union` relationships depend on a
   * Union record; `parentLink` ones on a ParentLink; `derived` ones on a
   * chain of both.
   */
  via: 'parentLink' | 'union' | 'derived'
}
