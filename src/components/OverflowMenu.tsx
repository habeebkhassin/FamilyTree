import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconButton } from './AppShell'
import { Icon } from './icons'
import './OverflowMenu.css'

export interface OverflowAction {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Drawn in the accent when the action is currently on. */
  active?: boolean
}

/**
 * The header's ⋮ — the actions that belong to the screen you are on.
 *
 * Distinct from the More tab, which holds the things that belong to the
 * whole application. What is here is contextual: on the tree, that is
 * adding somebody and comparing two people. Both used to be buttons
 * sitting over the family, which is a large share of a phone screen spent
 * on things nobody does often.
 *
 * Every action listed does something. There is no disabled row and no
 * row leading to an empty screen.
 */
export function OverflowMenu({ label, actions }: { label: string; actions: OverflowAction[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere else, or pressing Escape, closes it — the two ways
  // everybody already expects a menu like this to go away.
  useEffect(() => {
    if (!isOpen) return

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  if (actions.length === 0) return null

  return (
    <div className="overflow-menu" ref={containerRef}>
      <IconButton label={label} aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
        {Icon.more({ size: 20 })}
      </IconButton>

      {isOpen && (
        <div className="overflow-menu__sheet" role="menu">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={
                action.active ? 'overflow-menu__item overflow-menu__item--on' : 'overflow-menu__item'
              }
              onClick={() => {
                setIsOpen(false)
                action.onSelect()
              }}
            >
              {action.icon && (
                <span className="overflow-menu__icon" aria-hidden="true">
                  {action.icon}
                </span>
              )}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
