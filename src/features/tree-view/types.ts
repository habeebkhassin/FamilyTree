import type { Edge, Node } from '@xyflow/react'
import type { FamilyGroup, ParentRelationship, Person, UnionStatus } from '../../types'

export interface PersonNodeData extends Record<string, unknown> {
  person: Person
}

export type PersonNode = Node<PersonNodeData, 'person'>

/**
 * Visual-only stand-in for a Union, used purely to give ELK's layered
 * layout a real node to anchor a "these two people share a rank" and
 * "their children hang off this point" constraint on. Never persisted,
 * never a Person, never reachable from the People/Profile system — see
 * graphAdapter.ts.
 */
export interface UnionJunctionNodeData extends Record<string, unknown> {
  unionId: string
  status: UnionStatus
}

export type UnionJunctionNode = Node<UnionJunctionNodeData, 'unionJunction'>

/**
 * Visual-only stand-in for a whole collapsed FamilyGroup, produced by
 * groupProjection.ts — never persisted, never a Person, and never a
 * genealogical participant. It exists purely so a collapsed lineage can
 * occupy one glyph instead of N person nodes; the underlying People,
 * ParentLinks, and Unions are untouched and reappear verbatim when the
 * group is expanded again.
 *
 * `memberCount` is the group's true membership size (what the user sees
 * on the Family Groups screen), which is NOT always the same as
 * `absorbedPersonIds.length` — a member who also belongs to another
 * group stays rendered as their own PersonNode (a "bridge"), so they are
 * counted but not absorbed.
 */
export interface FamilyGroupNodeData extends Record<string, unknown> {
  familyGroup: FamilyGroup
  memberCount: number
  /** Person ids whose nodes this group node stands in for, sorted for determinism. */
  absorbedPersonIds: string[]
  /**
   * The span of real generations the absorbed members occupy. A family
   * naturally spans several, so the container is drawn reaching across
   * `minRank`..`maxRank` rather than being flattened onto one row — a
   * FamilyGroup has no generation of its own.
   */
  minRank: number
  maxRank: number
}

export type FamilyGroupNode = Node<FamilyGroupNodeData, 'familyGroup'>

export type FamilyNode = PersonNode | UnionJunctionNode | FamilyGroupNode

/**
 * Added by groupProjection.ts when an edge has been re-pointed onto a
 * collapsed FamilyGroup node. Both fields are absent on every edge
 * buildFamilyGraph produces — an edge carrying them represents "there is
 * an underlying relationship between this group and this node", not a
 * relationship the group itself has.
 *
 * `underlyingEdgeIds` is the provenance trail: every projected edge must
 * name the real ParentLink/Union-segment edge ids it stands for, so it is
 * always provable that no genealogy was invented.
 */
interface ProjectedEdgeFields {
  boundary?: boolean
  underlyingEdgeIds?: string[]
}

export interface ParentChildEdgeData extends Record<string, unknown>, ProjectedEdgeFields {
  kind: 'parentChild'
  parentLinkId: string
  parentId: string
  childId: string
  relationship: ParentRelationship
}

/**
 * One Union renders as two segments meeting at its junction
 * (partnerA -> junction, junction -> partnerB) rather than one edge —
 * both segments carry the same underlying Union metadata.
 */
export interface UnionSegmentEdgeData extends Record<string, unknown>, ProjectedEdgeFields {
  kind: 'unionSegment'
  unionId: string
  status: UnionStatus
  startDate?: string
  endDate?: string
  segment: 'a' | 'b'
}

export type FamilyEdge = Edge<ParentChildEdgeData | UnionSegmentEdgeData>

export interface FamilyGraph {
  nodes: FamilyNode[]
  edges: FamilyEdge[]
}
