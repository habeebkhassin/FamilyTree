import { Button } from '../../components/Button'
import {
  formatReciprocalSentence,
  formatRelationshipLabel,
  formatRelationshipPeriod,
} from '../../lib/relationships/relationshipDisplay'
import type { ResolvedRelationship } from '../../lib/relationships/relationshipTypes'
import type { Person } from '../../types'
import { formatName } from '../people/personDisplay'
import './RelationshipPanel.css'

interface RelationshipPanelProps {
  personA: Person
  personB: Person
  relationships: ResolvedRelationship[]
  peopleById: Map<string, Person>
  /** Which relationship the family considers current. In-memory for now — no schema change. */
  preferredRelationshipId: string | null
  onSelectPreferred: (relationshipId: string) => void
  onClear: () => void
}

/**
 * Shows every relationship between two people at once, because people
 * genuinely hold more than one: someone can be an aunt since a child was
 * born and a stepmother since marrying that child's parent, and the newer
 * one does not erase the older. Nothing here decides which is "the"
 * relationship — the family picks that, and the choice is theirs to
 * change.
 */
export function RelationshipPanel({
  personA,
  personB,
  relationships,
  peopleById,
  preferredRelationshipId,
  onSelectPreferred,
  onClear,
}: RelationshipPanelProps) {
  const nameA = formatName(personA)
  const nameB = formatName(personB)

  return (
    <aside className="relationship-panel" aria-label={`Relationship between ${nameA} and ${nameB}`}>
      <header className="relationship-panel__header">
        <p className="relationship-panel__pair">
          {nameA} <span aria-hidden="true">↔</span> {nameB}
        </p>
        <button type="button" className="relationship-panel__close" onClick={onClear} aria-label="Clear selection">
          ×
        </button>
      </header>

      {relationships.length === 0 ? (
        <p className="relationship-panel__empty">
          No relationship between {nameA} and {nameB} can be traced through the people and connections recorded so
          far.
        </p>
      ) : (
        <>
          <p className="relationship-panel__section-title">
            {relationships.length === 1 ? 'Relationship' : 'Relationship history'}
          </p>
          {/* These periods are an interpretation of the recorded facts, not
              facts in their own right — say so, so a derived year is never
              mistaken for something the family entered. */}
          <p className="relationship-panel__derived-note">
            How long each relationship has held, worked out from recorded birth, death and union dates.
          </p>
          <ul className="relationship-panel__list">
            {relationships.map((relationship) => {
              const isPreferred = relationship.id === preferredRelationshipId
              return (
                <li key={relationship.id}>
                  <button
                    type="button"
                    className={
                      isPreferred
                        ? 'relationship-panel__item relationship-panel__item--preferred'
                        : 'relationship-panel__item'
                    }
                    aria-pressed={isPreferred}
                    onClick={() => onSelectPreferred(relationship.id)}
                  >
                    <span className="relationship-panel__marker" aria-hidden="true">
                      {isPreferred ? '●' : '○'}
                    </span>
                    <span className="relationship-panel__body">
                      <span className="relationship-panel__label">
                        {formatRelationshipLabel(relationship.kind, personA, relationship.lineage)}
                        {isPreferred && <span className="relationship-panel__current">Current</span>}
                      </span>
                      <span className="relationship-panel__period">
                        {formatRelationshipPeriod(relationship.period)}
                      </span>
                      <span className="relationship-panel__reciprocal">
                        {formatReciprocalSentence(
                          relationship.reciprocalKind,
                          personB,
                          personA,
                          relationship.lineage,
                        )}
                      </span>
                    </span>
                  </button>

                  {relationship.path.length > 2 && (
                    <details className="relationship-panel__path">
                      <summary>Connected through</summary>
                      <p>
                        {relationship.path
                          .map((personId) => {
                            const person = peopleById.get(personId)
                            return person ? formatName(person) : 'Unknown'
                          })
                          .join(' → ')}
                      </p>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="relationship-panel__hint">
            Choosing a current relationship only changes what's shown first — every relationship is kept.
          </p>
        </>
      )}

      <div className="relationship-panel__actions">
        <Button variant="secondary" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </aside>
  )
}
