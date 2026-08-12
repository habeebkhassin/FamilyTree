import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { UnionJunctionNode as UnionJunctionNodeType } from './types'
import './UnionJunctionNode.css'

/**
 * Deliberately minimal — a small diamond, not a card, so it never reads
 * as a third "person" between two partners. Purely a visual anchor for
 * the Union's two edge segments and its children's edges; carries no
 * interactive affordance into the People/Profile system.
 *
 * It is the hinge of a family unit: the point where a couple's bond meets
 * the descent line to their children. Phase 5C-3 lets it fade with the
 * rest of its family so a distant couple's bond never out-shouts a nearby
 * one — the glyph itself is unchanged.
 */
export function UnionJunctionNode({ data }: NodeProps<UnionJunctionNodeType>) {
  const emphasis = typeof data.emphasis === 'string' ? data.emphasis : 'primary'

  return (
    <div className={`union-junction union-junction--${emphasis}`} aria-hidden="true">
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
