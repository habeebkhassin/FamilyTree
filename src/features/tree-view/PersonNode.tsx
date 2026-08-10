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

  return (
    <div className={selected ? 'person-node person-node--selected' : 'person-node'}>
      <Handle type="target" position={Position.Top} />
      <Avatar name={fullName} size={36} />
      <div className="person-node__info">
        <span className="person-node__name">{fullName}</span>
        {years && <span className="person-node__years">{years}</span>}
        {person.isPlaceholder && <span className="person-node__placeholder">Placeholder</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
