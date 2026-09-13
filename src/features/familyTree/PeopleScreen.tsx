import { useMemo, useState } from 'react'
import type { Person } from '../../types'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState, SectionHeader } from '../../components/AppShell'
import { PersonListRow } from '../../components/PersonListRow'
import { formatName } from '../people/personDisplay'
import './PeopleScreen.css'

type PeopleStatus = 'loading' | 'ready' | 'error'

/**
 * The People directory — Phase 1 redesign.
 *
 * A search box and a list of rows, and deliberately nothing else. This is
 * the screen for "find my aunt", so anything that is not a person or a way
 * to narrow down to one has been moved to the header menu.
 *
 * The grid of cards it replaces looked like a dashboard and read like one:
 * at fifty people it was a wall to scan rather than a list to search.
 */
export function PeopleScreen({
  people,
  status,
  subtitleFor,
  onOpenPerson,
  onAddPerson,
  onRetry,
}: {
  people: Person[]
  status: PeopleStatus
  /** What to say under each name. The screen does not work this out itself. */
  subtitleFor?: (person: Person) => string | undefined
  onOpenPerson: (personId: string) => void
  onAddPerson: () => void
  onRetry: () => void
}) {
  const [query, setQuery] = useState('')

  const sorted = useMemo(
    () => [...people].sort((a, b) => formatName(a).localeCompare(formatName(b))),
    [people],
  )

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((person) => formatName(person).toLowerCase().includes(needle))
  }, [sorted, query])

  if (status === 'loading') {
    return <p className="people__status">Loading your family…</p>
  }

  if (status === 'error') {
    return (
      <Card className="people__status-card">
        <p>Something went wrong loading your family.</p>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </Card>
    )
  }

  if (people.length === 0) {
    return (
      <EmptyState
        title="Start your family tree"
        body="Add your family members and keep your family history alive."
        action={<Button onClick={onAddPerson}>+ Add first person</Button>}
      />
    )
  }

  return (
    <>
      <label className="people__search">
        <span className="people__search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </g>
          </svg>
        </span>
        <input
          type="search"
          className="people__search-input"
          placeholder="Search people"
          aria-label="Search people"
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
        />
      </label>

      <div className="people__list">
        <SectionHeader
          title={
            query
              ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
              : `${people.length} ${people.length === 1 ? 'person' : 'people'}`
          }
        />
        {matches.length === 0 ? (
          <p className="people__none">Nobody here matches “{query}”.</p>
        ) : (
          <div className="person-list">
            {matches.map((person) => (
              <PersonListRow
                key={person.id}
                name={formatName(person)}
                subtitle={subtitleFor?.(person)}
                onClick={() => onOpenPerson(person.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
