import { useEffect, useState } from 'react'
import { WelcomeScreen } from './features/familyTree/WelcomeScreen'
import { FamilyTreeHome } from './features/familyTree/FamilyTreeHome'
import { LoadingScreen } from './features/familyTree/LoadingScreen'
import {
  createFamilyTree,
  getAllFamilyTrees,
  getFamilyTree,
  type CreateFamilyTreeInput,
} from './lib/storage'
import { getStoredActiveFamilyTreeId, setStoredActiveFamilyTreeId } from './lib/preferences'
import type { FamilyTree } from './types'

type AppStatus = 'loading' | 'welcome' | 'ready'

function App() {
  const [status, setStatus] = useState<AppStatus>('loading')
  const [activeTree, setActiveTree] = useState<FamilyTree | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadActiveFamilyTree() {
      const storedId = getStoredActiveFamilyTreeId()
      let tree = storedId ? await getFamilyTree(storedId) : undefined

      if (!tree) {
        const [mostRecentlyUsed] = await getAllFamilyTrees()
        tree = mostRecentlyUsed
      }

      if (cancelled) return

      if (tree) {
        setStoredActiveFamilyTreeId(tree.id)
        setActiveTree(tree)
        setStatus('ready')
      } else {
        setStatus('welcome')
      }
    }

    void loadActiveFamilyTree()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreateFamilyTree(input: CreateFamilyTreeInput) {
    const tree = await createFamilyTree(input)
    setStoredActiveFamilyTreeId(tree.id)
    setActiveTree(tree)
    setStatus('ready')
  }

  if (status === 'loading') return <LoadingScreen />
  if (status === 'ready' && activeTree) return <FamilyTreeHome tree={activeTree} />
  return <WelcomeScreen onCreate={handleCreateFamilyTree} />
}

export default App
