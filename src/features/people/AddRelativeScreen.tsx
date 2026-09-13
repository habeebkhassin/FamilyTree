import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import type { ParentRelationship, Person, UnionStatus } from '../../types'
import type { RelatedParent } from '../../lib/relationships/deriveRelationships'
import { PersonPhoto } from '../../components/PersonPhoto'
import { Icon } from '../../components/icons'
import { PersonForm } from './PersonForm'
import type { PersonFormValues } from './PersonForm'
import { formatName, formatYearRange, matchesQuery } from './personDisplay'
import type { LinkExtras, RelativeIntent } from './types'
import './AddRelativeScreen.css'

interface AddRelativeScreenProps {
  intent: RelativeIntent
  anchorParents: RelatedParent[]
  /** Everyone who could be connected — reachable through search, never listed. */
  candidates: Person[]
  /** The few worth offering up front. Ranked by the relationship engine. */
  suggested: Person[]
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
  suggested,
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

  /*
    Searching reaches the whole family; not searching shows the handful
    of people the answer is likely to be. The full list is never rendered
    on arrival — on any real tree that meant scrolling past everybody you
    were not looking for before reaching the form.

    `matchesQuery` is the same predicate the People directory and the
    tree's own search use, so all three agree on what counts as a match.
  */
  const isSearching = search.trim().length > 0
  const results = useMemo(() => {
    if (!isSearching) return suggested
    return candidates
      .filter((person) => matchesQuery(person, search))
      .sort((a, b) => formatName(a).localeCompare(formatName(b)))
  }, [candidates, suggested, search, isSearching])

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

          <label className="add-relative__search">
            <span className="add-relative__search-icon" aria-hidden="true">
              {Icon.search({ size: 18 })}
            </span>
            <input
              type="search"
              className="add-relative__search-input"
              placeholder="Search family members…"
              aria-label="Search family members"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          {/*
            Named only when these are suggestions. Under search results the
            heading would be describing the wrong thing.
          */}
          {!isSearching && results.length > 0 && (
            <p className="add-relative__suggested-label">Suggested</p>
          )}

          {results.length === 0 ? (
            <p className="add-relative__empty">
              {isSearching
                ? 'No family members found.'
                : 'Search for anyone already in this family.'}
            </p>
          ) : (
            <div
              className={
                isSearching ? 'add-relative__people add-relative__people--results' : 'add-relative__people'
              }
            >
              {results.map((person) => {
                const years = formatYearRange(person)
                return (
                  <button
                    key={person.id}
                    type="button"
                    className="add-relative__person"
                    disabled={isBusy}
                    // The years are the disambiguator when two relatives
                    // share a name, so they belong in the accessible name
                    // even though the chip is too small to show them.
                    title={years ? `${formatName(person)} · ${years}` : formatName(person)}
                    // The years disambiguate two relatives who share a
                    // name; the chip has no room to show them, so they go
                    // to anyone listening rather than being lost.
                    aria-label={years ? `${formatName(person)}, ${years}` : formatName(person)}
                    onClick={() => onConnectExisting(person.id, buildExtras())}
                  >
                    <PersonPhoto person={person} size={28} />
                    <span className="add-relative__person-name">{formatName(person)}</span>
                  </button>
                )
              })}
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
