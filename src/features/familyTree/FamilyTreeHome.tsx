import type { FamilyTree, Person } from '../../types'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { PersonCard } from '../people/PersonCard'
import './FamilyTreeHome.css'

type PeopleStatus = 'loading' | 'ready' | 'error'

interface FamilyTreeHomeProps {
  tree: FamilyTree
  people: Person[]
  status: PeopleStatus
  onAddPerson: () => void
  onOpenPerson: (personId: string) => void
  onRetry: () => void
}

export function FamilyTreeHome({ tree, people, status, onAddPerson, onOpenPerson, onRetry }: FamilyTreeHomeProps) {
  return (
    <div className="home">
      <header className="home__header">
        <p className="home__eyebrow">Family Tree</p>
        <h1 className="home__title">{tree.name}</h1>
        {tree.description && <p className="home__description">{tree.description}</p>}
      </header>

      {status === 'loading' && <p className="home__status">Loading your family…</p>}

      {status === 'error' && (
        <Card className="home__status-card">
          <p>Something went wrong loading your family.</p>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </Card>
      )}

      {status === 'ready' && people.length === 0 && (
        <Card className="home__empty">
          <h2 className="home__empty-title">Your family story starts with a person.</h2>
          <p className="home__empty-text">
            You can add parents, partners, siblings and children as your family grows.
          </p>
          <Button onClick={onAddPerson}>Add first person</Button>
        </Card>
      )}

      {status === 'ready' && people.length > 0 && (
        <>
          <div className="home__toolbar">
            <p className="home__count">
              {people.length} {people.length === 1 ? 'person' : 'people'} in this tree
            </p>
            <Button onClick={onAddPerson}>Add another person</Button>
          </div>
          <div className="home__grid">
            {people.map((person) => (
              <PersonCard key={person.id} person={person} onClick={() => onOpenPerson(person.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
