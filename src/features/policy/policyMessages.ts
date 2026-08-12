import type { PolicyReason } from '../../lib/policy/can'

/**
 * Turns a policy reason into something a person can act on.
 *
 * Lives in the feature layer, not in lib/policy: the engine decides, the
 * interface explains. A `Record` rather than a switch so adding a reason
 * without wording it is a type error.
 */
const MESSAGES: Record<PolicyReason, string> = {
  ungovernedTree: '',
  role: '',
  ownClaimedPerson: 'This is the person you have said is you, so you can correct their details.',
  notAMember: 'You are not a member of this family tree.',
  membershipNotActive: 'Your access to this family tree is not active at the moment.',
  insufficientRole: 'Your role in this family tree does not allow this.',
  cannotActOnEqualOrHigherRank: 'You cannot change someone with the same or more access than you.',
  cannotGrantAboveOwnRole: 'You cannot give someone more access than you have.',
  ownerIsProtected: 'The owner cannot be changed this way — the tree has to be handed over instead.',
  unknownTarget: 'That person is no longer here.',
}

/** Empty when the action is simply allowed and needs no explanation. */
export function describePolicyReason(reason: PolicyReason): string {
  return MESSAGES[reason]
}
