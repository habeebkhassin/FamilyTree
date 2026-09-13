import { useState, type ReactNode } from 'react'
import './Detail.css'

/**
 * The building blocks the person screen and the menus are made of —
 * Phase 3.
 *
 * All presentation. Nothing here reads the database, resolves a
 * relationship or knows what a ParentLink is; screens pass in text and
 * handlers. That is what keeps the genealogy out of the interface and the
 * interface out of the genealogy.
 */

/** A labelled fact: an icon, what it is, and what it says. */
export function DetailRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
}) {
  return (
    <div className="detail-row">
      <span className="detail-row__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="detail-row__text">
        <span className="detail-row__label">{label}</span>
        <span className="detail-row__value">{value}</span>
      </div>
    </div>
  )
}

/**
 * One of the round actions under a person's name.
 *
 * Labelled underneath rather than by icon alone — an icon on its own is a
 * guess, and this has to work for a reader who does not already know what
 * a pencil in a circle means.
 */
export function ActionCircle({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      className="action-circle"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <span className="action-circle__disc" aria-hidden="true">
        {icon}
      </span>
      <span className="action-circle__label">{label}</span>
    </button>
  )
}

/**
 * A section that can be folded away — Phase 3.
 *
 * Progressive disclosure, so a long life does not arrive as one wall of
 * text. What somebody came for is open; the rest is one tap away and says
 * how much is behind it, so nothing is hidden without a trace.
 */
export function Section({
  title,
  count,
  defaultOpen = true,
  collapsible = true,
  children,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  collapsible?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (!collapsible) {
    return (
      <section className="section">
        <h2 className="section__title">{title}</h2>
        <div className="section__body">{children}</div>
      </section>
    )
  }

  return (
    <section className="section">
      <button
        type="button"
        className="section__toggle"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <h2 className="section__title">{title}</h2>
        {count !== undefined && <span className="section__count">{count}</span>}
        <span className={open ? 'section__chevron section__chevron--open' : 'section__chevron'} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && <div className="section__body">{children}</div>}
    </section>
  )
}

/**
 * A large tappable card for one understandable action.
 *
 * Used for the relationship choices, where the whole point is that
 * "Add a child to a couple" should be readable without knowing that a
 * child is two ParentLinks routed through a Union.
 */
export function ActionCard({
  title,
  description,
  icon,
  onClick,
  disabled,
}: {
  title: string
  description: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" className="action-card" onClick={onClick} disabled={disabled}>
      <span className="action-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="action-card__text">
        <span className="action-card__title">{title}</span>
        <span className="action-card__description">{description}</span>
      </span>
      <span className="action-card__chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

/** A row in a settings-style list: icon, label, chevron. */
export function MenuRow({
  icon,
  label,
  description,
  onClick,
}: {
  icon: ReactNode
  label: string
  description?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="menu-row" onClick={onClick}>
      <span className="menu-row__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-row__text">
        <span className="menu-row__label">{label}</span>
        {description && <span className="menu-row__description">{description}</span>}
      </span>
      <span className="menu-row__chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

/**
 * A choice in a list, with a tick on the one in effect.
 *
 * A tick and a tinted row, not colour alone — the selected option has to
 * be identifiable to somebody who cannot tell the tint from the ground.
 */
export function ChoiceRow({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={selected ? 'choice-row choice-row--on' : 'choice-row'}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="choice-row__label">{label}</span>
      {selected && (
        <span className="choice-row__tick" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <circle cx="12" cy="12" r="10" fill="currentColor" />
            <path d="M8 12.5l2.5 2.5 5-5" fill="none" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  )
}

/** A labelled on/off switch. */
export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-row__label">{label}</span>
      <input
        type="checkbox"
        className="toggle-row__input"
        checked={checked}
        onChange={(changeEvent) => onChange(changeEvent.target.checked)}
      />
      <span className="toggle-row__track" aria-hidden="true">
        <span className="toggle-row__knob" />
      </span>
    </label>
  )
}
