import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Field } from '../../components/Field'
import { AppHeader, IconButton } from '../../components/AppShell'
import { Icon } from '../../components/icons'
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

/**
 * Offered as a row of pills rather than a dropdown — Phase 3.
 *
 * Three taps become one, and every option is visible without opening
 * anything, which matters most to the readers this interface is for.
 * "Prefer not to say" stays as the default and last option: it is the
 * honest answer for most people in an old family tree, and it must not
 * look like a failure to fill something in.
 */
const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Prefer not to say' },
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

  async function handleSubmit(event: FormEvent | Event) {
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

  const canSave = Boolean(firstName.trim()) && !isSubmitting

  return (
    <div className="person-form">
      {/*
        Cancel, title, save — the shape of the reference, and the shape of
        every form on a phone. The tick is the primary action and stays in
        reach of a thumb without scrolling to the end of the form.
      */}
      <AppHeader
        title={heading}
        subtitle={subheading ?? undefined}
        leading={
          <IconButton label="Cancel" onClick={onCancel}>
            {Icon.close({ size: 20 })}
          </IconButton>
        }
        actions={
          <IconButton
            label={mode === 'create' ? 'Add person' : 'Save changes'}
            className={canSave ? 'icon-button--on' : undefined}
            disabled={!canSave}
            onClick={() => void handleSubmit(new Event('submit'))}
          >
            {Icon.check({ size: 22 })}
          </IconButton>
        }
      />

      <div className="person-form__body">
        <form className="person-form__fields" onSubmit={handleSubmit}>
          <div className="person-form__photo">
            <span className="person-form__photo-disc" aria-hidden="true">
              {Icon.camera({ size: 26 })}
            </span>
            {/*
              Named, not offered. Photos live in IndexedDB as blobs and
              belong in object storage before they can be added here; a
              button that did nothing would be worse than saying so.
            */}
            <span className="person-form__photo-note">Photos are coming soon</span>
          </div>

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

          <fieldset className="person-form__pills">
            <legend className="person-form__legend">Gender</legend>
            {GENDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={gender === option.value ? 'pill pill--on' : 'pill'}
                aria-pressed={gender === option.value}
                onClick={() => setGender(option.value)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>

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

          {/*
            Kept as well as the tick in the header. The header action is
            the quick one; somebody who has scrolled to the bottom of a
            form should not have to scroll back up to finish it.
          */}
          <div className="person-form__actions">
            <Button type="submit" disabled={!canSave}>
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Add person' : 'Save changes'}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
