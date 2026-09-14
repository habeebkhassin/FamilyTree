import { useEffect, useState } from 'react'
import { AuthProvider } from './features/auth/AuthProvider'
import { SignInScreen } from './features/auth/SignInScreen'
import { SplashScreen } from './features/familyTree/SplashScreen'
import { startupView } from './features/auth/startupGate'
import { useAuth } from './features/auth/useAuth'
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
      <StartupGate />
    </AuthProvider>
  )
}

/**
 * Nothing of the family is rendered until we know who is asking.
 *
 * The gate is a separate component from FamilyTreeApp rather than a
 * branch inside it, and that is the whole point: an unauthenticated
 * visitor does not get a hidden workspace, they get no workspace. Because
 * FamilyTreeApp is never mounted, its startup effect never runs — no tree
 * is read, no active family is chosen, and the Create Family screen
 * cannot appear behind a login.
 *
 * It also means signing out unmounts the workspace rather than merely
 * covering it, which is why the screen you return to is genuinely empty
 * of the previous family.
 */
/**
 * Shown once per page load, never again.
 *
 * The splash belongs to arriving at the application, not to every moment
 * of waiting: a later loading state — switching family, say — should be a
 * spinner, because somebody already inside the application does not need
 * to be welcomed into it again.
 *
 * It covers work that was already happening and adds none of its own.
 * There is no minimum duration and no timer: the animation starts with
 * the first paint, the session resolves alongside it, and the moment
 * startup has an answer the answer is what is shown — even if that means
 * the plant is caught half grown. A splash that delayed anybody to finish
 * its own animation would be charging the user for decoration.
 */
let hasGreeted = false

/** Called when startup finishes, so later waits get the ordinary spinner. */
function greetingUsed(): void {
  hasGreeted = true
}

function StartupGate() {
  const { state } = useAuth()
  const view = startupView(state)

  // Read before the first paint that is not loading, so the flag flips
  // exactly once and later waits get the ordinary spinner.
  const greet = !hasGreeted
  if (view !== 'loading') greetingUsed()

  switch (view) {
    case 'loading':
      /*
        The session has not resolved. Showing anything else here is the
        flash of the wrong screen this state exists to prevent.

        The splash occupies this moment; it does not create one. Nothing
        waits for the animation, no timer holds the application back, and
        the instant the session resolves this is replaced — so a warm
        start simply shows less of it.
      */
      return greet ? <SplashScreen /> : <LoadingScreen />
    case 'signIn':
      return <SignInScreen />
    case 'app':
      return <FamilyTreeApp />
  }
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
