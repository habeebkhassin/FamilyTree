import type { Edge, Node } from '@xyflow/react'
import type { ParentRelationship, Person, UnionStatus } from '../../types'

export interface PersonNodeData extends Record<string, unknown> {
  person: Person
}

export type PersonNode = Node<PersonNodeData, 'person'>

export interface ParentChildEdgeData extends Record<string, unknown> {
  kind: 'parentChild'
  parentLinkId: string
  parentId: string
  childId: string
  relationship: ParentRelationship
}

export interface UnionEdgeData extends Record<string, unknown> {
  kind: 'union'
  unionId: string
  partnerAId: string
  partnerBId: string
  status: UnionStatus
  startDate?: string
  endDate?: string
}

export type FamilyEdge = Edge<ParentChildEdgeData | UnionEdgeData>

export interface FamilyGraph {
  nodes: PersonNode[]
  edges: FamilyEdge[]
}
