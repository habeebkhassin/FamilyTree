import { useEffect, useState } from 'react'
import { AuthProvider } from './features/auth/AuthProvider'
import { WelcomeScreen } from './features/familyTree/WelcomeScreen'
import { FamilyTreeWorkspace } from './features/familyTree/FamilyTreeWorkspace'
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

/**
 * Sign-in state wraps the whole application — Milestone 1.
 *
 * Above the tree rather than inside it, because a session belongs to the
 * device and not to whichever family is open, and because switching
 * families remounts the workspace: holding it any lower would re-check the
 * session every time somebody changed tree.
 */
function App() {
  return (
    <AuthProvider>
      <FamilyTreeApp />
    </AuthProvider>
  )
}

function FamilyTreeApp() {
  const [status, setStatus] = useState<AppStatus>('loading')
  const [activeTree, setActiveTree] = useState<FamilyTree | null>(null)
  /**
   * How many families this device holds.
   *
   * Used only to decide whether switching is offered at all. The
   * application has always been able to hold several — restoring a backup
   * creates one — but until now there was no way back to the others.
   */
  const [familyCount, setFamilyCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadActiveFamilyTree() {
      const storedId = getStoredActiveFamilyTreeId()
      const all = await getAllFamilyTrees()
      let tree = storedId ? await getFamilyTree(storedId) : undefined

      if (!tree) {
        const [mostRecentlyUsed] = all
        tree = mostRecentlyUsed
      }

      if (cancelled) return

      setFamilyCount(all.length)

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
    setFamilyCount((count) => count + 1)
    setStatus('ready')
  }

  /** Opening one of the other families already on this device. */
  async function handleSwitchFamily(familyTreeId: string) {
    const tree = await getFamilyTree(familyTreeId)
    if (!tree) return
    setStoredActiveFamilyTreeId(tree.id)
    setActiveTree(tree)
  }

  /**
   * A backup was restored into a brand-new tree. Switch to it, because a
   * restore that leaves you looking at the tree you already had gives no
   * sign it worked.
   */
  async function handleTreeImported(familyTreeId: string) {
    const tree = await getFamilyTree(familyTreeId)
    if (!tree) return
    setStoredActiveFamilyTreeId(tree.id)
    setActiveTree(tree)
    // A restore adds a family, so switching becomes possible from here.
    setFamilyCount((await getAllFamilyTrees()).length)
    setStatus('ready')
  }

  if (status === 'loading') return <LoadingScreen />
  if (status === 'ready' && activeTree) {
    return (
      <FamilyTreeWorkspace
        // Remounts when the family changes, so no screen, focal person or
        // collapsed branch survives from the family you just left.
        key={activeTree.id}
        tree={activeTree}
        onTreeImported={handleTreeImported}
        familyCount={familyCount}
        onSwitchFamily={handleSwitchFamily}
      />
    )
  }
  return <WelcomeScreen onCreate={handleCreateFamilyTree} />
}

export default App
