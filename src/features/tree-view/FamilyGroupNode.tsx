import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { FamilyGroup } from '../../types'
import { formatFamilyGroupOrigin, formatMemberCount } from '../familyGroups/familyGroupDisplay'
import type { FamilyGroupNode as FamilyGroupNodeType } from './types'
import './FamilyGroupNode.css'

/**
 * A whole collapsed lineage drawn as one node. Deliberately built from a
 * different visual vocabulary than PersonNode — no avatar, dashed border,
 * recessed rather than raised — so it reads as a container of people, not
 * as a person. It is never a genealogical participant: the edges touching
 * it mean "someone inside here is related to that", which is why it also
 * never opens a PersonProfile.
 *
 * The node only ever exists while its group is collapsed, so activating
 * it always means "expand" — hence aria-expanded is always false here,
 * and expanding removes the node entirely in favour of its members.
 *
 * The whole card is the button, which gives keyboard activation and a
 * focus ring for free and keeps the touch target well past 44px.
 */
export function FamilyGroupNode({ data }: NodeProps<FamilyGroupNodeType>) {
  const { familyGroup, memberCount } = data
  const origin = formatFamilyGroupOrigin(familyGroup)
  const meta = [origin ? `Est. ${origin}` : null, formatMemberCount(memberCount)]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  const onToggle = typeof data.onToggle === 'function' ? (data.onToggle as () => void) : undefined

  return (
    <button
      type="button"
      className="family-group-node nodrag"
      aria-expanded={false}
      aria-label={`${familyGroup.name}, family group, ${meta}. Expand`}
      onClick={onToggle}
    >
      <Handle type="target" position={Position.Top} />
      <span className="family-group-node__disclosure" aria-hidden="true">
        ▶
      </span>
      <span className="family-group-node__info">
        <span className="family-group-node__name">{familyGroup.name}</span>
        <span className="family-group-node__meta">{meta}</span>
      </span>
      <Handle type="source" position={Position.Bottom} />
    </button>
  )
}

export interface FamilyGroupHeaderData extends Record<string, unknown> {
  familyGroup: FamilyGroup
  memberCount: number
}

export type FamilyGroupHeaderNode = Node<FamilyGroupHeaderData, 'familyGroupHeader'>

/**
 * The same group control, shown while the group is EXPANDED. A collapsed
 * group has a node of its own; an expanded one does not — its members are
 * simply drawn as themselves — so without this there would be nothing to
 * click to collapse it again.
 *
 * Deliberately a small chip rather than a box drawn around the members:
 * a group's people are frequently scattered across the graph, and a
 * bounding container would visually claim everyone who happened to fall
 * inside it, including non-members. Computed at render time from the
 * members' laid-out positions, exactly like the generation bands.
 */
export function FamilyGroupHeader({ data }: NodeProps<FamilyGroupHeaderNode>) {
  const { familyGroup, memberCount } = data
  const onToggle = typeof data.onToggle === 'function' ? (data.onToggle as () => void) : undefined

  return (
    <button
      type="button"
      className="family-group-header nodrag"
      aria-expanded
      aria-label={`${familyGroup.name}, family group, ${formatMemberCount(memberCount)}. Collapse`}
      onClick={onToggle}
    >
      <span className="family-group-header__disclosure" aria-hidden="true">
        ▼
      </span>
      <span className="family-group-header__name">{familyGroup.name}</span>
      <span className="family-group-header__count">{formatMemberCount(memberCount)}</span>
    </button>
  )
}
