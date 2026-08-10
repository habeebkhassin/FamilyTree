import type { Person } from '../../types'
import { Avatar } from '../../components/Avatar'
import { formatName, formatYearRange } from './personDisplay'
import './PersonCard.css'

interface PersonCardProps {
  person: Person
  badge?: string
  onClick?: () => void
}

export function PersonCard({ person, badge, onClick }: PersonCardProps) {
  const fullName = formatName(person)
  const meta = person.isPlaceholder ? 'Placeholder' : formatYearRange(person)

  return (
    <button type="button" className="person-card" onClick={onClick}>
      <Avatar name={fullName} />
      <span className="person-card__name">{fullName}</span>
      {meta && (
        <span
          className={
            person.isPlaceholder ? 'person-card__meta person-card__meta--placeholder' : 'person-card__meta'
          }
        >
          {meta}
        </span>
      )}
      {badge && <span className="person-card__badge">{badge}</span>}
    </button>
  )
}
