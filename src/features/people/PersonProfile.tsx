import { useState } from 'react'
import { PersonPhoto } from '../../components/PersonPhoto'
import { PersonPhotoPicker } from './PersonPhotoPicker'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AppHeader, IconButton } from '../../components/AppShell'
import { ActionCard, ActionCircle, DetailRow, Section } from '../../components/Detail'
import { Icon } from '../../components/icons'
import { PersonListRow } from '../../components/PersonListRow'
import type { FamilyGroup } from '../../types'
import type { Person } from '../../types'
import { PersonFamilyGroupsCard } from '../familyGroups/PersonFamilyGroupsCard'
import type { PersonFamilyGroupMembership } from '../familyGroups/PersonFamilyGroupsCard'
import type { PolicyDecision } from '../../lib/policy/can'
import { describePolicyReason } from '../policy/policyMessages'
import { PersonClaimCard } from './PersonClaimCard'
import { formatFullDate, formatName } from './personDisplay'
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
  /** How this person relates to whoever is viewing, when that is known. */
  relationshipLabel?: string
  parents: RelationshipItem[]
  siblings: RelationshipItem[]
  partners: RelationshipItem[]
  children: RelationshipItem[]
  familyGroupMemberships: PersonFamilyGroupMembership[]
  availableFamilyGroups: FamilyGroup[]
  onBack: () => void
  onEdit: () => void
  /** Reload the person after their photo changed. */
  onPhotoChanged?: () => void
  onDelete: () => void
  onAddRelative: (kind: RelationshipKind) => void
  onOpenPerson: (personId: string) => void
  onAddToFamilyGroup: (familyGroupId: string) => void
  onRemoveFromFamilyGroup: (membershipId: string) => void
  onOpenFamilyGroup: (familyGroupId: string) => void
  onCreateFamilyGroup: () => void
}

/**
 * One person — Phase 3.
 *
 * Reads the way somebody would ask about a relative: who they are, what
 * you can do about them, the few facts worth knowing, the family around
 * them, then everything else.
 *
 * Progressive disclosure rather than one long wall. Facts and family are
 * open because that is what people came for; notes and the rest are folded
 * and say how much is behind them, so nothing is hidden without a trace.
 * The round actions are labelled in words — an icon alone is a guess, and
 * this has to work for a reader who has never used software like this.
 */
