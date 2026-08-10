import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import type { ParentRelationship, Person, UnionStatus } from '../../types'
import type { RelatedParent } from '../../lib/relationships/deriveRelationships'
import { PersonCard } from './PersonCard'
import { PersonForm } from './PersonForm'
import type { PersonFormValues } from './PersonForm'
import { formatName } from './personDisplay'
import type { LinkExtras, RelativeIntent } from './types'
import './AddRelativeScreen.css'

interface AddRelativeScreenProps {
  intent: RelativeIntent
  anchorParents: RelatedParent[]
  candidates: Person[]
  error: string | null
  isBusy: boolean
  onConnectExisting: (personId: string, extras: LinkExtras) => void
  onCreateNew: (values: PersonFormValues, extras: LinkExtras) => Promise<void>
  onCancel: () => void
  onGoAddParent: () => void
}

const PARENT_LINK_OPTIONS: { value: ParentRelationship; label: string }[] = [
  { value: 'biological', label: 'Biological' },
  { value: 'adopted', label: 'Adopted' },
  { value: 'step', label: 'Step' },
  { value: 'foster', label: 'Foster' },
]

const UNION_STATUS_OPTIONS: { value: UnionStatus; label: string }[] = [
  { value: 'partnered', label: 'Partnered' },
  { value: 'married', label: 'Married' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'separated', label: 'Separated' },
  { value: 'widowed', label: 'Widowed' },
]

export function AddRelativeScreen({
  intent,
  anchorParents,
  candidates,
  error,
  isBusy,
  onConnectExisting,
  onCreateNew,
  onCancel,
  onGoAddParent,
}: AddRelativeScreenProps) {
  const [search, setSearch] = useState('')
  const [parentLinkType, setParentLinkType] = useState<ParentRelationship>('biological')
  const [unionStatus, setUnionStatus] = useState<UnionStatus>('partnered')
  const [unionStartDate, setUnionStartDate] = useState('')

  const filteredCandidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return candidates
    return candidates.filter((person) => formatName(person).toLowerCase().includes(term))
  }, [candidates, search])

  function buildExtras(): LinkExtras {
    if (intent.kind === 'parent' || intent.kind === 'child') {
      return { kind: intent.kind, relationship: parentLinkType }
    }
    if (intent.kind === 'spouse') {
      return { kind: 'spouse', status: unionStatus, startDate: unionStartDate || undefined }
    }
    return { kind: 'sibling' }
  }

  // Siblings only exist through a shared parent — without one, there's
  // nothing valid to connect yet.
  if (intent.kind === 'sibling' && anchorParents.length === 0) {
    return (
      <div className="add-relative">
        <button type="button" className="add-relative__back" onClick={onCancel}>
          ← Back to {intent.anchorName}
        </button>
        <Card className="add-relative__guidance">
          <h1 className="add-relative__title">Add a parent first</h1>
          <p className="add-relative__text">
            Siblings are connected through a shared parent. Add a parent for {intent.anchorName} first, then you
            can add siblings through them.
          </p>
          <Button onClick={onGoAddParent}>Add parent instead</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="add-relative">
      <button type="button" className="add-relative__back" onClick={onCancel}>
        ← Back to {intent.anchorName}
      </button>

      {error && (
        <Card className="add-relative__extra">
          <p className="add-relative__error">{error}</p>
        </Card>
      )}

      {(intent.kind === 'parent' || intent.kind === 'child') && (
        <Card className="add-relative__extra">
          <Field label="Relationship type" htmlFor="parent-link-type">
            <select
              id="parent-link-type"
              value={parentLinkType}
              onChange={(event) => setParentLinkType(event.target.value as ParentRelationship)}
            >
              {PARENT_LINK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </Card>
      )}

      {intent.kind === 'spouse' && (
        <Card className="add-relative__extra">
          <div className="add-relative__row">
            <Field label="Status" htmlFor="union-status">
              <select
                id="union-status"
                value={unionStatus}
                onChange={(event) => setUnionStatus(event.target.value as UnionStatus)}
              >
                {UNION_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Since (optional)" htmlFor="union-start-date">
              <input
                id="union-start-date"
                type="date"
                value={unionStartDate}
                onChange={(event) => setUnionStartDate(event.target.value)}
              />
            </Field>
          </div>
        </Card>
      )}

      {candidates.length > 0 && (
        <Card className="add-relative__existing">
          <h2 className="add-relative__section-title">Connect someone already in this tree</h2>
          <input
            type="text"
            className="add-relative__search"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {filteredCandidates.length === 0 ? (
            <p className="add-relative__empty">No one matches "{search}".</p>
          ) : (
            <div className="add-relative__grid">
              {filteredCandidates.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  onClick={() => !isBusy && onConnectExisting(person.id, buildExtras())}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      <p className="add-relative__divider">or</p>

      <PersonForm
        mode="create"
        relativeIntent={intent}
        onSubmit={(values) => onCreateNew(values, buildExtras())}
        onCancel={onCancel}
      />
    </div>
  )
}
