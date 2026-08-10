import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import type { Node, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ParentLink, Person, Union } from '../../types'
import { buildFamilyGraph } from './graphAdapter'
import { layoutFamilyGraph } from './layout'
import { PersonNode } from './PersonNode'
import { UnionJunctionNode } from './UnionJunctionNode'
import { GenerationLabel } from './GenerationLabel'
import type { GenerationLabelNode } from './GenerationLabel'
import { GenerationBand } from './GenerationBand'
import type { GenerationBandNode } from './GenerationBand'
import { PERSON_NODE_SIZE, JUNCTION_SIZE, GENERATION_ROW_HEIGHT } from './layout'
import type { FamilyNode } from './types'
import './FamilyTreeCanvas.css'

interface FamilyTreeCanvasProps {
  people: Person[]
  parentLinks: ParentLink[]
  unions: Union[]
  onSelectPerson: (personId: string) => void
  onBack: () => void
  /**
   * Optional person to center the viewport on instead of the default
   * fit-everything view. Nothing calls this yet — it's the centering
   * mechanism Phase 4D prepares for a future "jump to this person in
   * the tree" entry point, without building that entry point itself.
   */
  focalPersonId?: string
}

// Stable across renders/instances — React Flow warns (and re-renders
// needlessly) if nodeTypes changes identity on every render.
const NODE_TYPES = {
  person: PersonNode,
  unionJunction: UnionJunctionNode,
  generationLabel: GenerationLabel,
  generationBand: GenerationBand,
}

const GENERATION_LABEL_WIDTH = 64
const GENERATION_LABEL_GAP = 16
const BAND_SIDE_PADDING = 24

function nodeWidth(node: FamilyNode): number {
  return node.type === 'unionJunction' ? JUNCTION_SIZE : PERSON_NODE_SIZE.width
}

/** One full-width tinted band per row, tiling seamlessly top-to-bottom (band height == row height) so alternating rows read as a subtle guide without any gap or overlap between them. */
function buildGenerationBands(nodes: FamilyNode[]): GenerationBandNode[] {
  if (nodes.length === 0) return []

  const rowExtent = new Map<number, { minX: number; maxRight: number }>()
  for (const node of nodes) {
    const { x, y } = node.position
    const right = x + nodeWidth(node)
    const current = rowExtent.get(y)
    if (!current) rowExtent.set(y, { minX: x, maxRight: right })
    else {
      current.minX = Math.min(current.minX, x)
      current.maxRight = Math.max(current.maxRight, right)
    }
  }

  const sortedRowYs = [...rowExtent.keys()].sort((a, b) => a - b)
  return sortedRowYs.map((y, index) => {
    const { minX, maxRight } = rowExtent.get(y) as { minX: number; maxRight: number }
    const left = minX - GENERATION_LABEL_WIDTH - GENERATION_LABEL_GAP - BAND_SIDE_PADDING
    const width = maxRight - left + BAND_SIDE_PADDING
    return {
      id: `generation-band:${y}`,
      type: 'generationBand',
      position: { x: left, y },
      selectable: false,
      draggable: false,
      style: { width, height: GENERATION_ROW_HEIGHT },
      data: { alternate: index % 2 === 1 },
    }
  })
}

/** One "Gen N" label per distinct row, placed left of that row's leftmost node — purely a render-time overlay, never part of the adapter/rank/layout graph itself. */
function buildGenerationLabels(nodes: FamilyNode[]): GenerationLabelNode[] {
  if (nodes.length === 0) return []

  const minXByRow = new Map<number, number>()
  for (const node of nodes) {
    const { x, y } = node.position
    const currentMin = minXByRow.get(y)
    if (currentMin === undefined || x < currentMin) minXByRow.set(y, x)
  }

  const sortedRowYs = [...minXByRow.keys()].sort((a, b) => a - b)
  return sortedRowYs.map((y, index) => ({
    id: `generation-label:${y}`,
    type: 'generationLabel',
    position: { x: (minXByRow.get(y) ?? 0) - GENERATION_LABEL_WIDTH - GENERATION_LABEL_GAP, y },
    selectable: false,
    draggable: false,
    data: { text: `Gen ${index + 1}` },
  }))
}

/** Centers the viewport on a single node when `focalPersonId` resolves to one currently on screen. Must render inside ReactFlowProvider. */
function FocalPersonCenterer({ focalPersonId, nodes }: { focalPersonId?: string; nodes: FamilyNode[] }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!focalPersonId) return
    if (!nodes.some((node) => node.id === focalPersonId)) return
    fitView({ nodes: [{ id: focalPersonId }], duration: 300, maxZoom: 1.1 })
  }, [focalPersonId, nodes, fitView])

  return null
}

export function FamilyTreeCanvas({
  people,
  parentLinks,
  unions,
  onSelectPerson,
  onBack,
  focalPersonId,
}: FamilyTreeCanvasProps) {
  const { nodes: rawNodes, edges } = useMemo(
    () => buildFamilyGraph(people, parentLinks, unions),
    [people, parentLinks, unions],
  )

  const [layoutedNodes, setLayoutedNodes] = useState<FamilyNode[]>([])
  const [isLayouting, setIsLayouting] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLayouting(true)
    layoutFamilyGraph(rawNodes, edges).then((positioned) => {
      if (cancelled) return
      setLayoutedNodes(positioned)
      setIsLayouting(false)
    })
    return () => {
      cancelled = true
    }
  }, [rawNodes, edges])

  const generationLabels = useMemo(() => buildGenerationLabels(layoutedNodes), [layoutedNodes])
  const generationBands = useMemo(() => buildGenerationBands(layoutedNodes), [layoutedNodes])
  const displayNodes = useMemo<Node[]>(
    () => [...generationBands, ...layoutedNodes, ...generationLabels],
    [generationBands, layoutedNodes, generationLabels],
  )

  // Junctions (and generation labels) are never Persons — selecting one
  // must never reach the People/Profile system.
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.type === 'person') {
      onSelectPerson(node.id)
    }
  }

  return (
    <div className="tree-canvas">
      <button type="button" className="tree-canvas__back" onClick={onBack}>
        ← Back to family tree
      </button>

      <div className="tree-canvas__viewport">
        {isLayouting && layoutedNodes.length === 0 ? (
          <p className="tree-canvas__status">Laying out your family tree…</p>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodeClick={handleNodeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView={!focalPersonId}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              <FocalPersonCenterer focalPersonId={focalPersonId} nodes={layoutedNodes} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>
    </div>
  )
}
