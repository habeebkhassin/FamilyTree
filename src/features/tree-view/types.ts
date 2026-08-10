import type { Edge, Node } from '@xyflow/react'
import type { ParentRelationship, Person, UnionStatus } from '../../types'

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

export type FamilyNode = PersonNode | UnionJunctionNode

export interface ParentChildEdgeData extends Record<string, unknown> {
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
export interface UnionSegmentEdgeData extends Record<string, unknown> {
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
