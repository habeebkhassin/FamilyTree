import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from './AppShell'
import './OverflowMenu.css'

/**
 * The header's menu — Phase 1 redesign.
 *
 * Where the things you do occasionally live, so the two screens people
 * actually use stay uncluttered. It lists only actions that exist: an
 * entry that opens nothing is worse than no entry.
 */
export function OverflowMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(pointerEvent: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(pointerEvent.target as Node)) setOpen(false)
    }
    function onKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="overflow" ref={wrapper}>
      <IconButton
        label="More"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </g>
        </svg>
      </IconButton>
      {open && (
        <div className="overflow__sheet" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

export function OverflowItem({
  label,
  description,
  onClick,
}: {
  label: string
  description?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="overflow__item" role="menuitem" onClick={onClick}>
      <span className="overflow__label">{label}</span>
      {description && <span className="overflow__description">{description}</span>}
    </button>
  )
}
