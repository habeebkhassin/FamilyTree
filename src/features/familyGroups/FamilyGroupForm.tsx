import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import type { FamilyGroup, FamilyOriginPrecision, Person } from '../../types'
import { formatName } from '../people/personDisplay'
import './FamilyGroupForm.css'

export interface FamilyGroupFormValues {
  name: string
  notes?: string
  establishedPrecision: FamilyOriginPrecision
  establishedDate?: string
  establishedLabel?: string
  originPersonId?: string
}

interface FamilyGroupFormProps {
  mode: 'create' | 'edit'
  initialValues?: FamilyGroup
  people: Person[]
  onSubmit: (values: FamilyGroupFormValues) => Promise<void>
  onCancel: () => void
}

const PRECISION_OPTIONS: { value: FamilyOriginPrecision; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'exact', label: 'Exact date' },
  { value: 'month', label: 'Month & year' },
  { value: 'year', label: 'Year' },
  { value: 'approximate', label: 'Approximate' },
]

export function FamilyGroupForm({ mode, initialValues, people, onSubmit, onCancel }: FamilyGroupFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [establishedPrecision, setEstablishedPrecision] = useState<FamilyOriginPrecision>(
    initialValues?.establishedPrecision ?? 'unknown',
  )
  const [establishedDate, setEstablishedDate] = useState(initialValues?.establishedDate ?? '')
  const [establishedLabel, setEstablishedLabel] = useState(initialValues?.establishedLabel ?? '')
  const [originPersonId, setOriginPersonId] = useState(initialValues?.originPersonId ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const sortedPeople = [...people].sort((a, b) => formatName(a).localeCompare(formatName(b)))
  const showDateField = establishedPrecision !== 'unknown'
  const showLabelField = establishedPrecision === 'approximate'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        notes: notes.trim() || undefined,
        establishedPrecision,
        establishedDate: showDateField ? establishedDate || undefined : undefined,
        establishedLabel: showLabelField ? establishedLabel.trim() || undefined : undefined,
        originPersonId: originPersonId || undefined,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="family-group-form">
      <Card className="family-group-form__card">
        <p className="family-group-form__eyebrow">{mode === 'create' ? 'New family group' : 'Edit family group'}</p>
        <h1 className="family-group-form__title">
          {mode === 'create' ? 'Create a family group' : `Edit ${initialValues?.name ?? 'family group'}`}
        </h1>
        <p className="family-group-form__subtitle">
          An organizational layer for grouping people into a lineage — it never changes any parent or partner
          connection in your tree.
        </p>

        <form className="family-group-form__fields" onSubmit={handleSubmit}>
          <Field label="Name" htmlFor="family-group-name">
            <input
              id="family-group-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Mother's Family"
              maxLength={120}
              required
            />
          </Field>

          <Field label="Description" htmlFor="family-group-notes" hint="Optional — a note about this group.">
            <textarea
              id="family-group-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={3}
            />
          </Field>

          <Field
            label="Origin person"
            htmlFor="family-group-origin-person"
            hint="Optional — the founder this group traces back to."
          >
            <select
              id="family-group-origin-person"
              value={originPersonId}
              onChange={(event) => setOriginPersonId(event.target.value)}
            >
              <option value="">None</option>
              {sortedPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {formatName(person)}
                </option>
              ))}
            </select>
          </Field>

          <div className="family-group-form__row">
            <Field label="Origin date precision" htmlFor="family-group-precision">
              <select
                id="family-group-precision"
                value={establishedPrecision}
                onChange={(event) => setEstablishedPrecision(event.target.value as FamilyOriginPrecision)}
              >
                {PRECISION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {showDateField && (
              <Field
                label="Origin date"
                htmlFor="family-group-date"
                hint={establishedPrecision === 'approximate' ? 'Optional' : undefined}
              >
                <input
                  id="family-group-date"
                  type="date"
                  value={establishedDate}
                  onChange={(event) => setEstablishedDate(event.target.value)}
                />
              </Field>
            )}
          </div>

          {showLabelField && (
            <Field
              label="Display text"
              htmlFor="family-group-label"
              hint='Optional — overrides the date above, e.g. "1940s" or "before the war".'
            >
              <input
                id="family-group-label"
                type="text"
                value={establishedLabel}
                onChange={(event) => setEstablishedLabel(event.target.value)}
                maxLength={60}
              />
            </Field>
          )}

          <div className="family-group-form__actions">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create group' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
