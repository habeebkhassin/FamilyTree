import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import type { Person } from '../../types'
import type { PersonPolicyView } from './PersonProfile'

interface PersonClaimCardProps {
  person: Person
  fullName: string
  policy: PersonPolicyView
}

/**
 * "This is me" — associating the person using this device with a record.
 *
 * The wording is the point. Saying you are someone is not the same as
 * anyone having checked, and this card must never blur the two: there is
 * no verification anywhere in the application yet, so it says what it
 * actually knows — that a claim was made on this device — and nothing
 * about identity being confirmed.
 *
 * What the claim does is narrow and stated plainly: it adds the ability to
 * correct your own record. It grants no role, overrides no permission, and
 * cannot make anyone an administrator.
 */
export function PersonClaimCard({ person, fullName, policy }: PersonClaimCardProps) {
  // Nothing useful to say if claiming is unavailable and nobody has claimed.
  if (!policy.onClaim && !policy.isClaimedByYou && !policy.isClaimedByAnother) return null

  return (
    <Card className="person-profile__claim">
      <h2 className="person-profile__section-title">Is this you?</h2>

      {policy.isClaimedByYou ? (
        <>
          <p className="person-profile__claim-state">
            You have said this person is you, on this device.
          </p>
          <p className="person-profile__claim-note">
            That lets you correct {person.firstName}’s details even without editing rights
            elsewhere. It is a note you made yourself — nobody has verified it, and it gives you
            no other access.
          </p>
        </>
      ) : policy.isClaimedByAnother ? (
        <p className="person-profile__claim-state">
          Someone else using this app has said {fullName} is them.
        </p>
      ) : (
        <>
          <p className="person-profile__claim-note">
            If {fullName} is you, say so and you will be able to correct their details. It stays on
            this device, nobody checks it, and it grants no other access.
          </p>
          <Button variant="secondary" onClick={policy.onClaim} disabled={!policy.onClaim}>
            This is me
          </Button>
        </>
      )}
    </Card>
  )
}
