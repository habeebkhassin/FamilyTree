import type { NodeProps, Node } from '@xyflow/react'
import './GenerationLabel.css'

export interface GenerationLabelData extends Record<string, unknown> {
  text: string
}

export type GenerationLabelNode = Node<GenerationLabelData, 'generationLabel'>

/**
 * Purely a row indicator — derived in FamilyTreeCanvas from already-laid-
 * out node positions, never part of buildFamilyGraph's output. The
 * adapter/rank/layout pipeline has no concept of this; it's added only
 * at render time, same way the graph never learns about it.
 */
export function GenerationLabel({ data }: NodeProps<GenerationLabelNode>) {
  return <div className="generation-label">{data.text}</div>
}
