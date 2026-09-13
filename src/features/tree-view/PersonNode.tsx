import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { PersonPhoto } from '../../components/PersonPhoto'
import { formatNodeMeta } from '../people/personDisplay'
import type { PersonNode as PersonNodeType } from './types'
import './PersonNode.css'

/**
 * A person, drawn as a portrait above a name.
 *
 * The card this replaces was horizontal — a small round avatar beside two
 * lines of text — which made the photograph an icon. Here the portrait is
 * the largest thing on the card and the first thing read, which is how
 * people actually recognise their relatives: by face before name.
 *
 * Everything else is deliberately thin. A tree card answers "who is
 * this?" and nothing more; dates, places and notes belong on the profile,
 * where there is room to read them.
 */
export function PersonNode({ data, selected }: NodeProps<PersonNodeType>) {
  const { person } = data
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ')
  const meta = formatNodeMeta(person)

  // Injected at render time while comparing two people — the graph itself
  // has no notion of a comparison, so this never reaches the adapter.
  const comparisonRole = typeof data.comparisonRole === 'string' ? data.comparisonRole : null
  // Likewise for the viewpoint: focus is a way of looking at the graph,
  // not a property of it, so it is injected at render time and never
  // reaches the adapter, the ranking, or the layout.
  const isFocal = data.isFocal === true
  // How loudly this card should read in the current view. Injected the
  // same way, for the same reason: it is a property of the viewpoint, not
  // of the person.
  const emphasis = typeof data.emphasis === 'string' ? data.emphasis : 'primary'
  // Set when this person shares a household with the focal person. A quiet
  // rail, not a container: it says "we live in the same family" without
  // drawing a box around anyone.
  const inFamilyUnit = typeof data.familyUnit === 'string'

  /**
   * How many of this person's children the current view does not reach,
   * and how to go and see them. Counted by the canvas from the real
   * ParentLinks against what the projection left out — never a guess, and
   * never a second relationship system.
   */
  const hiddenChildCount = typeof data.hiddenChildCount === 'number' ? data.hiddenChildCount : 0
  const onRevealChildren =
    typeof data.onRevealChildren === 'function' ? (data.onRevealChildren as () => void) : null

  const classes = [
    'person-node',
    `person-node--${emphasis}`,
    inFamilyUnit ? 'person-node--unit' : null,
    selected ? 'person-node--selected' : null,
    comparisonRole ? 'person-node--comparing' : null,
    isFocal ? 'person-node--focal' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="person-node__frame">
      <div className={classes}>
        {/*
          Four anchors, because a family tree draws two different kinds of
          line and they leave a card from different places. Descent
          arrives at the top and leaves from the bottom; a partnership
          runs sideways at the height of the portrait, which is what makes
          a couple read as standing side by side rather than as two nodes
          wired together.
        */}
        <Handle type="target" position={Position.Top} id="top" />
        {/* Both directions on each side: which partner sits left of the
            marker depends on where the layout put them, and a bond must
            always leave by the nearer edge. */}
        <Handle type="target" position={Position.Left} id="left-in" />
        <Handle type="source" position={Position.Left} id="left-out" />
        <Handle type="target" position={Position.Right} id="right-in" />
        <Handle type="source" position={Position.Right} id="right-out" />

        {/* View options can turn photos off; the initials go with them. */}
        {data.hidePhoto !== true && (
          <PersonPhoto person={person} size={56} className="person-node__photo" />
        )}

        <div className="person-node__info">
          {/* The ring is a shape, not only a colour — and this says the
              same thing to a screen reader, which perceives neither. */}
          {isFocal && <span className="person-node__sr-only">Currently viewing from</span>}

          {/*
            The whole name, allowed two lines.

            The previous card split it — given name large, surname small —
            because its name slot was 84px and full names would not fit.
            This card is 132px wide and lets the name wrap, so the split
            buys nothing any more, and a name is one thing rather than two.
          */}
          <span className="person-node__name" title={fullName}>
            {fullName}
          </span>

          {meta && (
            <span className="person-node__meta">
              <span aria-hidden="true">{meta.text}</span>
              <span className="person-node__sr-only">{meta.spoken}</span>
            </span>
          )}

          {person.isPlaceholder && <span className="person-node__placeholder">Placeholder</span>}
        </div>

        {comparisonRole && (
          <span className="person-node__compare-badge" aria-hidden="true">
            {comparisonRole === 'a' ? '1' : '2'}
          </span>
        )}

        <Handle type="source" position={Position.Bottom} id="bottom" />
      </div>

      {/*
        "2 more children" — the family continuing past the edge of this
        view, said out loud instead of silently dropped. It sits in the
        gap below the card rather than inside it, so it never competes
        with the person, and it is only ever drawn when the count is real.
      */}
      {hiddenChildCount > 0 && onRevealChildren && (
        <button
          type="button"
          className="person-node__more"
          onClick={(event) => {
            // The canvas reads a click on a person as "who is this?".
            // This button asks a different question.
            event.stopPropagation()
            onRevealChildren()
          }}
        >
          <span className="person-node__more-count">
            {hiddenChildCount} more {hiddenChildCount === 1 ? 'child' : 'children'}
          </span>
          <span className="person-node__more-hint">Tap to view</span>
        </button>
      )}
    </div>
  )
}
