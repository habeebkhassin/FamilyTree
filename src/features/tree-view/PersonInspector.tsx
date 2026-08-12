import { useEffect, useRef } from 'react'
import { Avatar } from '../../components/Avatar'
import type { Person } from '../../types'
import './PersonInspector.css'

interface PersonInspectorProps {
  person: Person
  isFocal: boolean
  onFocus: () => void
  onOpenProfile: () => void
  onClose: () => void
}

function formatYears(birthDate?: string, deathDate?: string): string | null {
  const birth = birthDate ? new Date(birthDate).getFullYear() : null
  const death = deathDate ? new Date(deathDate).getFullYear() : null
  if (birth && death) return `${birth} – ${death}`
  if (birth) return `${birth} –`
  if (death) return `– ${death}`
  return null
}

/**
 * What appears when a person on the canvas is selected.
 *
 * Selecting and focusing are kept apart deliberately: a click says "tell
 * me about this person", not "throw away my current viewpoint". So both
 * consequences are offered explicitly and neither happens by surprise.
 *
 * Anchored to the bottom of the canvas on every screen size rather than
 * floating beside the node. It costs a little proximity and buys a lot:
 * it can never be clipped by the viewport edge, never covers the card
 * that was just clicked, and needs no coordinate arithmetic — so the
 * phone layout is the same component, just wider.
 */
export function PersonInspector({
  person,
  isFocal,
  onFocus,
  onOpenProfile,
  onClose,
}: PersonInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ')
  const years = formatYears(person.birthDate, person.deathDate)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Moves the keyboard into the inspector when it opens, so its actions
  // are reachable without hunting through the canvas.
  useEffect(() => {
    containerRef.current?.querySelector('button')?.focus()
  }, [person.id])

  return (
    <div
      className="person-inspector"
      ref={containerRef}
      role="dialog"
      aria-label={`${fullName} — actions`}
    >
      <div className="person-inspector__identity">
        <Avatar name={fullName} size={36} />
        <div className="person-inspector__text">
          <span className="person-inspector__name">{fullName}</span>
          {years && <span className="person-inspector__years">{years}</span>}
        </div>
      </div>

      <div className="person-inspector__actions">
        <button
          type="button"
          className="person-inspector__action person-inspector__action--primary"
          onClick={onFocus}
          disabled={isFocal}
        >
          {isFocal ? 'Current view' : 'Focus here'}
        </button>
        <button type="button" className="person-inspector__action" onClick={onOpenProfile}>
          Open profile
        </button>
      </div>

      <button
        type="button"
        className="person-inspector__close"
        onClick={onClose}
        aria-label={`Close actions for ${fullName}`}
      >
        ×
      </button>
    </div>
  )
}
