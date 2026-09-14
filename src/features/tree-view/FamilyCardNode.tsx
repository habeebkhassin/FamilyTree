import type { Node, NodeProps } from '@xyflow/react'
import './FamilyCardNode.css'

/**
 * A family branch, folded into one card.
 *
 * NOT A PERSON AND NOT A RELATIONSHIP. It stands in for the descendants
 * of somebody the tree is not currently about, and it exists so a
 * fifty-person family does not have to be drawn in full to be navigated.
 *
 * It carries NO handles, which is the mechanical guarantee behind that:
 * React Flow can only attach an edge to a handle, so no genealogy edge
 * can reach this card even by accident. It is positioned beneath the
 * person whose family it is, after layout, and the layout never sees it —
 * so the graph ELK is given is exactly the genealogy, with the folded
 * people absent and nothing invented in their place.
 */

export interface FamilyCardNodeData extends Record<string, unknown> {
  /** The person whose family this is. Never drawn on the card. */
  rootPersonId: string
  familyName: string
  memberCount: number
  /** `connected` gets the other family's violet; `home` the accent. */
  side: 'home' | 'connected'
  onOpen?: () => void
}

export type FamilyCard = Node<FamilyCardNodeData, 'familyCard'>

function memberLabel(count: number): string {
  return count === 1 ? '1 member' : `${count} members`
}

export function FamilyCardNode({ data }: NodeProps<FamilyCard>) {
  const { familyName, memberCount, side } = data

  return (
    <button
      type="button"
      className={`family-card family-card--${side}`}
      onClick={(event) => {
        event.stopPropagation()
        data.onOpen?.()
      }}
      aria-label={`${familyName}, ${memberLabel(memberCount)}. Open this family`}
    >
      <span className="family-card__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M10 20v-5h4v5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </span>
      <span className="family-card__name">{familyName}</span>
      <span className="family-card__count">{memberLabel(memberCount)}</span>
    </button>
  )
}
