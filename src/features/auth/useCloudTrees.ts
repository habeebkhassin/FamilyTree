import { useCallback, useEffect, useMemo, useState } from 'react'
import { adoptLocalTree } from '../../lib/cloud/adoptTree'
import { NoCloudTreeStore } from '../../lib/cloud/cloudTrees'
import type { CloudTreeStore, CloudTreeSummary } from '../../lib/cloud/cloudTrees'
import { isCloudConfigured } from '../../lib/cloud/cloudConfig'
import { SupabaseCloudTreeStore } from '../../lib/cloud/supabaseCloudTrees'

/**
 * What this account has in the cloud, and how a local tree joins it.
 *
 * Only ever loads when somebody is signed in. Nothing here runs on
 * startup, nothing runs on sign-in beyond a single read of the list, and
 * adoption runs only when a button is pressed.
 */

export type CloudTreesStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CloudTreesValue {
  status: CloudTreesStatus
  trees: CloudTreeSummary[]
  error: string | null
  /** True while a tree is being saved, so the button can say so. */
  isAdopting: boolean
  refresh: () => Promise<void>
  adopt: (familyTreeId: string) => Promise<void>
}

function defaultStore(): CloudTreeStore {
  return isCloudConfigured() ? new SupabaseCloudTreeStore() : new NoCloudTreeStore()
}

export function useCloudTrees({
  accountId,
  displayName,
  store,
}: {
  /** Null when signed out. The hook does nothing at all in that case. */
  accountId: string | null
  displayName?: string | null
  /** Injected by tests. */
  store?: CloudTreeStore
}): CloudTreesValue {
  const cloud = useMemo(() => store ?? defaultStore(), [store])
  const [status, setStatus] = useState<CloudTreesStatus>('idle')
  const [trees, setTrees] = useState<CloudTreeSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isAdopting, setIsAdopting] = useState(false)

  const load = useCallback(async () => {
    if (!accountId) {
      setTrees([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      // The profile is created the first time this account touches the
      // cloud rather than when it signs in, so signing in alone writes
      // nothing anywhere.
      await cloud.ensureProfile(displayName ?? null)
      setTrees(await cloud.listTrees())
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach your account.')
      setStatus('error')
    }
  }, [cloud, accountId, displayName])

  useEffect(() => {
    void load()
  }, [load])

  const adopt = useCallback(
    async (familyTreeId: string) => {
      setIsAdopting(true)
      setError(null)
      try {
        await adoptLocalTree(familyTreeId, cloud)
        setTrees(await cloud.listTrees())
        setStatus('ready')
      } catch (cause) {
        // The local tree is untouched whatever happened — adoption only
        // ever reads from Dexie. Saying so is the useful part.
        setError(cause instanceof Error ? cause.message : 'Could not save this family tree.')
      } finally {
        setIsAdopting(false)
      }
    },
    [cloud],
  )

  return { status, trees, error, isAdopting, refresh: load, adopt }
}
