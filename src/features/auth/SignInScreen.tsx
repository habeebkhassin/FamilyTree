import { useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { useAuth } from './useAuth'
import './SignInScreen.css'

/**
 * The way in.
 *
 * Deliberately the same shape as the Welcome card — one card, an eyebrow,
 * a sentence, one action — because this is the first screen of THIS
 * application, not a checkpoint bolted in front of it. Somebody opening
 * FamilyTree should recognise where they are.
 *
 * No logo wall, no marketing, no second column of feature bullets, no
 * "Don't have an account?". There is one thing to do here and everything
 * on the screen is either that thing or the short explanation somebody
 * deserves before they hand over an identity.
 */
export function SignInScreen() {
  const { signIn, error } = useAuth()
  const [busy, setBusy] = useState(false)

  async function handleSignIn() {
    setBusy(true)
    try {
      await signIn()
      // Deliberately left busy on success: the browser is on its way to
      // Google, and a button that springs back to "Continue" invites a
      // second click into a redirect already under way.
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <Card className="signin__card">
        <p className="signin__eyebrow">Family Tree</p>
        <h1 className="signin__title">Sign in to continue.</h1>
        <p className="signin__subtitle">
          Your family's records are kept to your account, so they are there when you open
          FamilyTree on another device — and nobody else's account can reach them.
        </p>

        {error && (
          <p className="signin__error" role="alert">
            {error}
          </p>
        )}

        <div className="signin__action">
          <Button onClick={() => void handleSignIn()} disabled={busy}>
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </Button>
        </div>

        {/*
          Said plainly, and said before the button rather than after it.
          A family tree has no business with somebody's mail or photos,
          and the person about to sign in is the one entitled to know
          that this one does not ask for them.
        */}
        <p className="signin__note">
          FamilyTree asks Google for your name and email address, and nothing else — not your
          mail, your files, your contacts or your photos.
        </p>
      </Card>
    </div>
  )
}
