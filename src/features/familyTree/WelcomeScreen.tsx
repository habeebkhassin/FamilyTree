import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import type { CreateFamilyTreeInput } from '../../lib/storage'
import './WelcomeScreen.css'

interface WelcomeScreenProps {
  onCreate: (input: CreateFamilyTreeInput) => Promise<void>
}

export function WelcomeScreen({ onCreate }: WelcomeScreenProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onCreate({ name, description: description || undefined })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="welcome">
      <Card className="welcome__card">
        <p className="welcome__eyebrow">Family Tree</p>
        <h1 className="welcome__title">Build your family tree.</h1>
        <p className="welcome__subtitle">
          A private place to map how your family connects, and hold onto the
          stories that go with each person.
        </p>

        <form className="welcome__form" onSubmit={handleSubmit}>
          <Field label="Family tree name" htmlFor="tree-name">
            <input
              id="tree-name"
              type="text"
              placeholder="e.g. The Alabi Family"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </Field>

          <Field
            label="Description"
            htmlFor="tree-description"
            hint="Optional — a note to yourself about this tree."
          >
            <textarea
              id="tree-description"
              placeholder="e.g. My mother's side of the family"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={280}
              rows={3}
            />
          </Field>

          <Button type="submit" disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create Family Tree'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
