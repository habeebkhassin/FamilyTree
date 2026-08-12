import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  popFocusHistory,
  pruneFocusHistory,
  pushFocusHistory,
  resolveFocalPerson,
} from '../../lib/focalPerson'
import type { FocalPersonSource } from '../../lib/focalPerson'
import type { PersonClaim } from '../../lib/policy/membershipTypes'
import {
  clearStoredFocalPersonId,
  getStoredFocalPersonId,
  setStoredFocalPersonId,
} from '../../lib/preferences'
import type { Person } from '../../types'

interface UseFocalPersonInput {
  familyTreeId: string
  people: Person[]
  claims: readonly PersonClaim[]
  actorId: string | null
  /**
   * Whether `people` is the real membership of the tree yet.
   *
   * Load-bearing. While the graph is loading, `people` is empty, which is
   * indistinguishable from "everyone in this tree has been deleted" — and
   * acting on that would clear a perfectly good preference on every
   * reload. Nothing is pruned or forgotten until the data has actually
   * arrived.
   */
  isReady: boolean
}

/**
 * Owns the viewpoint for one family tree — Phase 5C-1.
 *
 * Lives at the workspace rather than inside the canvas so the trail
 * survives stepping into a profile and back; the canvas unmounts on every
 * screen change and would forget where the user had walked.
 *
 * Only the CURRENT focal person persists. The trail is session state: it
 * is a way back from where you just went, not a record of anything, and
 * restoring a stale path after a reload would be confusing rather than
 * helpful.
 */
export function useFocalPerson({
  familyTreeId,
  people,
  claims,
  actorId,
  isReady,
}: UseFocalPersonInput) {
  const [explicitPersonId, setExplicitPersonId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [isPromptDismissed, setIsPromptDismissed] = useState(false)

  const livePersonIds = useMemo(() => new Set(people.map((person) => person.id)), [people])

  // Read on every resolve rather than cached, so a value written by
  // another tab or an earlier session is picked up without extra wiring.
  const storedPersonId = getStoredFocalPersonId(familyTreeId)

  const resolution = useMemo(() => {
    // While the tree is loading, `people` is empty and every candidate
    // would look deleted. Honour the remembered choice optimistically so
    // the viewpoint does not flicker, and decide nothing else — if that
    // person really has gone, the resolve below corrects it a moment
    // later, and nothing has been thrown away in the meantime.
    if (!isReady) {
      return { personId: storedPersonId ?? null, source: 'stored' as const, stalePersonId: null }
    }
    return resolveFocalPerson({
      explicitPersonId,
      storedPersonId,
      claims,
      actorId,
      livePersonIds,
    })
  }, [isReady, explicitPersonId, storedPersonId, claims, actorId, livePersonIds])

  // A preference naming someone who has since been deleted is cleared
  // rather than re-resolved on every render for the life of the tree.
  useEffect(() => {
    if (isReady && resolution.stalePersonId) clearStoredFocalPersonId(familyTreeId)
  }, [isReady, resolution.stalePersonId, familyTreeId])

  // Deleting the person you were standing on must not leave a dangling
  // trail pointing at them.
  useEffect(() => {
    if (!isReady) return
    setHistory((current) => {
      const pruned = pruneFocusHistory(current, livePersonIds)
      return pruned.length === current.length ? current : pruned
    })
  }, [isReady, livePersonIds])

  const focalPersonId = resolution.personId

  const focusOn = useCallback(
    (personId: string) => {
      setExplicitPersonId(personId)
      setStoredFocalPersonId(familyTreeId, personId)
      setHistory((current) =>
        // Seed the trail with wherever the view already was, so the first
        // step back returns somewhere real instead of nowhere.
        pushFocusHistory(
          current.length === 0 && focalPersonId ? [focalPersonId] : current,
          personId,
        ),
      )
    },
    [familyTreeId, focalPersonId],
  )

  const goBack = useCallback(() => {
    setHistory((current) => {
      const { history: next, personId } = popFocusHistory(current)
      if (personId) {
        setExplicitPersonId(personId)
        setStoredFocalPersonId(familyTreeId, personId)
      }
      return next
    })
  }, [familyTreeId])

  const clearFocus = useCallback(() => {
    setExplicitPersonId(null)
    clearStoredFocalPersonId(familyTreeId)
    setHistory([])
  }, [familyTreeId])

  return {
    focalPersonId,
    /** How it was arrived at — the UI says so, since a claim is not verified identity. */
    source: resolution.source as FocalPersonSource,
    /** Oldest first, current last. Empty until the user has moved at least once. */
    history,
    focusOn,
    goBack,
    clearFocus,
    /** Offer to ask who they are: nobody is focused, and they have not waved it away. */
    shouldPromptForFocus: focalPersonId === null && !isPromptDismissed && people.length > 0,
    dismissPrompt: useCallback(() => setIsPromptDismissed(true), []),
  }
}
