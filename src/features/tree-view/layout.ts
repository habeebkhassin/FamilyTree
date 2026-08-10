import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api'
import type { FamilyEdge, PersonNode } from './types'

const elk = new ELK()

const NODE_WIDTH = 180
const NODE_HEIGHT = 72

/**
 * Layered, top-to-bottom layout — generations flow vertically, parents
 * above children. `elk.layered` separates disconnected components
 * automatically (a family graph is rarely one connected tree — multiple
 * roots and unrelated branches are the norm, not an edge case), so no
 * manual component detection is needed here.
 *
 * Known limitation: Union edges are fed to ELK as ordinary edges, so a
 * partner isn't guaranteed to land on the exact same row as their spouse
 * — layered algorithms don't have a native "same rank" concept the way
 * this would need. Good enough for Phase 4A (the graph is structurally
 * correct); a same-rank pass for partners is a later visual-polish step.
 */
export async function layoutFamilyGraph(nodes: PersonNode[], edges: FamilyEdge[]): Promise<PersonNode[]> {
  if (nodes.length === 0) return []

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '48',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layouted = await elk.layout(elkGraph)

  const positionById = new Map<string, { x: number; y: number }>()
  for (const child of layouted.children ?? []) {
    positionById.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? { x: 0, y: 0 },
  }))
}

export const PERSON_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT }
