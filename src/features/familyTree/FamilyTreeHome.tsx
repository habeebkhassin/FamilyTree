import type { FamilyTree } from '../../types'
import { Card } from '../../components/Card'
import './FamilyTreeHome.css'

interface FamilyTreeHomeProps {
  tree: FamilyTree
}

export function FamilyTreeHome({ tree }: FamilyTreeHomeProps) {
  const createdDate = new Date(tree.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="home">
      <header className="home__header">
        <p className="home__eyebrow">Family Tree</p>
        <h1 className="home__title">{tree.name}</h1>
        {tree.description && <p className="home__description">{tree.description}</p>}
      </header>

      <Card className="home__placeholder">
        <h2 className="home__placeholder-title">Your tree starts here</h2>
        <p className="home__placeholder-text">
          Started {createdDate}. Soon you'll be able to add people, connect
          them as family, and see it all as a living tree you can explore.
        </p>
      </Card>
    </div>
  )
}
