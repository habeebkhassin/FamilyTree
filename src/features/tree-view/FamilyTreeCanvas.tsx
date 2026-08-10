import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { Node, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ParentLink, Person, Union } from '../../types'
import { buildFamilyGraph } from './graphAdapter'
import { layoutFamilyGraph } from './layout'
import { PersonNode } from './PersonNode'
import { UnionJunctionNode } from './UnionJunctionNode'
import { GenerationLabel } from './GenerationLabel'
import type { GenerationLabelNode } from './GenerationLabel'
import type { FamilyNode } from './types'
import './FamilyTreeCanvas.css'

interface FamilyTreeCanvasProps {
  people: Person[]
  parentLinks: ParentLink[]
  unions: Union[]
  onSelectPerson: (personId: string) => void
  onBack: () => void
}

// Stable across renders/instances — React Flow warns (and re-renders
// needlessly) if nodeTypes changes identity on every render.
const NODE_TYPES = { person: PersonNode, unionJunction: UnionJunctionNode, generationLabel: GenerationLabel }

const GENERATION_LABEL_WIDTH = 64
const GENERATION_LABEL_GAP = 16

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

export function FamilyTreeCanvas({ people, parentLinks, unions, onSelectPerson, onBack }: FamilyTreeCanvasProps) {
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
  const displayNodes = useMemo<Node[]>(() => [...layoutedNodes, ...generationLabels], [layoutedNodes, generationLabels])

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
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>
    </div>
  )
}
