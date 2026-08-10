import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { FamilyGroup } from '../../types'
import { formatFamilyGroupOrigin, formatMemberCount } from '../familyGroups/familyGroupDisplay'
import type { FamilyGroupNode as FamilyGroupNodeType } from './types'
import './FamilyGroupNode.css'

/** "Gen 2–5" for a lineage covering several generations, or null when it sits on one. */
function formatGenerationSpan(minRank: number, maxRank: number): string | null {
  if (maxRank <= minRank) return null
  return `Gen ${minRank + 1}–${maxRank + 1}`
}

/**
 * A whole collapsed lineage drawn as one node. Deliberately built from a
 * different visual vocabulary than PersonNode — no avatar, dashed outline,
 * recessed rather than raised — so it reads as a container of people, not
 * as a person. It is never a genealogical participant: the edges touching
 * it mean "someone inside here is related to that", which is why it also
 * never opens a PersonProfile.
 *
 * A family normally spans several generations, and the node's box is as
 * tall as that span. Filling that whole box read as a huge empty card, so
 * only a compact header is drawn; the rest of the span is marked by a thin
 * rail down its left edge, with the range spelled out in words ("Gen 1–4")
 * so the span is stated rather than merely implied. Just the header is
 * clickable — the rail is decorative, so the empty region beside the
 * lineage is not a giant invisible button.
 *
 * The node only ever exists while its group is collapsed, so activating
 * it always means "expand" — hence aria-expanded is always false here,
 * and expanding removes the node entirely in favour of its members.
 */
export function FamilyGroupNode({ data }: NodeProps<FamilyGroupNodeType>) {
  const { familyGroup, memberCount, minRank, maxRank } = data
  const origin = formatFamilyGroupOrigin(familyGroup)
  const meta = [origin ? `Est. ${origin}` : null, formatMemberCount(memberCount)]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
  const span = formatGenerationSpan(minRank, maxRank)

  const onToggle = typeof data.onToggle === 'function' ? (data.onToggle as () => void) : undefined

  return (
    <div className="family-group-node">
      {/* Anchored to the container, so a child's edge leaves from the
          bottom of the lineage rather than from its top — which is both
          truer and a good deal shorter. */}
      <Handle type="target" position={Position.Top} />
      <button
        type="button"
        className="family-group-node__card nodrag"
        aria-expanded={false}
        aria-label={`${familyGroup.name}, family group, ${[meta, span].filter(Boolean).join(', ')}. Expand`}
        onClick={onToggle}
      >
        <span className="family-group-node__disclosure" aria-hidden="true">
          ▶
        </span>
        <span className="family-group-node__info">
          <span className="family-group-node__name">{familyGroup.name}</span>
          <span className="family-group-node__meta">{meta}</span>
          {span && <span className="family-group-node__span">{span}</span>}
        </span>
      </button>
      {span && <span className="family-group-node__rail" aria-hidden="true" />}
      <Handle type="source" position={Position.Bottom} />
    </div>
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
