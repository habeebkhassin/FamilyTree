/**
 * Who is signed in — Milestone 1.
 *
 * The seam between this application and an authentication provider,
 * declared the same way and for the same reason as RemoteAdapter: so that
 * everything above it stays testable with no network, no browser and no
 * Google account, and so the shape is decided by what this application
 * needs rather than by what a vendor's SDK happens to return.
 *
 *
 * IDENTITY, AND NOTHING ELSE
 * ──────────────────────────
 * An AuthAccount carries an id, and an email and name only if the provider
 * offered them. There is no token here, no scope list and no provider
 * name, because nothing above this line has any business with them.
 *
 * The scopes requested are `openid email profile` and no others. This
 * application needs to know who somebody is; it has no reason to read
 * their mail, their files, their contacts or their photos, and asking for
 * access it does not need would be the wrong thing to put in front of a
 * family.
 *
 *
 * AND IT IS NOT AUTHORISATION
 * ───────────────────────────
 * Being signed in says who you are. It says nothing about what you may do
 * to any family tree, and no code may read it that way. Authorisation
 * arrives when family data is in the cloud behind row-level security;
 * until then the only permission model is the local one in lib/policy,
 * which is explicitly not a security boundary either.
 */

export interface AuthAccount {
  /** Stable account id from the provider. The cloud identity. */
  id: string
  /** Verified by the provider when present. Absent is normal, not an error. */
  email: string | null
  /** Whatever name the provider gave. Display only. */
  displayName: string | null
}

/**
 * What the application knows about sign-in at a given moment.
 *
 * `loading` is a real state rather than a null account, because "we have
 * not asked yet" and "nobody is signed in" must not look the same: an
 * interface that renders the second while the first is true flashes a
 * sign-in button at somebody who is already signed in.
 */
export type AuthState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; account: AuthAccount }

export interface AuthClient {
  /** The session this device already holds, if any. */
  getAccount(): Promise<AuthAccount | null>
  /**
   * Called whenever the provider reports a change — a completed sign-in, a
   * sign-out, an expired or refreshed session. Returns an unsubscribe.
   */
  onChange(listener: (account: AuthAccount | null) => void): () => void
  /**
   * Starts the Google flow. Returns when the redirect has been requested;
   * the session itself arrives through `onChange` once the user comes back.
   */
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}

/**
 * The client for having no cloud, which is every build with no keys set.
 *
 * A sibling of NullRemoteAdapter, and not a placeholder to be deleted: it
 * is what the application genuinely uses when there is nothing to sign in
 * to. It reports no account and refuses to pretend — attempting to sign in
 * throws rather than resolving, so a caller can never mistake "there is no
 * provider" for "the sign-in is under way".
 */
export class NoAuthClient implements AuthClient {
  async getAccount(): Promise<AuthAccount | null> {
    return null
  }

  onChange(): () => void {
    return () => {}
  }

  async signInWithGoogle(): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured, so there is nothing to sign in to.')
  }

  async signOut(): Promise<void> {
    // Nothing to end. Deliberately not an error: signing out of nothing
    // is a no-op, not a failure, and a caller tidying up on startup
    // should not have to special-case it.
  }
}
