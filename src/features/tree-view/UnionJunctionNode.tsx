import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { UnionStatus } from '../../types'
import { formatUnionStatusLabel } from '../people/personDisplay'
import type { UnionJunctionNode as UnionJunctionNodeType } from './types'
import './UnionJunctionNode.css'

/**
 * The marriage marker between two partners.
 *
 * Two interlocking rings in a filled disc, with the date above it — the
 * way a family tree has always said "these two, from this day". It
 * replaces a 10px diamond that was really only a hinge for the edges to
 * meet at; the bond between two people deserves to be visible, and the
 * date is one of the facts families most want to see.
 *
 * Still emphatically not a third person: no name, no card, and no click
 * target into the People system. It is the joint, drawn well.
 */

/**
 * Not every union is a marriage, so not every union says "married".
 *
 * Anything other than a current marriage or partnership is named,
 * because a date under a pair of rings with no other word on it reads as
 * a wedding — and for a divorce or a separation that would be the wrong
 * story told about somebody's family.
 */
const NEEDS_STATUS_LABEL: ReadonlySet<UnionStatus> = new Set<UnionStatus>([
  'engaged',
  'divorced',
  'separated',
  'widowed',
])

export function UnionJunctionNode({ data }: NodeProps<UnionJunctionNodeType>) {
  const emphasis = typeof data.emphasis === 'string' ? data.emphasis : 'primary'
  const status = data.status
  const startDate = typeof data.startDate === 'string' ? data.startDate : null

  // An absent date simply produces no caption — never a guess, and never
  // a placeholder dash, which reads as broken data rather than as a fact
  // nobody recorded.
  const dateText = startDate ? formatUnionDate(startDate) : null
  const statusText = NEEDS_STATUS_LABEL.has(status) ? formatUnionStatusLabel(status) : null
  const caption = [statusText, dateText].filter(Boolean).join(' · ')

  return (
    <div className={`union-junction union-junction--${emphasis}`}>
      {/*
        The bond arrives from one partner on the left and leaves to the
        other on the right; descent to their children leaves the bottom.
        Three anchors, so the couple reads as a horizontal pair with one
        line falling from between them — rather than as a junction box
        with wires converging on it.
      */}
      <Handle type="target" position={Position.Left} id="left-in" />
      <Handle type="source" position={Position.Left} id="left-out" />
      <Handle type="target" position={Position.Right} id="right-in" />
      <Handle type="source" position={Position.Right} id="right-out" />

      {caption && <span className="union-junction__caption">{caption}</span>}

      <span
        className="union-junction__marker"
        role="img"
        aria-label={caption ? `${formatUnionStatusLabel(status)}, ${caption}` : formatUnionStatusLabel(status)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.9">
            <circle cx="9.5" cy="12" r="5" />
            <circle cx="14.5" cy="12" r="5" />
          </g>
        </svg>
      </span>

      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  )
}

/**
 * Short and unambiguous — "12 Jun 1962" rather than a numeric date that
 * means two different things depending on which country you read it in.
 */
function formatUnionDate(date: string): string {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
