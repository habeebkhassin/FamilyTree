import { useState } from 'react'
import { AppHeader, IconButton } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { DetailRow, Section } from '../../components/Detail'
import { Field } from '../../components/Field'
import { Icon } from '../../components/icons'
import type { InvitableRole } from '../../lib/cloud/cloudSharing'
import { useSharing } from './useSharing'
import './ShareScreen.css'

/**
 * Who this family is shared with — Milestone 4.
 *
 * Deliberately one screen and no more. A family tree is shared with a
 * handful of relatives, not administered; anything resembling a console
 * would be answering a question nobody here has.
 *
 * Everything on it is a request the server decides. An owner sees the
 * controls because `isOwner` came back from the database, not because the
 * interface worked it out — and if it were wrong, every one of these
 * actions would still be refused.
 */
export function ShareScreen({
  familyTreeId,
  familyTreeName,
  accountId,
  isCloudTree,
  onBack,
}: {
  familyTreeId: string
  familyTreeName: string
  accountId: string | null
  isCloudTree: boolean
  onBack: () => void
}) {
  const sharing = useSharing({ familyTreeId, accountId, isCloudTree })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('viewer')

  const send = async () => {
    if (!email.trim()) return
    await sharing.invite(email.trim(), role)
    setEmail('')
  }

  return (
    <>
      <AppHeader
        title="Share family"
        subtitle={familyTreeName}
        leading={
          <IconButton label="Back" onClick={onBack}>
            {Icon.back({ size: 20 })}
          </IconButton>
        }
      />
      <div className="app-page">
        <div className="app-page__inner">
          {sharing.error && (
            <p className="account__error" role="alert">
              {sharing.error}
            </p>
          )}

          {!isCloudTree && (
            <Section title="Sharing" collapsible={false}>
              <p className="account__body">
                Save this family tree to your account first. Sharing works on the copy in your
                account, so there is something for the other person to open.
              </p>
            </Section>
          )}

          {isCloudTree && (
            <>
              <Section title="People with access" collapsible={false}>
                {sharing.isLoading && sharing.members.length === 0 && (
                  <p className="account__body">Checking…</p>
                )}
                {sharing.members.map((member) => (
                  <div key={member.accountId} className="share-member">
                    <DetailRow
                      icon={Icon.people({ size: 20 })}
                      label={
                        member.role === 'owner'
                          ? 'Owner'
                          : member.role === 'editor'
                            ? 'Can edit'
                            : 'Can view'
                      }
                      value={
                        (member.displayName ?? member.email ?? 'Someone') + (member.isYou ? ' (you)' : '')
                      }
                    />
                    {/* Only an owner may change anybody, and never themselves. */}
                    {sharing.isOwner && !member.isYou && member.role !== 'owner' && (
                      <div className="share-member__actions">
                        <button
                          type="button"
                          className="share-member__action"
                          onClick={() =>
                            void sharing.changeRole(
                              member.accountId,
                              member.role === 'editor' ? 'viewer' : 'editor',
                            )
                          }
                        >
                          {member.role === 'editor' ? 'Change to view only' : 'Let them edit'}
                        </button>
                        <button
                          type="button"
                          className="share-member__action share-member__action--remove"
                          onClick={() => void sharing.removeMember(member.accountId)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </Section>

              {sharing.isOwner && sharing.invitations.length > 0 && (
                <Section title="Invitations sent" collapsible={false}>
                  {sharing.invitations.map((invitation) => (
                    <div key={invitation.id} className="share-member">
                      <DetailRow
                        icon={Icon.note({ size: 20 })}
                        label={invitation.role === 'editor' ? 'Invited to edit' : 'Invited to view'}
                        value={invitation.email}
                      />
                      <div className="share-member__actions">
                        <button
                          type="button"
                          className="share-member__action share-member__action--remove"
                          onClick={() => void sharing.revoke(invitation.id)}
                        >
                          Withdraw
                        </button>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {sharing.isOwner && (
                <Section title="Invite someone" collapsible={false}>
                  <p className="account__body">
                    They will need to sign in with the same Google account this is sent to.
                  </p>
                  <Field label="Their email address" htmlFor="invite-email">
                    <input
                      id="invite-email"
                      type="email"
                      value={email}
                      placeholder="cousin@example.com"
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>

                  {/*
                    Two choices. Owner is not among them: there is one
                    owner and it moves by transfer, never by invitation.
                  */}
                  <fieldset className="share-roles">
                    <legend className="share-roles__legend">What they can do</legend>
                    {(
                      [
                        { value: 'viewer', label: 'View only' },
                        { value: 'editor', label: 'View and edit' },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={role === option.value ? 'pill pill--on' : 'pill'}
                        aria-pressed={role === option.value}
                        onClick={() => setRole(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </fieldset>

                  <div className="account__action">
                    <Button disabled={!email.trim()} onClick={() => void send()}>
                      Send invitation
                    </Button>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
