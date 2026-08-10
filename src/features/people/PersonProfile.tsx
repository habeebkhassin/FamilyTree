import { useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { Person } from '../../types'
import { formatFullDate, formatName } from './personDisplay'
import { RelationshipSection } from './RelationshipSection'
import type { RelationshipItem, RelationshipKind } from './types'
import './PersonProfile.css'

interface PersonProfileProps {
  person: Person
  parents: RelationshipItem[]
  siblings: RelationshipItem[]
  partners: RelationshipItem[]
  children: RelationshipItem[]
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onAddRelative: (kind: RelationshipKind) => void
  onOpenPerson: (personId: string) => void
}

export function PersonProfile({
  person,
  parents,
  siblings,
  partners,
  children,
  onBack,
  onEdit,
  onDelete,
  onAddRelative,
  onOpenPerson,
}: PersonProfileProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const fullName = formatName(person)

  return (
    <div className="person-profile">
      <button type="button" className="person-profile__back" onClick={onBack}>
        ← Back to family tree
      </button>

      <Card className="person-profile__header">
        <Avatar name={fullName} size={72} />
        <div className="person-profile__identity">
          <h1 className="person-profile__name">{fullName}</h1>
          {person.isPlaceholder && <span className="person-profile__badge">Placeholder</span>}
          <div className="person-profile__dates">
            {person.birthDate && <span>Born {formatFullDate(person.birthDate)}</span>}
            {person.deathDate && <span>Died {formatFullDate(person.deathDate)}</span>}
          </div>
        </div>
        <div className="person-profile__actions">
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </div>
      </Card>

      {person.notes && (
        <Card className="person-profile__notes">
          <h2 className="person-profile__section-title">Notes</h2>
          <p>{person.notes}</p>
        </Card>
      )}

      <Card className="person-profile__family">
        <h2 className="person-profile__section-title">Family</h2>

        <RelationshipSection
          title="Parents"
          items={parents}
          emptyMessage="No parents added yet."
          actionLabel="Add parent"
          onAdd={() => onAddRelative('parent')}
          onOpenPerson={onOpenPerson}
        />
        <RelationshipSection
          title="Siblings"
          items={siblings}
          emptyMessage="No siblings added yet."
          actionLabel="Add sibling"
          onAdd={() => onAddRelative('sibling')}
          onOpenPerson={onOpenPerson}
        />
        <RelationshipSection
          title="Spouse / Partners"
          items={partners}
          emptyMessage="No spouse or partner added yet."
          actionLabel="Add spouse or partner"
          onAdd={() => onAddRelative('spouse')}
          onOpenPerson={onOpenPerson}
        />
        <RelationshipSection
          title="Children"
          items={children}
          emptyMessage="No children added yet."
          actionLabel="Add child"
          onAdd={() => onAddRelative('child')}
          onOpenPerson={onOpenPerson}
        />
      </Card>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${fullName}?`}
          message="This removes them from your family tree. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false)
            onDelete()
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
