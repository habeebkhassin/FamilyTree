import { AppHeader, IconButton } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { DetailRow, Section } from '../../components/Detail'
import { Icon } from '../../components/icons'
import { useAuth } from './useAuth'
import './AccountScreen.css'

/**
 * Signing in, and signing out — Milestone 1.
 *
 * Deliberately the whole of the account interface. There is no profile to
 * edit, no avatar to choose and no settings to keep, because none of those
 * exist yet and a screen full of controls that do nothing would be worse
 * than a short one that is honest.
 *
 * The words avoid saying Supabase, OAuth, session or token. What somebody
 * needs to know is whether they are signed in, as whom, and how to change
 * that.
 */
export function AccountScreen({ onBack }: { onBack: () => void }) {
  const { state, signIn, signOut, error } = useAuth()

  return (
    <>
      <AppHeader
        title="Account"
        leading={
          <IconButton label="Back" onClick={onBack}>
            {Icon.back({ size: 20 })}
          </IconButton>
        }
      />
      <div className="app-page">
        <div className="app-page__inner">
          {error && <p className="account__error" role="alert">{error}</p>}

          {state.status === 'loading' && <p className="account__status">Checking…</p>}

          {state.status === 'unavailable' && (
            <Section title="Signing in" collapsible={false}>
              <p className="account__body">
                This copy of FamilyTree keeps everything on this device. There is no account to
                sign in to, and everything works without one.
              </p>
            </Section>
          )}

          {state.status === 'signedOut' && (
            <>
              <Section title="Signing in" collapsible={false}>
                <p className="account__body">
                  Signing in with Google lets FamilyTree recognise you on your other devices
                  later. It asks Google for your name and email address and nothing else — not
                  your mail, your files, your contacts or your photos.
                </p>
              </Section>

              <div className="account__action">
                <Button onClick={() => void signIn()}>Continue with Google</Button>
              </div>

              {/*
                The promise this milestone has to keep in writing, because
                somebody about to sign in is entitled to know what happens
                to the family they have already recorded.
              */}
              <p className="account__note">
                Your family trees stay on this device. Signing in does not upload, move or change
                any of them.
              </p>
            </>
          )}

          {state.status === 'signedIn' && (
            <>
              <Section title="Signed in" collapsible={false}>
                <DetailRow
                  icon={Icon.people({ size: 20 })}
                  label="Google account"
                  value={state.account.email ?? state.account.displayName ?? 'Signed in'}
                />
                {state.account.displayName && state.account.email && (
                  <DetailRow
                    icon={Icon.note({ size: 20 })}
                    label="Name"
                    value={state.account.displayName}
                  />
                )}
              </Section>

              <p className="account__note">
                Nothing is being saved to your account yet. Your family trees are still kept on
                this device only.
              </p>

              <div className="account__action">
                <Button variant="secondary" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>

              <p className="account__note">
                Signing out leaves every family tree on this device exactly as it is.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
