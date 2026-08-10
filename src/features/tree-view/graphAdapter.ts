import type { ParentLink, ParentRelationship, Person, Union, UnionStatus } from '../../types'
import { resolveUnionForParentLink } from './unionSelection'
import type { FamilyEdge, FamilyGraph, PersonNode, UnionJunctionNode } from './types'

function junctionId(unionId: string): string {
  return `junction:${unionId}`
}

// Biological and married are the unmarked default (no label) — matches
// the same "only call out the exception" philosophy already used for
// these fields in features/people/personDisplay.ts. Kept as a separate,
// small, local map rather than importing that module, so tree-view has
// no dependency on the people feature.
const PARENT_LINK_EDGE_LABEL: Partial<Record<ParentRelationship, string>> = {
  adopted: 'Adopted',
  step: 'Step',
  foster: 'Foster',
}

const UNION_EDGE_LABEL: Partial<Record<UnionStatus, string>> = {
  partnered: 'Partnered',
  engaged: 'Engaged',
  divorced: 'Divorced',
  separated: 'Separated',
  widowed: 'Widowed',
}

const EDGE_LABEL_STYLE = { fill: 'var(--text-secondary)', fontSize: 11 }
const EDGE_LABEL_BG_STYLE = { fill: 'var(--surface)', fillOpacity: 0.92 }

/**
 * Pure transform: existing Person/ParentLink/Union records -> React Flow
 * node/edge shapes, including visual-only Union junction nodes. This is
 * the ONLY place that shape gets produced — nothing here writes to
 * Dexie, and nothing downstream (rank pre-pass, ELK layout, canvas)
 * should ever feed data back into it.
 *
 * Junctions exist purely so ELK's layered layout has a real node to
 * anchor a "these two partners share a rank, and their children hang
 * off this point" constraint on (see rank.ts) — they are never Persons,
 * never persisted, and never reachable from the People/Profile system.
 *
 * Every ParentLink still maps to exactly one edge, carrying its own id
 * and relationship metadata untouched — junction routing only changes
 * which node an edge's `source` points at (the child's parent directly,
 * or that parent's Union junction when the child's other recorded
 * parent shares a Union with them — see unionSelection.ts). Two
 * ParentLinks are never merged into one edge.
 */
export function buildFamilyGraph(people: Person[], parentLinks: ParentLink[], unions: Union[]): FamilyGraph {
  const peopleById = new Map(people.map((person) => [person.id, person]))

  const personNodes: PersonNode[] = people.map((person) => ({
    id: person.id,
    type: 'person',
    position: { x: 0, y: 0 },
    data: { person },
  }))

  const junctionNodes: UnionJunctionNode[] = unions.map((union) => ({
    id: junctionId(union.id),
    type: 'unionJunction',
    position: { x: 0, y: 0 },
    selectable: false,
    data: { unionId: union.id, status: union.status },
  }))

  const linksByChild = new Map<string, ParentLink[]>()
  for (const link of parentLinks) {
    const list = linksByChild.get(link.childId) ?? []
    list.push(link)
    linksByChild.set(link.childId, list)
  }

  const parentChildEdges: FamilyEdge[] = parentLinks.map((link) => {
    const child = peopleById.get(link.childId)
    const siblingLinks = linksByChild.get(link.childId) ?? []
    const union = child ? resolveUnionForParentLink(link, siblingLinks, unions, child) : undefined
    const label = PARENT_LINK_EDGE_LABEL[link.relationship]

    return {
      id: link.id,
      source: union ? junctionId(union.id) : link.parentId,
      target: link.childId,
      type: 'smoothstep',
      style: { stroke: 'var(--text-secondary)', strokeWidth: 1.5 },
      ...(label && { label, labelStyle: EDGE_LABEL_STYLE, labelBgStyle: EDGE_LABEL_BG_STYLE }),
      data: {
        kind: 'parentChild',
        parentLinkId: link.id,
        parentId: link.parentId,
        childId: link.childId,
        relationship: link.relationship,
      },
    }
  })

  const unionSegmentEdges: FamilyEdge[] = unions.flatMap((union) => {
    const junction = junctionId(union.id)
    const baseData = {
      kind: 'unionSegment' as const,
      unionId: union.id,
      status: union.status,
      startDate: union.startDate,
      endDate: union.endDate,
    }
    const style = { stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '4 4' }
    // Only one segment carries the status label — showing it on both
    // sides of the same junction would just duplicate the text.
    const label = UNION_EDGE_LABEL[union.status]

    return [
      {
        id: `${union.id}#a`,
        source: union.partnerAId,
        target: junction,
        type: 'straight',
        style,
        ...(label && { label, labelStyle: EDGE_LABEL_STYLE, labelBgStyle: EDGE_LABEL_BG_STYLE }),
        data: { ...baseData, segment: 'a' as const },
      },
      {
        id: `${union.id}#b`,
        source: junction,
        target: union.partnerBId,
        type: 'straight',
        style,
        data: { ...baseData, segment: 'b' as const },
      },
    ]
  })

  return {
    nodes: [...personNodes, ...junctionNodes],
    edges: [...parentChildEdges, ...unionSegmentEdges],
  }
}
