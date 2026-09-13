import { AppHeader, IconButton } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { DetailRow, Section } from '../../components/Detail'
import { Icon } from '../../components/icons'
import { useAuth } from './useAuth'
import { useCloudTrees } from './useCloudTrees'
import type { CloudTreeStore } from '../../lib/cloud/cloudTrees'
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
export function AccountScreen({
  onBack,
  localTreeId,
  localTreeName,
  /** Injected by tests; production uses the configured store. */
  cloudStore,
}: {
  onBack: () => void
  /** The family currently open, which is the one that can be saved. */
  localTreeId: string
  localTreeName: string
  cloudStore?: CloudTreeStore
}) {
  const { state, signIn, signOut, error } = useAuth()
  const accountId = state.status === 'signedIn' ? state.account.id : null
  const cloud = useCloudTrees({
    accountId,
    email: state.status === 'signedIn' ? state.account.email : null,
    displayName: state.status === 'signedIn' ? state.account.displayName : null,
    ...(cloudStore ? { store: cloudStore } : {}),
  })

  // Saved already if the cloud reports a tree with this id. Derived from
  // the cloud rather than kept locally, so a local flag can never claim a
  // tree is saved when it is not.
  const isAdopted = cloud.trees.some((tree) => tree.id === localTreeId)

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

              <Section title="In your account" collapsible={false}>
                {cloud.status === 'loading' && <p className="account__body">Checking…</p>}

                {cloud.status === 'error' && (
                  <p className="account__body">
                    Could not reach your account. Your family trees on this device are unaffected.
                  </p>
                )}

                {cloud.status === 'ready' && cloud.trees.length === 0 && (
                  <p className="account__body">
                    No family trees saved yet. Saving one keeps a copy in your account so you can
                    open it on another device later.
                  </p>
                )}

                {cloud.trees.map((tree) => (
                  <DetailRow
                    key={tree.id}
                    icon={Icon.cloud({ size: 20 })}
                    label={tree.role === 'owner' ? 'Saved to your account' : `Shared with you · ${tree.role}`}
                    value={tree.name}
                  />
                ))}
              </Section>

              {/*
                One tree, named, with a button that says what it does. The
                distinction this screen exists to make is that signing in
                did not do this, and pressing it is the only thing that
                will.
              */}
              <Section title="On this device" collapsible={false}>
                <DetailRow
                  icon={Icon.people({ size: 20 })}
                  label={isAdopted ? 'Saved to your account' : 'Kept on this device only'}
                  value={localTreeName}
                />
              </Section>

              {cloud.error && (
                <p className="account__error" role="alert">
                  {cloud.error} Your family tree on this device has not been changed.
                </p>
              )}

              {!isAdopted && (
                <>
                  <div className="account__action">
                    <Button
                      disabled={cloud.isAdopting || cloud.status === 'loading'}
                      onClick={() => void cloud.adopt(localTreeId)}
                    >
                      {cloud.isAdopting ? 'Saving…' : 'Save this tree to my account'}
                    </Button>
                  </div>
                  <p className="account__note">
                    This uploads a copy of {localTreeName}. Changes you make afterwards stay on this
                    device for now — keeping both in step comes later.
                  </p>
                </>
              )}

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
