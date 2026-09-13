import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './AppShell.css'

/**
 * The navigation shell — Phase 1 redesign.
 *
 * A header, a scrolling page, and a bottom bar with two destinations. Two,
 * because a family app that needs more than two is asking the reader to
 * learn something before they can use it. Everything else — family
 * groups, backups, who is editing — lives behind the header's menu, which
 * is where a thing you do occasionally belongs.
 *
 * These are presentation only. Nothing here knows about the database, the
 * relationship engine or the graph; screens pass in what to show and what
 * to do.
 */

export function AppHeader({
  title,
  subtitle,
  leading,
  actions,
}: {
  title: string
  subtitle?: string
  /** Usually a back button. Absent on a top-level destination. */
  leading?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="app-header">
      {leading && <div className="app-header__leading">{leading}</div>}
      <div className="app-header__titles">
        <h1 className="app-header__title">{title}</h1>
        {subtitle && <p className="app-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="app-header__actions">{actions}</div>}
    </header>
  )
}

/**
 * A square, quiet control for a single icon.
 *
 * 44px minimum in both directions, everywhere, because a target smaller
 * than a fingertip is a target somebody's grandmother will miss.
 */
export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={['icon-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}

export type Destination = 'tree' | 'people'

/**
 * The two places you can be.
 *
 * Labelled as well as drawn: an icon alone is a guess, and this has to
 * work for a reader who has never used an app like this before.
 */
export function BottomNavigation({
  current,
  onNavigate,
}: {
  current: Destination
  onNavigate: (destination: Destination) => void
}) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {(
        [
          { id: 'tree', label: 'Tree', icon: <TreeIcon /> },
          { id: 'people', label: 'People', icon: <PeopleIcon /> },
        ] as const
      ).map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            current === item.id ? 'bottom-nav__item bottom-nav__item--on' : 'bottom-nav__item'
          }
          aria-current={current === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <span className="bottom-nav__icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="bottom-nav__label">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

/**
 * The one obvious thing to do on a screen.
 *
 * Sits above the bottom bar rather than inside it, so the two
 * destinations stay a pair and the action stays an action.
 */
export function FloatingAddButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" className="fab" onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

/** A quiet label above a group of rows. */
export function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="section-header">
      <h2 className="section-header__title">{title}</h2>
      {trailing && <div className="section-header__trailing">{trailing}</div>}
    </div>
  )
}

/**
 * What a screen says when it has nothing to show.
 *
 * Given as much room as a full screen, because the first thing somebody
 * sees should not look like an error.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true">
        <TreeIcon size={30} />
      </span>
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__body">{body}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  )
}

export function TreeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="4.5" r="2.5" />
        <circle cx="5.5" cy="19" r="2.5" />
        <circle cx="18.5" cy="19" r="2.5" />
        <path d="M12 7v3.5M5.5 16.5V13h13v3.5M12 10.5v2.5" />
      </g>
    </svg>
  )
}

export function PeopleIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.2 19c0-3.1 2.6-5.2 5.8-5.2s5.8 2.1 5.8 5.2" />
        <path d="M16.2 6.2a3 3 0 0 1 0 5.6M17.5 13.9c2 .6 3.3 2.2 3.3 4.4" />
      </g>
    </svg>
  )
}
