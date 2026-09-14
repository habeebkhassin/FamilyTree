import './FamilyConnectionBanner.css'

/**
 * The way back across a marriage.
 *
 * Standing in another family's tree, the one thing you must not lose is
 * how you got here and how to return. This says both, in a sentence
 * rather than a breadcrumb: whose marriage the bridge is, and when.
 */
export function FamilyConnectionBanner({
  title,
  through,
  detail,
  onClick,
  tone = 'accent',
}: {
  title: string
  through: string
  detail?: string | null
  onClick?: () => void
  /** `group` for the other family's violet, `accent` for your own green. */
  tone?: 'accent' | 'group'
}) {
  const body = (
    <>
      <span className={`family-connection__mark family-connection__mark--${tone}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M9 12h6M10.5 8.5H8a3.5 3.5 0 1 0 0 7h2.5M13.5 8.5H16a3.5 3.5 0 1 1 0 7h-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="family-connection__text">
        <span className="family-connection__title">{title}</span>
        <span className="family-connection__through">{through}</span>
        {detail && <span className="family-connection__detail">{detail}</span>}
      </span>
      {onClick && (
        <svg className="family-connection__chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  )

  if (!onClick) {
    return <div className="family-connection">{body}</div>
  }

  return (
    <button type="button" className="family-connection" onClick={onClick}>
      {body}
    </button>
  )
}
