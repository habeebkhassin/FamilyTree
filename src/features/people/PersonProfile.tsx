import { useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { FamilyGroup } from '../../types'
import type { Person } from '../../types'
import { PersonFamilyGroupsCard } from '../familyGroups/PersonFamilyGroupsCard'
import type { PersonFamilyGroupMembership } from '../familyGroups/PersonFamilyGroupsCard'
import type { PolicyDecision } from '../../lib/policy/can'
import { describePolicyReason } from '../policy/policyMessages'
import { PersonClaimCard } from './PersonClaimCard'
import { formatFullDate, formatName } from './personDisplay'
import { RelationshipSection } from './RelationshipSection'
import type { RelationshipItem, RelationshipKind } from './types'
import './PersonProfile.css'

/**
 * What the policy layer has decided about this person, resolved by the
 * caller through usePolicy. The profile renders the decision; it never
 * reasons about roles itself.
 */
export interface PersonPolicyView {
  canEdit: PolicyDecision
  canDelete: PolicyDecision
  /** Whether this device's actor has said this person is them. */
  isClaimedByYou: boolean
  /** Whether somebody else has already said so. */
  isClaimedByAnother: boolean
  /** Absent when claiming is not on offer — e.g. no local identity yet. */
  onClaim?: () => void
}

interface PersonProfileProps {
  person: Person
  policy: PersonPolicyView
  parents: RelationshipItem[]
  siblings: RelationshipItem[]
  partners: RelationshipItem[]
  children: RelationshipItem[]
  familyGroupMemberships: PersonFamilyGroupMembership[]
  availableFamilyGroups: FamilyGroup[]
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onAddRelative: (kind: RelationshipKind) => void
  onOpenPerson: (personId: string) => void
  onAddToFamilyGroup: (familyGroupId: string) => void
  onRemoveFromFamilyGroup: (membershipId: string) => void
  onOpenFamilyGroup: (familyGroupId: string) => void
  onCreateFamilyGroup: () => void
}

export function PersonProfile({
  person,
  policy,
  parents,
  siblings,
  partners,
  children,
  familyGroupMemberships,
  availableFamilyGroups,
  onBack,
  onEdit,
  onDelete,
  onAddRelative,
  onOpenPerson,
  onAddToFamilyGroup,
  onRemoveFromFamilyGroup,
  onOpenFamilyGroup,
  onCreateFamilyGroup,
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
          <Button
            variant="secondary"
            onClick={onEdit}
            disabled={!policy.canEdit.allowed}
            title={describePolicyReason(policy.canEdit.reason) || undefined}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={!policy.canDelete.allowed}
            title={describePolicyReason(policy.canDelete.reason) || undefined}
          >
            Delete
          </Button>
        </div>
      </Card>

      {/*
        Why an action is unavailable, not just that it is. The reason comes
        from the policy engine so the wording can never drift from the rule.
      */}
      {(!policy.canEdit.allowed || !policy.canDelete.allowed) && (
        <p className="person-profile__policy-note" role="status">
          {describePolicyReason(policy.canEdit.allowed ? policy.canDelete.reason : policy.canEdit.reason)}
        </p>
      )}

      <PersonClaimCard person={person} fullName={fullName} policy={policy} />

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

      <PersonFamilyGroupsCard
        personId={person.id}
        personName={fullName}
        memberships={familyGroupMemberships}
        availableGroups={availableFamilyGroups}
        onAddToGroup={onAddToFamilyGroup}
        onRemoveFromGroup={onRemoveFromFamilyGroup}
        onOpenGroup={onOpenFamilyGroup}
        onCreateGroup={onCreateFamilyGroup}
      />

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
