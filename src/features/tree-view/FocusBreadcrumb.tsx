import type { Person } from '../../types'
import './FocusBreadcrumb.css'

interface FocusBreadcrumbProps {
  /** Oldest first, current last. */
  history: readonly string[]
  focalPersonId: string | null
  /** The person this device's user has said is them, if any. */
  claimedPersonId: string | null
  peopleById: ReadonlyMap<string, Person>
  onBack: () => void
}

function shortName(person: Person): string {
  return person.firstName || person.lastName || 'Unnamed'
}

/**
 * Where the viewpoint has been walked.
 *
 * The point is orientation: after three re-focuses it is genuinely easy to
 * forget whose family you are looking at, and the way back is the cheapest
 * defence against that. It shows the trail and offers one step back — not
 * a navigation system.
 *
 * The claimed person reads as "You", because that is what they are to the
 * person reading it. It is not a claim about verified identity; the only
 * thing being asserted is whose device this is.
 */
export function FocusBreadcrumb({
  history,
  focalPersonId,
  claimedPersonId,
  peopleById,
  onBack,
}: FocusBreadcrumbProps) {
  if (!focalPersonId) return null

  // The trail is empty until the user moves; showing just the current
  // person is still worth it, since "who am I looking at" is the question.
  const trail = history.length > 0 ? history : [focalPersonId]
  const canGoBack = history.length > 1

  const label = (personId: string) => {
    const person = peopleById.get(personId)
    if (!person) return 'Someone'
    return personId === claimedPersonId ? 'You' : shortName(person)
  }

  return (
    <nav className="focus-breadcrumb" aria-label="Viewpoint history">
      {canGoBack && (
        <button
          type="button"
          className="focus-breadcrumb__back"
          onClick={onBack}
          aria-label="Go back to the previous viewpoint"
        >
          ←
        </button>
      )}

      <span className="focus-breadcrumb__label">Viewing from</span>

      <ol className="focus-breadcrumb__trail">
        {trail.map((personId, index) => {
          const isCurrent = index === trail.length - 1
          return (
            <li key={`${personId}-${index}`} className="focus-breadcrumb__step">
              {index > 0 && (
                <span className="focus-breadcrumb__separator" aria-hidden="true">
                  ›
                </span>
              )}
              <span
                className={
                  isCurrent
                    ? 'focus-breadcrumb__person focus-breadcrumb__person--current'
                    : 'focus-breadcrumb__person'
                }
                aria-current={isCurrent ? 'true' : undefined}
              >
                {label(personId)}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
