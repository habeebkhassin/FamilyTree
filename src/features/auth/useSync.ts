import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudRemoteAdapter } from '../../lib/cloud/cloudRemoteAdapter'
import { isCloudConfigured } from '../../lib/cloud/cloudConfig'
import { SupabaseCloudTreeStore } from '../../lib/cloud/supabaseCloudTrees'
import { NullRemoteAdapter } from '../../lib/sync/remoteAdapter'
import type { RemoteAdapter } from '../../lib/sync/remoteAdapter'
import { getPendingEvents, getRejectedEntries, syncTree } from '../../lib/sync/syncEngine'
import type { SyncOutcome } from '../../lib/sync/syncEngine'

/**
 * Keeping one tree in step — Milestone 3.
 *
 * Runs a cycle when the tree opens, when the browser says it is back
 * online, and when somebody asks. Deliberately not on a timer: a family
 * tree is not a chat window, and a poll that runs whether or not anything
 * happened is the kind of thing that quietly drains a phone.
 */

export type SyncStatus =
  /** No account, or this tree is not in the cloud. Everything works. */
  | 'local'
  | 'syncing'
  | 'upToDate'
  /** Work is waiting: offline, or the last attempt did not get through. */
  | 'waiting'
  /** Something needs a person: sign in again, or a change was refused. */
  | 'attention'

export interface SyncValue {
  status: SyncStatus
  /** One short sentence, in the words somebody would use. */
  detail: string
  pendingCount: number
  syncNow: () => Promise<void>
}

function describe(
  status: SyncStatus,
  pending: number,
  outcome: SyncOutcome | null,
  rejected: number,
): string {
  if (status === 'local') return 'Kept on this device'
  if (status === 'syncing') return 'Syncing…'
  if (status === 'attention') {
    if (rejected > 0) {
      return `${rejected} ${rejected === 1 ? 'change was' : 'changes were'} not accepted`
    }
    return outcome?.failure?.message ?? 'Something needs your attention'
  }
  if (status === 'waiting') {
    if (outcome?.failure?.kind === 'network') return outcome.failure.message
    return pending === 1 ? '1 change waiting to sync' : `${pending} changes waiting to sync`
  }
  return 'Up to date'
}

function defaultAdapter(): RemoteAdapter {
  // With no cloud configured this is the adapter that has always been
  // correct: it accepts nothing and says so, rather than pretending.
  if (!isCloudConfigured()) return new NullRemoteAdapter()
  return new CloudRemoteAdapter(new SupabaseCloudTreeStore())
}

export function useSync({
  familyTreeId,
  /** True only when signed in AND this tree is saved to the account. */
  isCloudTree,
  adapter,
}: {
  familyTreeId: string
  isCloudTree: boolean
  /** Injected by tests. */
  adapter?: RemoteAdapter
}): SyncValue {
  const remote = useMemo(() => adapter ?? defaultAdapter(), [adapter])

  const [status, setStatus] = useState<SyncStatus>('local')
  const [pending, setPending] = useState(0)
  const [rejected, setRejected] = useState(0)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)

  // Guards against two cycles overlapping — a second one would offer the
  // same events again and, though the server would recognise them, there
  // is no reason to make it.
  const running = useRef(false)

  const refreshCounts = useCallback(async () => {
    setPending((await getPendingEvents(familyTreeId)).length)
    setRejected((await getRejectedEntries(familyTreeId)).length)
  }, [familyTreeId])

  const syncNow = useCallback(async () => {
    if (!isCloudTree || running.current) return
    running.current = true
    setStatus('syncing')
    try {
      const result = await syncTree(familyTreeId, remote)
      setOutcome(result)
      const stillPending = (await getPendingEvents(familyTreeId)).length
      const refused = (await getRejectedEntries(familyTreeId)).length
      setPending(stillPending)
      setRejected(refused)

      if (refused > 0) setStatus('attention')
      else if (result.failure?.kind === 'authentication' || result.failure?.kind === 'authorization') {
        setStatus('attention')
      } else if (result.failure || stillPending > 0) setStatus('waiting')
      else setStatus('upToDate')
    } finally {
      running.current = false
    }
  }, [familyTreeId, isCloudTree, remote])

  useEffect(() => {
    if (!isCloudTree) {
      setStatus('local')
      void refreshCounts()
      return
    }
    void syncNow()
  }, [isCloudTree, syncNow, refreshCounts])

  // Coming back online is the one moment worth reacting to.
  useEffect(() => {
    if (!isCloudTree || typeof window === 'undefined') return
    const onOnline = () => void syncNow()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [isCloudTree, syncNow])

  return {
    status,
    detail: describe(status, pending, outcome, rejected),
    pendingCount: pending,
    syncNow,
  }
}
