/**
 * Who belongs to a family tree, and in what capacity — Phase 5B-2.
 *
 * These are records, not policy. The rules that read them live in `can.ts`.
 *
 * NONE OF THIS IS A SECURITY BOUNDARY YET. Every field here is written by
 * the client, and until a server owns them a client can grant itself any
 * role it likes. They exist so the model is real, exercised and testable
 * before a backend arrives — and so the eventual backend inherits a shape
 * rather than dictating one.
 *
 * Not yet persisted: there is no Dexie table and no schema change. See the
 * note at the end of `can.ts` for why persistence is a separate step.
 */

/**
 * Deliberately four, and deliberately flat.
 *
 * A role is answerable from ONE membership row. Nothing here means "may
 * edit this branch of the family" — a rule like that needs a recursive
 * walk of the genealogy on every check, which is expensive and awkward to
 * express in row-level security, and it hands people partial graphs, which
 * make the relationship engine confidently wrong (a half-sibling reported
 * as a full sibling because the other parent was hidden).
 *
 * The one person-level capability that does exist is self-edit, and it
 * comes from an explicit PersonClaim rather than from graph position.
 */
export type FamilyRole = 'owner' | 'admin' | 'editor' | 'viewer'

/**
 * Higher outranks lower. Used for "an admin may not act on an owner" and
 * "nobody may promote someone above themselves".
 */
export const ROLE_RANK: Record<FamilyRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
}

/**
 * Membership lifecycle.
 *
 * There is no `deletedAt` here on purpose. Every other syncable record
 * tombstones, but a membership should never be removed — revoking access
 * is a status change, which stays auditable and avoids two competing ways
 * to express "gone". Same reasoning as FamilyGroupMember carrying no role
 * field: one fact, one place.
 */
export type MembershipStatus =
  /** Full participant. */
  | 'active'
  /** Invited but has not accepted; holds no capabilities yet. */
  | 'invited'
  /** Access withdrawn without erasing that they were here. */
  | 'suspended'
  /** Left voluntarily. */
  | 'left'

/**
 * What namespace a subject id belongs to.
 *
 * A LocalActor id is NOT an account id and must never be silently promoted
 * into one: the local actor is a self-asserted name on one device, while
 * an account is something a server vouches for. Recording which kind a row
 * refers to means the eventual account system can add its own rows
 * alongside the local ones and link them, rather than having to guess what
 * existing ids meant.
 *
 * The shape this must be able to grow into:
 *
 *   Account ──< FamilyTreeMember ──< PersonClaim ──> Person
 *
 * One account may hold memberships in many family trees, and one family
 * tree may have many accounts. Nothing here assumes either is singular.
 */
export type MemberSubjectKind = 'localActor' | 'account'

export interface FamilyTreeMember {
  id: string
  familyTreeId: string
  /**
   * A LocalActor id today (lib/identity), an account id later. Read
   * `subjectKind` before assuming which — the two namespaces are
   * deliberately not interchangeable.
   */
  actorId: string
  subjectKind: MemberSubjectKind
  role: FamilyRole
  status: MembershipStatus
  invitedByActorId?: string
  joinedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * "This person record is me."
 *
 * The bridge between being a SUBJECT of the archive and an ACTOR on it.
 * Most people in a tree will never be actors; some actors will never
 * appear as people. Kept as an explicit, revocable record rather than a
 * field on Person for exactly that reason.
 *
 * What it buys is self-edit: a Viewer may still correct their own birth
 * date. That is humane, and it is the only person-level capability in the
 * model.
 */
export interface PersonClaim {
  id: string
  familyTreeId: string
  personId: string
  actorId: string
  subjectKind: MemberSubjectKind
  status: PersonClaimStatus
  createdAt: string
  updatedAt: string
}

export type PersonClaimStatus =
  /**
   * Claimed by the actor with nobody to check it. This is all a local
   * device can produce — there is no verification authority offline.
   */
  | 'selfAsserted'
  /** Confirmed by an admin, or arrived through an invitation naming this person. */
  | 'verified'
  /** Explicitly refused; grants nothing and records that it was asked. */
  | 'rejected'

/**
 * An offer of membership.
 *
 * MODELLED ONLY. Nothing here is implemented as a working flow, because a
 * token nobody can verify is theatre: issuing, delivering, and redeeming
 * an invitation all require a server. What IS implemented is the pure part
 * — whether an invitation is still valid (`invitationState` in can.ts) and
 * who is permitted to send one.
 */
export interface Invitation {
  id: string
  familyTreeId: string
  /** Who it was sent to. Membership is never inferred from an email alone. */
  email?: string
  role: FamilyRole
  /**
   * The person record this invitee represents, if known — "invite the
   * person this node is about". Accepting creates a verified PersonClaim
   * alongside the membership, which is the natural flow for a family: you
   * are inviting your aunt, and her record already exists.
   *
   * NOT a scope restriction. It does not mean "may only edit this node";
   * it means "this node is them". Scope comes from `role`.
   */
  personId?: string
  invitedByActorId: string
  expiresAt: string
  status: InvitationStatus
  acceptedByActorId?: string
  createdAt: string
  updatedAt: string
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked'

/**
 * Everything the policy engine is allowed to look at.
 *
 * Passed in rather than fetched, exactly like the record snapshots the
 * relationship engine takes. That is what keeps `can` pure and testable
 * with no database, and what will let the same rules be re-expressed
 * server-side without dragging the client's data access along.
 */
export interface Governance {
  familyTreeId: string
  members: readonly FamilyTreeMember[]
  claims: readonly PersonClaim[]
}

/**
 * Per-tree governance settings.
 *
 * Deliberately does NOT record whether a tree is governed. That question
 * is answered by whether the tree has any members (see `isUngoverned` in
 * can.ts), and adding a second answer here would create exactly the kind
 * of competing source of truth this codebase avoids elsewhere — the same
 * reasoning that keeps a `role` field off FamilyGroupMember.
 *
 * This row holds only what cannot be derived: settings, and the provenance
 * of when governance was first established.
 */
export interface GovernanceConfig {
  /** Primary key: one row per tree. */
  familyTreeId: string
  /** The role a newly composed invitation offers by default. */
  defaultInviteRole: FamilyRole
  establishedAt: string
  /** Who set it up. Provenance for the audit trail, never authority. */
  establishedByActorId: string | null
  createdAt: string
  updatedAt: string
}
