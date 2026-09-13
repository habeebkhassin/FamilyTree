import { readCloudConfig } from './cloudConfig'

/**
 * The one Supabase connection this tab has — Milestone 2.
 *
 * ONE, and that is the point. Two `createClient` calls give a tab two
 * session listeners and two token-refresh timers racing over the same
 * stored session, which is the kind of fault that only shows up as a
 * mysterious sign-out an hour into someone's afternoon. Authentication
 * and the cloud tree store both come through here.
 *
 * The SDK is imported dynamically so a build with no cloud configured
 * never downloads it — it is over 200kB, and the signed-out, offline
 * experience is the one this project promises always works.
 */

/** Only what this application calls. Narrow on purpose: an SDK surface
    this code does not use is an SDK surface it cannot come to depend on. */
export interface SupabaseLike {
  auth: {
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
  from(table: string): SupabaseQueryLike
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface SupabaseQueryLike {
  select(columns?: string): SupabaseFilterLike
}

export interface SupabaseFilterLike extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: unknown): SupabaseFilterLike
  order(column: string, options?: { ascending?: boolean }): SupabaseFilterLike
}

export interface SupabaseUserLike {
  id: string
  email?: string | null
  user_metadata?: { full_name?: string | null; name?: string | null } | null
}

export interface SupabaseSessionLike {
  user: SupabaseUserLike
}

let connection: Promise<SupabaseLike> | null = null

export function getSupabaseClient(): Promise<SupabaseLike> {
  if (connection) return connection

  const config = readCloudConfig()
  if (!config) {
    // Reaching here without configuration is a programming error rather
    // than a user-facing condition: the application picks the local-only
    // implementations when there is no cloud.
    return Promise.reject(
      new Error('No cloud is configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'),
    )
  }

  connection = import('@supabase/supabase-js').then(
    ({ createClient }) =>
      createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }) as unknown as SupabaseLike,
  )
  return connection
}
