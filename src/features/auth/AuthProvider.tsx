import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthAccount, AuthClient, AuthState } from '../../lib/cloud/authClient'
import { NoAuthClient } from '../../lib/cloud/authClient'
import { isCloudConfigured } from '../../lib/cloud/cloudConfig'
import { SupabaseAuthClient } from '../../lib/cloud/supabaseAuthClient'
import {
  linkCurrentActorToAccount,
  unlinkCurrentActorFromAccount,
} from '../../lib/identity/localActor'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'

/**
 * Sign-in state, in one place — Milestone 1.
 *
 * A context rather than a store, because there is exactly one session per
 * tab and two screens care about it. Anything more would be a second state
 * system for a single boolean and a name.
 *
 * The provider owns the only subscription to the auth client, so nothing
 * else has to know when a session expires, refreshes, or is ended in
 * another tab — it simply re-renders with the new state.
 */

/**
 * Chosen once, at startup.
 *
 * With no keys configured this is NoAuthClient, and the SDK is never
 * downloaded — SupabaseAuthClient imports it dynamically, so naming the
 * class here costs nothing until somebody actually signs in.
 */
function defaultClient(): AuthClient {
  return isCloudConfigured() ? new SupabaseAuthClient() : new NoAuthClient()
}

export function AuthProvider({
  children,
  /** Injected by tests. Production passes nothing and gets the real one. */
  client,
}: {
  children: ReactNode
  client?: AuthClient
}) {
  const available = client !== undefined || isCloudConfigured()

  // Held in a ref so the effect below never re-subscribes because a parent
  // re-rendered, and so the client is constructed exactly once.
  const clientRef = useRef<AuthClient | null>(null)
  if (clientRef.current === null) clientRef.current = client ?? defaultClient()
  const auth = clientRef.current

  const [state, setState] = useState<AuthState>(() =>
    available ? { status: 'loading' } : { status: 'unavailable' },
  )
  const [error, setError] = useState<string | null>(null)

  /**
   * One place turns an account into application state, so signing in
   * through the button and arriving back from Google with a session
   * already in the URL take exactly the same path.
   *
   * Linking the local actor happens here, for the same reason: whichever
   * way the session appeared, the identity edits are attributed to should
   * end up pointing at it.
   */
  const apply = useCallback((account: AuthAccount | null) => {
    if (account) {
      linkCurrentActorToAccount(account.id, account.displayName ?? account.email)
      setState({ status: 'signedIn', account })
    } else {
      unlinkCurrentActorFromAccount()
      setState({ status: 'signedOut' })
    }
  }, [])

  useEffect(() => {
    if (!available) return
    let cancelled = false

    void auth
      .getAccount()
      .then((account) => {
        if (!cancelled) apply(account)
      })
      .catch(() => {
        // A provider that cannot be reached is not a broken application.
        // Fall back to signed out: everything local still works, and the
        // user can try again.
        if (!cancelled) setState({ status: 'signedOut' })
      })

    const unsubscribe = auth.onChange((account) => {
      if (!cancelled) apply(account)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [auth, available, apply])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      await auth.signInWithGoogle()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in did not work. Please try again.')
    }
  }, [auth])

  const signOut = useCallback(async () => {
    setError(null)
    try {
      await auth.signOut()
      // Not waiting for the provider's event: ending the session is what
      // the user asked for, and the interface should say so immediately.
      // An event arriving afterwards applies the same state again.
      apply(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign out did not work. Please try again.')
    }
  }, [auth, apply])

  const value = useMemo<AuthContextValue>(
    () => ({ state, isAvailable: available, signIn, signOut, error }),
    [state, available, signIn, signOut, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
