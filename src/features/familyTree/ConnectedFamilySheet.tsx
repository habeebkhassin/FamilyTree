import { useState } from 'react'
import type { FamilyConnection } from '../relationships/familyConnections'
import type { Person } from '../../types'
import { PersonPhoto } from '../../components/PersonPhoto'
import { formatName } from '../people/personDisplay'
import './ConnectedFamilySheet.css'

/**
 * The marriage that joins two families, opened from the bond itself.
 *
 * A bottom sheet rather than a page, because this is a detour: you tapped
 * something in the tree to find out where it leads, and you should be
 * able to dismiss it and still be exactly where you were.
 *
 * The shape of it is the fact it describes — two people with the marriage
 * between them, then the family that marriage reaches, then what you can
 * do about it. Nothing here is a form and nothing here is a list of
 * settings.
 */

export interface ConnectedFamilySheetProps {
  connection: FamilyConnection
  near: Person
  far: Person
  familyName: string
  memberCount: number
  onOpenFamily: () => void
  onViewMarriage: () => void
  onEditConnection: () => void
  onViewMerged: () => void
  onRemoveConnection: () => Promise<void> | void
  onClose: () => void
}

function formatDate(date: string | undefined): string | null {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function memberLabel(count: number): string {
  return count === 1 ? '1 member' : `${count} members`
}

export function ConnectedFamilySheet({
  connection,
  near,
  far,
  familyName,
  memberCount,
  onOpenFamily,
  onViewMarriage,
  onEditConnection,
  onViewMerged,
  onRemoveConnection,
  onClose,
}: ConnectedFamilySheetProps) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [removing, setRemoving] = useState(false)
  const married = formatDate(connection.startDate)

  async function handleRemove() {
    setRemoving(true)
    try {
      await onRemoveConnection()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="connected-sheet" role="dialog" aria-modal="true" aria-label="Connected Family">
      <button
        type="button"
        className="connected-sheet__scrim"
        aria-label="Close"
        onClick={onClose}
      />

      <div className="connected-sheet__panel">
        <header className="connected-sheet__header">
          <button
            type="button"
            className="connected-sheet__icon-button"
            aria-label="Back"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="connected-sheet__title">Connected Family</h2>
          <button
            type="button"
            className="connected-sheet__icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="connected-sheet__body">
          {/* The couple, with the marriage between them — the same rings
              the tree draws, so the sheet and the tree agree. */}
          <div className="connected-sheet__couple">
            <PersonSummary person={near} />
            <div className="connected-sheet__bond">
              <span className="connected-sheet__rings" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <g fill="none" stroke="currentColor" strokeWidth="1.9">
                    <circle cx="9.5" cy="12" r="5" />
                    <circle cx="14.5" cy="12" r="5" />
                  </g>
                </svg>
              </span>
              {married && <span className="connected-sheet__date">{married}</span>}
            </div>
            <PersonSummary person={far} />
          </div>

          <button type="button" className="connected-sheet__family" onClick={onOpenFamily}>
            <span className="connected-sheet__family-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="connected-sheet__family-text">
              <span className="connected-sheet__family-name">{familyName}</span>
              <span className="connected-sheet__family-count">{memberLabel(memberCount)}</span>
            </span>
            <Chevron />
          </button>

          <p className="connected-sheet__explain">
            This marriage connects your family with {familyName}. Tap to explore their family tree.
          </p>

          <button type="button" className="connected-sheet__primary" onClick={onOpenFamily}>
            Open {familyName}
          </button>

          <h3 className="connected-sheet__section">Quick actions</h3>
          <ul className="connected-sheet__actions">
            <ActionRow label="View marriage details" onClick={onViewMarriage} icon={<HeartIcon />} />
            <ActionRow label="Edit connection" onClick={onEditConnection} icon={<EditIcon />} />
            <ActionRow label="View merged family tree" onClick={onViewMerged} icon={<TreeIcon />} />
          </ul>

          {/*
            Named for what it actually does. The marriage is a fact and
            stays one; what is removed is the record placing this person
            in that family, which is the only thing making the two
            families read as connected.
          */}
          {confirmingRemoval ? (
            <div className="connected-sheet__confirm">
              <p className="connected-sheet__confirm-text">
                This removes {formatName(far)} from {familyName}. The marriage, both
                families and everyone in them stay exactly as they are.
              </p>
              <div className="connected-sheet__confirm-actions">
                <button
                  type="button"
                  className="connected-sheet__confirm-cancel"
                  onClick={() => setConfirmingRemoval(false)}
                  disabled={removing}
                >
                  Keep connection
                </button>
                <button
                  type="button"
                  className="connected-sheet__destructive"
                  onClick={() => void handleRemove()}
                  disabled={removing}
                >
                  {removing ? 'Removing…' : 'Remove connection'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="connected-sheet__destructive"
              onClick={() => setConfirmingRemoval(true)}
            >
              <BreakIcon />
              Remove family connection
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PersonSummary({ person }: { person: Person }) {
  return (
    <div className="connected-sheet__person">
      <PersonPhoto person={person} size={72} className="connected-sheet__portrait" />
      <span className="connected-sheet__name">{formatName(person)}</span>
    </div>
  )
}

function ActionRow({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <li>
      <button type="button" className="connected-sheet__action" onClick={onClick}>
        <span className="connected-sheet__action-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="connected-sheet__action-label">{label}</span>
        <Chevron />
      </button>
    </li>
  )
}

function Chevron() {
  return (
    <svg className="connected-sheet__chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path d="M12 20s-7-4.5-7-9a3.6 3.6 0 0 1 7-1.3A3.6 3.6 0 0 1 19 11c0 4.5-7 9-7 9z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path d="M4 20h4l10-10-4-4L4 16z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function TreeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="12" cy="5" r="2.2" />
        <circle cx="6" cy="18" r="2.2" />
        <circle cx="18" cy="18" r="2.2" />
        <path d="M12 7.2V11M6 15.8V13h12v2.8" />
      </g>
    </svg>
  )
}

function BreakIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d="M10.5 8.5H8a3.5 3.5 0 1 0 0 7h2.5M13.5 8.5H16a3.5 3.5 0 1 1 0 7h-2.5M5 5l14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
