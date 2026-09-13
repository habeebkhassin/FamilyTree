import type { AuthAccount, AuthClient } from './authClient'
import { getSupabaseClient } from './supabaseClient'
import type { SupabaseUserLike } from './supabaseClient'

/**
 * Google sign-in through Supabase — Milestone 1.
 *
 * Everything above this file speaks in AuthAccount and AuthClient, so
 * replacing the provider would mean replacing this file and nothing else.
 *
 * The connection itself comes from supabaseClient.ts, which this tab
 * shares with the cloud tree store — two clients would mean two session
 * listeners racing over one stored session.
 */

/**
 * Identity only.
 *
 * `openid email profile` are the three OpenID Connect basics: who you are,
 * your verified address, your name. Nothing here reaches Gmail, Drive,
 * Contacts or Photos, and no later feature should add a scope without a
 * concrete reason a family would recognise.
 */
const IDENTITY_SCOPES = 'openid email profile'

function toAccount(user: SupabaseUserLike): AuthAccount {
  const metadata = user.user_metadata ?? {}
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: metadata.full_name ?? metadata.name ?? null,
  }
}

export class SupabaseAuthClient implements AuthClient {
  async getAccount(): Promise<AuthAccount | null> {
    const client = await getSupabaseClient()
    const { data } = await client.auth.getSession()
    return data.session ? toAccount(data.session.user) : null
  }

  onChange(listener: (account: AuthAccount | null) => void): () => void {
    let unsubscribe: (() => void) | null = null
    let cancelled = false

    void getSupabaseClient().then((client) => {
      if (cancelled) return
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(session ? toAccount(session.user) : null)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    })

    // Safe to call before the client has finished loading: the flag stops
    // the listener ever being attached.
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }

  async signInWithGoogle(): Promise<void> {
    const client = await getSupabaseClient()
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Come back to where we started, base path included — this app is
        // served from a sub-path on GitHub Pages, and dropping it would
        // return the user to a page that does not exist.
        redirectTo: typeof window === 'undefined' ? undefined : window.location.href,
        scopes: IDENTITY_SCOPES,
      },
    })
    if (error) throw new Error(error.message)
  }

  async signOut(): Promise<void> {
    const client = await getSupabaseClient()
    const { error } = await client.auth.signOut()
    if (error) throw new Error(error.message)
  }
}
