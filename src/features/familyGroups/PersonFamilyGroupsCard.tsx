import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import type { FamilyGroup } from '../../types'
import './PersonFamilyGroupsCard.css'

export interface PersonFamilyGroupMembership {
  membershipId: string
  group: FamilyGroup
}

interface PersonFamilyGroupsCardProps {
  personId: string
  personName: string
  memberships: PersonFamilyGroupMembership[]
  availableGroups: FamilyGroup[]
  onAddToGroup: (familyGroupId: string) => void
  onRemoveFromGroup: (membershipId: string) => void
  onOpenGroup: (familyGroupId: string) => void
  onCreateGroup: () => void
}

/**
 * A person's FamilyGroup memberships, shown as its own card separate
 * from the "Family" card above it — FamilyGroup is an organizational
 * layer over the real genealogy, never a replacement for the parent,
 * sibling, partner, and child connections shown there.
 */
export function PersonFamilyGroupsCard({
  personId,
  personName,
  memberships,
  availableGroups,
  onAddToGroup,
  onRemoveFromGroup,
  onOpenGroup,
  onCreateGroup,
}: PersonFamilyGroupsCardProps) {
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const hasAnyGroupsInTree = memberships.length > 0 || availableGroups.length > 0

  function handleAddSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selectedGroupId) return
    onAddToGroup(selectedGroupId)
    setSelectedGroupId('')
  }

  return (
    <Card className="person-family-groups">
      <h2 className="person-family-groups__title">Family Groups</h2>
      <p className="person-family-groups__hint">
        Organizational groups {personName} belongs to — separate from the parent and partner connections above.
      </p>

      {memberships.length === 0 ? (
        <p className="person-family-groups__empty">Not part of any family group yet.</p>
      ) : (
        <ul className="person-family-groups__list">
          {memberships.map(({ membershipId, group }) => (
            <li key={membershipId} className="person-family-groups__item">
              <button type="button" className="person-family-groups__link" onClick={() => onOpenGroup(group.id)}>
                {group.name}
              </button>
              {group.originPersonId === personId && (
                <span className="person-family-groups__founder-badge">Founder</span>
              )}
              <button
                type="button"
                className="person-family-groups__remove"
                onClick={() => onRemoveFromGroup(membershipId)}
                aria-label={`Remove ${personName} from ${group.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {!hasAnyGroupsInTree && (
        <p className="person-family-groups__empty">
          No family groups in this tree yet.{' '}
          <button type="button" className="person-family-groups__create-link" onClick={onCreateGroup}>
            Create one
          </button>
          .
        </p>
      )}

      {hasAnyGroupsInTree && availableGroups.length === 0 && (
        <p className="person-family-groups__empty">Already part of every family group in this tree.</p>
      )}

      {availableGroups.length > 0 && (
        <form className="person-family-groups__add" onSubmit={handleAddSubmit}>
          <select
            className="person-family-groups__select"
            value={selectedGroupId}
            onChange={(event) => setSelectedGroupId(event.target.value)}
            aria-label="Add to family group"
          >
            <option value="">Add to a group…</option>
            {availableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" disabled={!selectedGroupId}>
            Add
          </Button>
        </form>
      )}
    </Card>
  )
}
