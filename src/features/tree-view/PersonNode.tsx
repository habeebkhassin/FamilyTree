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

  const classes = [
    'person-node',
    `person-node--${emphasis}`,
    selected ? 'person-node--selected' : null,
    comparisonRole ? 'person-node--comparing' : null,
    isFocal ? 'person-node--focal' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Top} />
      <Avatar name={fullName} size={36} />
      <div className="person-node__info">
        {/* The ring is a shape, not only a colour — and this says the same
            thing to a screen reader, which perceives neither. */}
        {isFocal && <span className="person-node__sr-only">Currently viewing from</span>}
        <span className="person-node__name">{fullName}</span>
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
