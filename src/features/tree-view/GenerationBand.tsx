import type { NodeProps, Node } from '@xyflow/react'
import './GenerationBand.css'

export interface GenerationBandData extends Record<string, unknown> {
  alternate: boolean
}

export type GenerationBandNode = Node<GenerationBandData, 'generationBand'>

/**
 * A full-width, low-opacity row guide behind a generation's nodes —
 * purely a render-time overlay computed from already-laid-out positions
 * in FamilyTreeCanvas, same as GenerationLabel. Never part of the
 * adapter/rank/layout graph, never interactive.
 */
export function GenerationBand({ data }: NodeProps<GenerationBandNode>) {
  return <div className={`generation-band${data.alternate ? ' generation-band--alt' : ''}`} />
}
