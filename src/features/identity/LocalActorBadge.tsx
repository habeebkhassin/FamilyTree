import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createLocalActor,
  ensureCurrentLocalActor,
  listLocalActors,
  setCurrentLocalActor,
} from '../../lib/identity/localActor'
import type { LocalActor } from '../../lib/identity/localActor'
import './LocalActorBadge.css'

/**
 * "Editing as …" — who this device attributes edits to.
 *
 * Deliberately not an account UI. There is no sign-in, no verification and
 * nothing to sign out of; the wording and the hint text below the list say
 * so plainly, because presenting a self-asserted name as though it were
 * verified would be the one genuinely harmful thing this component could
 * do. It grants no permissions and gates nothing.
 */
interface LocalActorBadgeProps {
  /**
   * Called when the editing identity changes. Who is editing decides both
   * how edits are attributed and what the interface offers, so the policy
   * layer has to be told rather than left showing the previous actor's
   * affordances.
   */
  onActorChange?: () => void
}

export function LocalActorBadge({ onActorChange }: LocalActorBadgeProps = {}) {
  const [actors, setActors] = useState<LocalActor[]>([])
  const [current, setCurrent] = useState<LocalActor | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    setActors(listLocalActors())
    setCurrent(ensureCurrentLocalActor())
  }, [])

  // Establishing the actor on mount means the name shown here is the same
  // one the next edit will be attributed to, rather than one appearing
  // only after the first change is already recorded.
  useEffect(refresh, [refresh])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const switchTo = (actorId: string) => {
    setCurrentLocalActor(actorId)
    refresh()
    onActorChange?.()
    setIsOpen(false)
  }

  const addActor = (event: React.FormEvent) => {
    event.preventDefault()
    if (!newName.trim()) return
    createLocalActor(newName)
    setNewName('')
    refresh()
    onActorChange?.()
    setIsOpen(false)
  }

  return (
    <div className="actor-badge" ref={containerRef}>
      <button
        type="button"
        className="actor-badge__trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <span className="actor-badge__label">Editing as</span>
        <span className="actor-badge__name">{current?.displayName ?? 'someone unnamed'}</span>
      </button>

      {isOpen && (
        <div className="actor-badge__panel" role="dialog" aria-label="Who is editing">
          <ul className="actor-badge__list">
            {actors.map((actor) => (
              <li key={actor.id}>
                <button
                  type="button"
                  className="actor-badge__option"
                  onClick={() => switchTo(actor.id)}
                  aria-current={actor.id === current?.id}
                >
                  <span>{actor.displayName}</span>
                  {actor.id === current?.id && <span className="actor-badge__check">Editing</span>}
                </button>
              </li>
            ))}
          </ul>

          <form className="actor-badge__add" onSubmit={addActor}>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Someone else's name"
              aria-label="Name of the person editing"
              className="actor-badge__input"
            />
            <button type="submit" className="actor-badge__submit" disabled={!newName.trim()}>
              Add
            </button>
          </form>

          <p className="actor-badge__hint">
            A name kept on this device so edits can be traced back to whoever made them. It is not an
            account, nothing is verified, and it grants no one any permissions.
          </p>
        </div>
      )}
    </div>
  )
}
