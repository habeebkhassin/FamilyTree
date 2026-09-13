import { createContext } from 'react'
import type { AuthState } from '../../lib/cloud/authClient'

/**
 * The shape of sign-in state, and the context carrying it.
 *
 * Split from AuthProvider so that module exports only a component: mixing
 * a component with a non-component export breaks React fast refresh, the
 * same reason the icon set and the view choices live apart from the
 * components that use them.
 */
export interface AuthContextValue {
  state: AuthState
  /** True when this build has a cloud to sign in to at all. */
  isAvailable: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  /** Set when the last attempt failed, so a screen can say what happened. */
  error: string | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)
