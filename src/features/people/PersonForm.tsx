import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import type { Gender, Person } from '../../types'
import { RELATIONSHIP_LABEL, type RelativeIntent } from './types'
import './PersonForm.css'

export interface PersonFormValues {
  firstName: string
  lastName: string
  gender: Gender
  birthDate?: string
  deathDate?: string
  notes?: string
  isPlaceholder: boolean
}

interface PersonFormProps {
  mode: 'create' | 'edit'
  initialValues?: Person
  relativeIntent?: RelativeIntent
  onSubmit: (values: PersonFormValues) => Promise<void>
  onCancel: () => void
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'unknown', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
]

export function PersonForm({ mode, initialValues, relativeIntent, onSubmit, onCancel }: PersonFormProps) {
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? '')
  const [lastName, setLastName] = useState(initialValues?.lastName ?? '')
  const [gender, setGender] = useState<Gender>(initialValues?.gender ?? 'unknown')
  const [birthDate, setBirthDate] = useState(initialValues?.birthDate ?? '')
  const [deathDate, setDeathDate] = useState(initialValues?.deathDate ?? '')
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [isPlaceholder, setIsPlaceholder] = useState(initialValues?.isPlaceholder ?? false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const heading = relativeIntent
    ? `Add ${RELATIONSHIP_LABEL[relativeIntent.kind]}`
    : mode === 'create'
      ? 'Add a person'
      : `Edit ${initialValues ? [initialValues.firstName, initialValues.lastName].filter(Boolean).join(' ') : 'person'}`

  const subheading = relativeIntent ? `Adding a ${RELATIONSHIP_LABEL[relativeIntent.kind]} for ${relativeIntent.anchorName}.` : null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onSubmit({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender,
        birthDate: birthDate || undefined,
        deathDate: deathDate || undefined,
        notes: notes.trim() || undefined,
        isPlaceholder,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="person-form">
      <Card className="person-form__card">
        <p className="person-form__eyebrow">{mode === 'create' ? 'New person' : 'Edit person'}</p>
        <h1 className="person-form__title">{heading}</h1>
        {subheading && <p className="person-form__subtitle">{subheading}</p>}

        <form className="person-form__fields" onSubmit={handleSubmit}>
          <div className="person-form__row">
            <Field label="First name" htmlFor="person-first-name">
              <input
                id="person-first-name"
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                maxLength={80}
                required
              />
            </Field>
            <Field label="Last name" htmlFor="person-last-name">
              <input
                id="person-last-name"
                type="text"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                maxLength={80}
              />
            </Field>
          </div>

          <Field label="Gender" htmlFor="person-gender">
            <select id="person-gender" value={gender} onChange={(event) => setGender(event.target.value as Gender)}>
              {GENDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="person-form__row">
            <Field label="Born" htmlFor="person-birth-date">
              <input
                id="person-birth-date"
                type="date"
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
              />
            </Field>
            <Field label="Died" htmlFor="person-death-date">
              <input
                id="person-death-date"
                type="date"
                value={deathDate}
                onChange={(event) => setDeathDate(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Notes" htmlFor="person-notes" hint="Optional — anything you want to remember.">
            <textarea
              id="person-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={4}
            />
          </Field>

          <label className="person-form__checkbox">
            <input
              type="checkbox"
              checked={isPlaceholder}
              onChange={(event) => setIsPlaceholder(event.target.checked)}
            />
            This is a placeholder — I don't have their details yet
          </label>

          <div className="person-form__actions">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!firstName.trim() || isSubmitting}>
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Add person' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
