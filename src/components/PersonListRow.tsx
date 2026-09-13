import { Avatar } from './Avatar'
import './PersonListRow.css'

/**
 * One person in a list — Phase 1 redesign.
 *
 * A circular photo, a name, a quiet line underneath, and a chevron. The
 * whole row is the target, not the name inside it, so it can be tapped
 * without aiming.
 *
 * The subtitle is whatever the screen thinks is worth saying about this
 * person there — a relationship on one screen, dates on another. This
 * component does not work it out, because deciding what a person is to
 * somebody is the relationship engine's job, not a list row's.
 */
export function PersonListRow({
  name,
  subtitle,
  onClick,
}: {
  name: string
  subtitle?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="person-row" onClick={onClick}>
      <Avatar name={name} size={44} />
      <span className="person-row__text">
        <span className="person-row__name">{name}</span>
        {subtitle && <span className="person-row__subtitle">{subtitle}</span>}
      </span>
      <span className="person-row__chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M9 5l7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  )
}
