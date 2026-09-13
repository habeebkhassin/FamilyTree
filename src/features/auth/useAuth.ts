import { useContext } from 'react'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'

/**
 * Sign-in state for any screen that needs it.
 *
 * Separate from the provider so that module exports only a component —
 * mixing a component with anything else breaks React fast refresh, which
 * is why the icon set and the view choices live apart from their
 * components too.
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside an AuthProvider.')
  }
  return value
}
