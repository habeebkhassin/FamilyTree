import type { ParentLink, Person, Union } from '../../types'
import type { FamilyEdge, FamilyGraph, PersonNode } from './types'

/**
 * Pure transform: existing Person/ParentLink/Union records -> React Flow
 * node/edge shapes. This is the ONLY place that shape gets produced —
 * nothing here writes to Dexie, and nothing downstream (layout, canvas)
 * should ever feed data back into it. Node ids are person.id and edge ids
 * are the underlying ParentLink/Union id, both stable across renders —
 * never generated per-render, so React Flow never loses identity for a
 * person or a relationship between refreshes.
 *
 * `x`/`y` are left at 0 here; the ELK layout pass (layout.ts) is what
 * assigns real positions. This function does no positioning of its own.
 */
export function buildFamilyGraph(people: Person[], parentLinks: ParentLink[], unions: Union[]): FamilyGraph {
  const nodes: PersonNode[] = people.map((person) => ({
    id: person.id,
    type: 'person',
    position: { x: 0, y: 0 },
    data: { person },
  }))

  const parentChildEdges: FamilyEdge[] = parentLinks.map((link) => ({
    id: link.id,
    source: link.parentId,
    target: link.childId,
    type: 'smoothstep',
    style: { stroke: 'var(--text-secondary)', strokeWidth: 1.5 },
    data: {
      kind: 'parentChild',
      parentLinkId: link.id,
      parentId: link.parentId,
      childId: link.childId,
      relationship: link.relationship,
    },
  }))

  // Every Union record becomes its own edge, even when it shares a pair
  // with another Union (remarriage/historical unions) — id is the Union's
  // own id, so multiple unions between the same two people never collapse
  // into one edge.
  const unionEdges: FamilyEdge[] = unions.map((union) => ({
    id: union.id,
    source: union.partnerAId,
    target: union.partnerBId,
    type: 'straight',
    style: { stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '4 4' },
    data: {
      kind: 'union',
      unionId: union.id,
      partnerAId: union.partnerAId,
      partnerBId: union.partnerBId,
      status: union.status,
      startDate: union.startDate,
      endDate: union.endDate,
    },
  }))

  return { nodes, edges: [...parentChildEdges, ...unionEdges] }
}
