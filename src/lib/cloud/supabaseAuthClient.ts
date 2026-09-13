import type { AuthAccount, AuthClient } from './authClient'
import { readCloudConfig } from './cloudConfig'

/**
 * Google sign-in through Supabase — Milestone 1.
 *
 * The only file in the application that names Supabase. Everything else
 * speaks in AuthAccount and AuthClient, so replacing the provider would
 * mean replacing this file and nothing above it.
 *
 *
 * LOADED ONLY IF USED
 * ───────────────────
 * The SDK is imported dynamically rather than at the top of the module.
 * A build with no cloud configured never reaches this code, so it never
 * downloads the client — which matters: the application bundle is already
 * over two megabytes and the offline, signed-out experience is the one
 * this project promises will always work. A signed-out visitor should not
 * pay for an authentication library they are not being offered.
 */

/** The provider's own shape, narrowed to what this application uses. */
interface SupabaseUserLike {
  id: string
  email?: string | null
  user_metadata?: { full_name?: string | null; name?: string | null } | null
}

interface SupabaseSessionLike {
  user: SupabaseUserLike
}

interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: SupabaseSessionLike | null } }>
  onAuthStateChange(
    callback: (event: string, session: SupabaseSessionLike | null) => void,
  ): { data: { subscription: { unsubscribe: () => void } } }
  signInWithOAuth(options: {
    provider: 'google'
    options?: { redirectTo?: string; scopes?: string }
  }): Promise<{ error: { message: string } | null }>
  signOut(): Promise<{ error: { message: string } | null }>
}

interface SupabaseClientLike {
  auth: SupabaseAuthLike
}

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
  #client: Promise<SupabaseClientLike> | null = null

  /**
   * One client, created on first use and reused. Constructing two would
   * give the tab two session listeners and two refresh timers racing over
   * the same stored token.
   */
  #connect(): Promise<SupabaseClientLike> {
    if (this.#client) return this.#client

    const config = readCloudConfig()
    if (!config) {
      // Constructing this class at all without configuration is a
      // programming error, not a user-facing condition — the application
      // chooses NoAuthClient in that case.
      throw new Error('SupabaseAuthClient requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
    }

    this.#client = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.url, config.anonKey, {
        auth: {
          // The session survives a reload, which is what anybody expects
          // of being signed in.
          persistSession: true,
          autoRefreshToken: true,
          // The provider returns to the app with the session in the URL;
          // this is what picks it up.
          detectSessionInUrl: true,
        },
      }) as unknown as SupabaseClientLike,
    )
    return this.#client
  }

  async getAccount(): Promise<AuthAccount | null> {
    const client = await this.#connect()
    const { data } = await client.auth.getSession()
    return data.session ? toAccount(data.session.user) : null
  }

  onChange(listener: (account: AuthAccount | null) => void): () => void {
    let unsubscribe: (() => void) | null = null
    let cancelled = false

    void this.#connect().then((client) => {
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
    const client = await this.#connect()
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
    const client = await this.#connect()
    const { error } = await client.auth.signOut()
    if (error) throw new Error(error.message)
  }
}
