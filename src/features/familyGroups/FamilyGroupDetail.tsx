import { useMemo, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { FamilyGroup, Person } from '../../types'
import { formatName, formatYearRange } from '../people/personDisplay'
import { PersonCard } from '../people/PersonCard'
import { formatFamilyGroupOrigin } from './familyGroupDisplay'
import './FamilyGroupDetail.css'

export interface FamilyGroupMembership {
  membershipId: string
  person: Person
}

interface FamilyGroupDetailProps {
  familyGroup: FamilyGroup
  memberships: FamilyGroupMembership[]
  candidates: Person[]
  originPerson?: Person
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onAddMember: (personId: string) => void
  onRemoveMember: (membershipId: string) => void
  onOpenPerson: (personId: string) => void
}

export function FamilyGroupDetail({
  familyGroup,
  memberships,
  candidates,
  originPerson,
  onBack,
  onEdit,
  onDelete,
  onAddMember,
  onRemoveMember,
  onOpenPerson,
}: FamilyGroupDetailProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [search, setSearch] = useState('')

  const origin = formatFamilyGroupOrigin(familyGroup)

  const filteredCandidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return candidates
    return candidates.filter((person) => formatName(person).toLowerCase().includes(term))
  }, [candidates, search])

  return (
    <div className="family-group-detail">
      <button type="button" className="family-group-detail__back" onClick={onBack}>
        ← Back to family groups
      </button>

      <Card className="family-group-detail__header">
        <div className="family-group-detail__identity">
          <p className="family-group-detail__eyebrow">Family Group</p>
          <h1 className="family-group-detail__name">{familyGroup.name}</h1>
          {familyGroup.notes && <p className="family-group-detail__description">{familyGroup.notes}</p>}
          {(origin || originPerson) && (
            <div className="family-group-detail__meta">
              {origin && <span>Established {origin}</span>}
              {originPerson && (
                <span>
                  Founded by{' '}
                  <button
                    type="button"
                    className="family-group-detail__origin-link"
                    onClick={() => onOpenPerson(originPerson.id)}
                  >
                    {formatName(originPerson)}
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="family-group-detail__actions">
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </div>
      </Card>

      <Card className="family-group-detail__members">
        <div className="family-group-detail__members-header">
          <h2 className="family-group-detail__section-title">
            Members <span className="family-group-detail__count">({memberships.length})</span>
          </h2>
          {candidates.length > 0 && (
            <button
              type="button"
              className="family-group-detail__add-toggle"
              onClick={() => {
                setIsAdding((current) => !current)
                setSearch('')
              }}
            >
              {isAdding ? 'Cancel' : '+ Add member'}
            </button>
          )}
        </div>

        {isAdding && (
          <div className="family-group-detail__add-panel">
            <input
              type="text"
              className="family-group-detail__search"
              placeholder="Search by name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {filteredCandidates.length === 0 ? (
              <p className="family-group-detail__empty">No one matches "{search}".</p>
            ) : (
              <div className="family-group-detail__grid">
                {filteredCandidates.map((person) => (
                  <PersonCard key={person.id} person={person} onClick={() => onAddMember(person.id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {memberships.length === 0 ? (
          // Suppressed while the add panel is open — the panel right above
          // already makes clear there's no one to remove yet, so repeating
          // it here would just be noise.
          !isAdding && <p className="family-group-detail__empty">No members yet.</p>
        ) : (
          <ul className="family-group-detail__list">
            {memberships.map(({ membershipId, person }) => {
              const years = formatYearRange(person)
              return (
                <li key={membershipId} className="family-group-detail__member">
                  <button
                    type="button"
                    className="family-group-detail__member-identity"
                    onClick={() => onOpenPerson(person.id)}
                  >
                    <Avatar name={formatName(person)} size={36} />
                    <span className="family-group-detail__member-info">
                      <span className="family-group-detail__member-name">{formatName(person)}</span>
                      {years && <span className="family-group-detail__member-years">{years}</span>}
                    </span>
                    {person.id === familyGroup.originPersonId && (
                      <span className="family-group-detail__founder-badge">Founder</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="family-group-detail__remove"
                    onClick={() => onRemoveMember(membershipId)}
                    aria-label={`Remove ${formatName(person)} from ${familyGroup.name}`}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${familyGroup.name}?`}
          message="This removes the group and its membership list only — the people in it, and every parent and partner connection in your tree, are unaffected."
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
