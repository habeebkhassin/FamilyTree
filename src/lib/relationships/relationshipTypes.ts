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
  /** Two or more generations up. The exact wording comes from `lineage.generations`. */
  | 'ancestor'
  | 'descendant'
  /** Sibling of an ancestor. `lineage.greats` says how far up. */
  | 'auntUncle'
  | 'nibling'
  | 'auntUncleByMarriage'
  | 'niblingByMarriage'
  /** `lineage.cousinDegree` and `lineage.removed` carry the degree and removal. */
  | 'cousin'
  | 'spouse'
  | 'partner'

/**
 * The measurements behind a generalized lineage relationship, so the
 * engine never needs a new kind for each further generation — a
 * great-great-great-grandparent is `ancestor` with `generations: 5`, and
 * the display layer composes the English.
 */
export interface LineageDistance {
  /** ancestor/descendant: 2 = grand, 3 = great-grand, 4 = great-great-grand. */
  generations?: number
  /** auntUncle/nibling: 0 = aunt/uncle, 1 = great-aunt/uncle, 2 = great-great-. */
  greats?: number
  /** cousin: 1 = first cousin, 2 = second cousin. */
  cousinDegree?: number
  /** cousin: 0 = not removed, 1 = once removed, 2 = twice removed. */
  removed?: number
}

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
  /** Present on generalized lineage kinds; absent on the rest. */
  lineage?: LineageDistance
  /**
   * The shared forebears this was measured through — the reason two people
   * can be first cousins on one side and second cousins on the other, and
   * what lets the UI say which connection it is talking about.
   */
  commonAncestorIds?: string[]
  /**
   * One route per shared forebear, in the same order as
   * `commonAncestorIds`, with `path` being the first of them.
   *
   * Double first cousins — two siblings who married two siblings — are
   * first cousins twice over through four different forebears. That is a
   * single relationship by name, so it stays a single result rather than
   * four identical ones, but the routes are genuinely distinct and are
   * kept here rather than thrown away.
   */
  paths?: string[][]
}