export function PersonProfile({
  person,
  policy,
  relationshipLabel,
  parents,
  siblings,
  partners,
  children,
  familyGroupMemberships,
  availableFamilyGroups,
  onBack,
  onEdit,
  onPhotoChanged,
  onDelete,
  onAddRelative,
  onOpenPerson,
  onAddToFamilyGroup,
  onRemoveFromFamilyGroup,
  onOpenFamilyGroup,
  onCreateFamilyGroup,
}: PersonProfileProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showRelationshipChoices, setShowRelationshipChoices] = useState(false)
  const fullName = formatName(person)
  const familyCount = parents.length + siblings.length + partners.length + children.length
  const hasBasics = Boolean(person.birthDate || person.deathDate)

  return (
    <div className="person-profile">
      <AppHeader
        title={fullName}
        subtitle={relationshipLabel}
        leading={
          <IconButton label="Back" onClick={onBack}>
            {Icon.back({ size: 20 })}
          </IconButton>
        }
      />

      <div className="person-profile__body">
        <header className="person-profile__hero">
          {/*
            The real portrait, not just initials — this screen is where
            somebody looks at a relative, so it is where their photograph
            belongs. PersonPhoto falls back to the initials avatar when
            there is no photo or its bytes have not arrived yet.
          */}
          <PersonPhoto person={person} size={104} />
          {/* Changing it is offered only to somebody who may edit. The
              server decides too; this is what stops a viewer being shown
              a control that would be refused. */}
          {policy.canEdit.allowed && <PersonPhotoPicker person={person} onChanged={onPhotoChanged} />}
          <h1 className="person-profile__name">{fullName}</h1>
          {relationshipLabel && <p className="person-profile__relation">{relationshipLabel}</p>}
          {person.isPlaceholder && <span className="person-profile__badge">Placeholder</span>}
        </header>

        <div className="action-row">
          <ActionCircle
            label="Edit"
            icon={Icon.edit({ size: 22 })}
            onClick={onEdit}
            disabled={!policy.canEdit.allowed}
            title={describePolicyReason(policy.canEdit.reason) || undefined}
          />
          <ActionCircle
            label="Add family"
            icon={Icon.branch({ size: 22 })}
            onClick={() => setShowRelationshipChoices((open) => !open)}
          />
          <ActionCircle
            label="Delete"
            icon={Icon.trash({ size: 22 })}
            onClick={() => setConfirmingDelete(true)}
            disabled={!policy.canDelete.allowed}
            title={describePolicyReason(policy.canDelete.reason) || undefined}
          />
        </div>

        {/*
          Why an action is unavailable, not just that it is. The wording
          comes from the policy engine so it cannot drift from the rule.
        */}
        {(!policy.canEdit.allowed || !policy.canDelete.allowed) && (
          <p className="person-profile__policy-note" role="status">
            {describePolicyReason(policy.canEdit.allowed ? policy.canDelete.reason : policy.canEdit.reason)}
          </p>
        )}

        {/*
          The four ways a family grows, said in family words. Each one
          hands the same intent to the existing relationship engine; none
          of them knows what a ParentLink or a Union is.
        */}
        {showRelationshipChoices && (
          <div className="person-profile__choices">
            <ActionCard
              title="Add parent"
              description={`Connect a parent to ${person.firstName}`}
              icon={Icon.branch({ size: 22 })}
              onClick={() => onAddRelative('parent')}
            />
            <ActionCard
              title="Add spouse or partner"
              description="Connect two people"
              icon={Icon.rings({ size: 22 })}
              onClick={() => onAddRelative('spouse')}
            />
            <ActionCard
              title="Add child"
              description="Add a child to a couple"
              icon={Icon.child({ size: 22 })}
              onClick={() => onAddRelative('child')}
            />
            <ActionCard
              title="Add sibling"
              description={`Add a brother or sister to ${person.firstName}`}
              icon={Icon.siblings({ size: 22 })}
              onClick={() => onAddRelative('sibling')}
            />
          </div>
        )}

        {hasBasics && (
          <Section title="Basic information" collapsible={false}>
            {person.birthDate && (
              <DetailRow icon={Icon.cake()} label="Born" value={formatFullDate(person.birthDate)} />
            )}
            {person.deathDate && (
              <DetailRow icon={Icon.cake()} label="Died" value={formatFullDate(person.deathDate)} />
            )}
          </Section>
        )}

        <Section title="Family" count={familyCount} defaultOpen>
          <FamilyList
            title="Parents"
            items={parents}
            addLabel="Add parent"
            onAdd={() => onAddRelative('parent')}
            onOpenPerson={onOpenPerson}
          />
          <FamilyList
            title="Spouse or partner"
            items={partners}
            addLabel="Add spouse or partner"
            onAdd={() => onAddRelative('spouse')}
            onOpenPerson={onOpenPerson}
          />
          <FamilyList
            title="Children"
            items={children}
            addLabel="Add child"
            onAdd={() => onAddRelative('child')}
            onOpenPerson={onOpenPerson}
          />
          <FamilyList
            title="Siblings"
            items={siblings}
            addLabel="Add sibling"
            onAdd={() => onAddRelative('sibling')}
            onOpenPerson={onOpenPerson}
          />
        </Section>

        <Section title="Notes and more" defaultOpen={Boolean(person.notes)}>
          {person.notes ? (
            <DetailRow icon={Icon.note()} label="Notes" value={person.notes} />
          ) : (
            <p className="person-profile__empty">Nothing written down yet.</p>
          )}
          <PersonClaimCard person={person} fullName={fullName} policy={policy} />
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
        </Section>
      </div>

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

/** One relationship, as a short list of people with a way to add another. */
function FamilyList({
  title,
  items,
  addLabel,
  onAdd,
  onOpenPerson,
}: {
  title: string
  items: RelationshipItem[]
  addLabel: string
  onAdd: () => void
  onOpenPerson: (personId: string) => void
}) {
  return (
    <div className="family-list">
      <h3 className="family-list__title">{title}</h3>
      {items.length > 0 && (
        <div className="person-list">
          {items.map((item) => (
            <PersonListRow
              key={item.id}
              name={formatName(item.person)}
              subtitle={item.badge}
              onClick={() => onOpenPerson(item.person.id)}
            />
          ))}
        </div>
      )}
      <Button variant="secondary" className="family-list__add" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  )
}
