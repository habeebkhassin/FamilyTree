import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Avatar } from '../../components/Avatar'
import type { PersonNode as PersonNodeType } from './types'
import './PersonNode.css'

function formatNodeYears(birthDate?: string, deathDate?: string): string | null {
  const birthYear = birthDate ? new Date(birthDate).getFullYear() : null
  const deathYear = deathDate ? new Date(deathDate).getFullYear() : null

  if (birthYear && deathYear) return `${birthYear} – ${deathYear}`
  if (birthYear) return `${birthYear} –`
  if (deathYear) return `– ${deathYear}`
  return null
}

export function PersonNode({ data, selected }: NodeProps<PersonNodeType>) {
  const { person } = data
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ')
  const years = formatNodeYears(person.birthDate, person.deathDate)
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
    <div className={classes}>
      <Handle type="target" position={Position.Top} />
      {/* View options can turn photos off; the initials go with them. */}
      {data.hidePhoto !== true && <Avatar name={fullName} size={36} />}
      <div className="person-node__info">
        {/* The ring is a shape, not only a colour — and this says the same
            thing to a screen reader, which perceives neither. */}
        {isFocal && <span className="person-node__sr-only">Currently viewing from</span>}
        {/*
          Two lines, because the card cannot get any wider. The name slot
          is 84px; on a family that shares a surname, 42 of 50 full names
          were ellipsised while every FIRST name fitted with room to spare.
          Widening the card was measured and rejected — it is what sets a
          couple block's width, so it widens every sibling fan-out and made
          long parent-child edges worse, not better.

          The given name leads because it is what distinguishes one person
          from another on this canvas; the family name sits under it,
          quieter, because in a family tree it is usually the part everyone
          shares. Both are still shown in full wherever they fit.
        */}
        <span className="person-node__name" title={fullName}>
          {person.firstName}
        </span>
        {person.lastName && (
          <span className="person-node__surname">{person.lastName}</span>
        )}
        {years && <span className="person-node__years">{years}</span>}
        {person.isPlaceholder && <span className="person-node__placeholder">Placeholder</span>}
      </div>
      {comparisonRole && (
        <span className="person-node__compare-badge" aria-hidden="true">
          {comparisonRole === 'a' ? '1' : '2'}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
