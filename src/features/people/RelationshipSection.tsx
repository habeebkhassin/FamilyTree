import { PersonCard } from './PersonCard'
import type { RelationshipItem } from './types'
import './RelationshipSection.css'

interface RelationshipSectionProps {
  title: string
  items: RelationshipItem[]
  emptyMessage: string
  actionLabel: string
  onAdd: () => void
  onOpenPerson: (personId: string) => void
}

export function RelationshipSection({
  title,
  items,
  emptyMessage,
  actionLabel,
  onAdd,
  onOpenPerson,
}: RelationshipSectionProps) {
  return (
    <div className="relationship-section">
      <div className="relationship-section__header">
        <h3 className="relationship-section__title">{title}</h3>
        <button type="button" className="relationship-section__add" onClick={onAdd}>
          + {actionLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="relationship-section__empty">{emptyMessage}</p>
      ) : (
        <div className="relationship-section__grid">
          {items.map((item) => (
            <PersonCard
              key={item.id}
              person={item.person}
              badge={item.badge}
              onClick={() => onOpenPerson(item.person.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
