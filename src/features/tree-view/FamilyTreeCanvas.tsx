import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ParentLink, Person, Union } from '../../types'
import { buildFamilyGraph } from './graphAdapter'
import { layoutFamilyGraph } from './layout'
import { PersonNode } from './PersonNode'
import type { PersonNode as PersonNodeType } from './types'
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
const NODE_TYPES = { person: PersonNode }

export function FamilyTreeCanvas({ people, parentLinks, unions, onSelectPerson, onBack }: FamilyTreeCanvasProps) {
  const { nodes: rawNodes, edges } = useMemo(
    () => buildFamilyGraph(people, parentLinks, unions),
    [people, parentLinks, unions],
  )

  const [layoutedNodes, setLayoutedNodes] = useState<PersonNodeType[]>([])
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

  const handleNodeClick: NodeMouseHandler<PersonNodeType> = (_event, node) => {
    onSelectPerson(node.id)
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
              nodes={layoutedNodes}
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
