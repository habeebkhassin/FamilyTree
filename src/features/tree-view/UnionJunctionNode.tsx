import { Handle, Position } from '@xyflow/react'
import './UnionJunctionNode.css'

/**
 * Deliberately minimal — a small diamond, not a card, so it never reads
 * as a third "person" between two partners. Purely a visual anchor for
 * the Union's two edge segments and its children's edges; carries no
 * interactive affordance into the People/Profile system.
 */
export function UnionJunctionNode() {
  return (
    <div className="union-junction" aria-hidden="true">
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
