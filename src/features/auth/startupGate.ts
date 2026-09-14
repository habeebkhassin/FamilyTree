import type { AuthState } from '../../lib/cloud/authClient'

/**
 * What the application shows before it shows anything else.
 *
 * A pure function of the session state, separated from the component so
 * it can be reasoned about and tested directly — the decision is small
 * but it is the one that stands between a stranger and a family's
 * records, and "I looked at the JSX and it seemed right" is not how that
 * should be established.
 *
 *
 * WHY `loading` IS ITS OWN ANSWER
 * ───────────────────────────────
 * Resolving a session takes a moment, and during that moment we do not
 * know whether anybody is signed in. Treating "not yet known" as "signed
 * out" would flash a sign-in screen at somebody who is already signed in;
 * treating it as "signed in" would flash the Create Family screen at
 * somebody who is not. Both are wrong, so neither is guessed: nothing but
 * a loading state is shown until the session has actually resolved.
 *
 *
 * WHY `unavailable` OPENS THE APPLICATION
 * ───────────────────────────────────────
 * `unavailable` means this build has no cloud configured at all, and it
 * is a supported way to run FamilyTree — the whole application works with
 * everything kept on one device, and always has.
 *
 * Demanding a sign-in there would not be secure, it would be broken:
 * there is no provider to sign in to, the button would throw, and the
 * only outcome would be a family locked out of their own records by a
 * screen they cannot get past. A gate you cannot open is not a gate.
 *
 * Requiring an account is therefore about builds that HAVE an account to
 * require. Where there is a cloud, nothing of the family is shown until
 * somebody has signed in.
 */
export type StartupView =
  /** The session has not resolved yet. Show nothing else. */
  | 'loading'
  /** There is a cloud, and nobody is signed in. */
  | 'signIn'
  /** Carry on into the application exactly as before. */
  | 'app'

export function startupView(state: AuthState): StartupView {
  switch (state.status) {
    case 'loading':
      return 'loading'
    case 'signedOut':
      return 'signIn'
    case 'signedIn':
      return 'app'
    case 'unavailable':
      return 'app'
  }
}
