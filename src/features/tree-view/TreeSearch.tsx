import { useEffect, useMemo, useRef, useState } from 'react'
import type { Person } from '../../types'
import { IconButton } from '../../components/AppShell'
import { PersonPhoto } from '../../components/PersonPhoto'
import { Icon } from '../../components/icons'
import { formatName, formatYearRange, matchesQuery } from '../people/personDisplay'
import './TreeSearch.css'

/**
 * Finding somebody in the tree.
 *
 * A sheet over the canvas rather than a screen of its own, because the
 * answer to "where is my aunt" is a place on the tree, and leaving the
 * tree to go and find it would throw away the thing being searched.
 * Choosing a result moves the view to that person and closes.
 *
 * It does not own a search system. `matchesQuery` is the same predicate
 * the People directory uses, so the two can never disagree about what
 * counts as a match.
 */
export function TreeSearch({
  people,
  onPick,
  onClose,
}: {
  people: Person[]
  /** Goes to that person on the tree — never opens their profile. */
  onPick: (personId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The sheet exists to be typed into, so it opens with the cursor
  // already there.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const matches = useMemo(() => {
    const found = people
      .filter((person) => matchesQuery(person, query))
      .sort((a, b) => formatName(a).localeCompare(formatName(b)))
    // An empty box would otherwise list the whole family, which is the
    // People screen's job and not an answer to anything.
    return query.trim() ? found.slice(0, 40) : []
  }, [people, query])

  const hasQuery = query.trim().length > 0

  return (
    <div className="tree-search" role="dialog" aria-modal="true" aria-label="Find a family member">
      <div className="tree-search__bar">
        <label className="tree-search__field">
          <span className="tree-search__icon" aria-hidden="true">
            {Icon.search({ size: 18 })}
          </span>
          <input
            ref={inputRef}
            type="search"
            className="tree-search__input"
            placeholder="Find a family member"
            aria-label="Find a family member"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <IconButton label="Close search" onClick={onClose}>
          {Icon.close({ size: 20 })}
        </IconButton>
      </div>

      <div className="tree-search__results">
        {!hasQuery && <p className="tree-search__hint">Type a name to find them on the tree.</p>}

        {hasQuery && matches.length === 0 && (
          <p className="tree-search__hint">Nobody in this family matches “{query.trim()}”.</p>
        )}

        {matches.map((person) => {
          const years = formatYearRange(person)
          return (
            <button
              key={person.id}
              type="button"
              className="tree-search__result"
              onClick={() => onPick(person.id)}
            >
              <PersonPhoto person={person} size={40} />
              <span className="tree-search__result-text">
                <span className="tree-search__result-name">{formatName(person)}</span>
                {years && <span className="tree-search__result-meta">{years}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
