import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api'
import { computeRanks } from './rank'
import type { FamilyEdge, FamilyNode } from './types'

const elk = new ELK()

const PERSON_NODE_WIDTH = 180
const PERSON_NODE_HEIGHT = 72
const JUNCTION_NODE_SIZE = 14
const LAYER_SPACING = 90
const ROW_SPACING = 48
const ROW_HEIGHT = PERSON_NODE_HEIGHT + LAYER_SPACING

/**
 * Layered, top-to-bottom layout — generations flow vertically. What
 * makes this genealogy-aware rather than a generic DAG layout is that
 * every node's final position is ultimately driven by ranks we compute
 * ourselves (rank.ts), not by ELK's own automatic layered ranking.
 *
 * This went through a couple of failed attempts worth recording, since
 * the failure mode is easy to re-introduce by accident:
 *   - `elk.partitioning.activate` + per-node `elk.partitioning.partition`
 *     (the mechanism the Phase 4B architecture review proposed) does
 *     NOT reliably collapse same-partition nodes onto one Y — empirically,
 *     with a Union's partner->junction/junction->partner edges in the
 *     graph, ELK still spread partner/junction/partner across three
 *     visibly different Y values, apparently still deferring to the
 *     edge-direction-implied ordering even within a shared partition.
 *   - `elk.layered.layering.layerId` with `layering.strategy: INTERACTIVE`
 *     (explicit per-node layer assignment) had the same problem.
 *
 * What actually works, used here:
 *   1. Let ELK run its normal automatic layered algorithm using every
 *      edge (including Union segments), so its crossing-minimization
 *      sees the full picture and produces a sane left-to-right node
 *      ordering — that part it's genuinely good at.
 *   2. Group nodes by OUR computed rank, and within each rank row,
 *      re-sort by ELK's own x (preserving the ordering it decided) and
 *      re-flow x positions sequentially with fixed spacing. This step is
 *      necessary, not cosmetic: ELK's x values were computed assuming
 *      its own (different) y-layering, so nodes we're forcibly placing
 *      onto the same row can end up with literally overlapping x ranges
 *      if ELK's x is used verbatim — re-flowing eliminates that.
 *   3. Y is `rank(node) * ROW_HEIGHT`, discarding ELK's y entirely.
 *
 * This guarantees "partners share a rank", "a child is strictly below
 * its parents", and "no two nodes in the same row overlap" as hard
 * facts rather than hoped-for side effects of layout options.
 *
 * `elk.layered` separates disconnected components automatically (a
 * family graph is rarely one connected tree) — unaffected by this
 * post-processing, since it only touches position after ELK has placed
 * everything.
 */
export async function layoutFamilyGraph(nodes: FamilyNode[], edges: FamilyEdge[]): Promise<FamilyNode[]> {
  if (nodes.length === 0) return []

  const ranks = computeRanks(nodes, edges)
  const widthByNodeId = new Map(nodes.map((node) => [node.id, node.type === 'unionJunction' ? JUNCTION_NODE_SIZE : PERSON_NODE_WIDTH]))

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_SPACING),
      'elk.spacing.nodeNode': String(ROW_SPACING),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map((node) => {
      const isJunction = node.type === 'unionJunction'
      return {
        id: node.id,
        width: isJunction ? JUNCTION_NODE_SIZE : PERSON_NODE_WIDTH,
        height: isJunction ? JUNCTION_NODE_SIZE : PERSON_NODE_HEIGHT,
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layouted = await elk.layout(elkGraph)

  const elkXById = new Map<string, number>()
  for (const child of layouted.children ?? []) {
    elkXById.set(child.id, child.x ?? 0)
  }

  const nodesByRank = new Map<number, FamilyNode[]>()
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0
    const row = nodesByRank.get(rank) ?? []
    row.push(node)
    nodesByRank.set(rank, row)
  }

  const finalPositionById = new Map<string, { x: number; y: number }>()
  for (const [rank, rowNodes] of nodesByRank) {
    const ordered = [...rowNodes].sort((a, b) => (elkXById.get(a.id) ?? 0) - (elkXById.get(b.id) ?? 0))
    let cursorX = 0
    for (const node of ordered) {
      finalPositionById.set(node.id, { x: cursorX, y: rank * ROW_HEIGHT })
      cursorX += (widthByNodeId.get(node.id) ?? PERSON_NODE_WIDTH) + ROW_SPACING
    }
  }

  return nodes.map((node) => ({
    ...node,
    position: finalPositionById.get(node.id) ?? { x: 0, y: 0 },
  })) as FamilyNode[]
}

export const PERSON_NODE_SIZE = { width: PERSON_NODE_WIDTH, height: PERSON_NODE_HEIGHT }
export const JUNCTION_SIZE = JUNCTION_NODE_SIZE
