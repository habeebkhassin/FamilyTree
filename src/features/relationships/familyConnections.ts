import type { FamilyGroup, FamilyGroupMember, Person, Union, UnionStatus } from '../../types'

/**
 * Marriages that join two families — derived, never stored.
 *
 * When somebody from one family marries somebody from another, that
 * marriage is the bridge between them. This module works out where those
 * bridges are, and it does so by READING the graph that already exists:
 *
 *     Person A ──Union── Person B
 *        │                  │
 *     Group A            Group B
 *
 * There is no FamilyConnection record, no second relationship system and
 * no schema change. A connection is a fact about a Union and two
 * memberships, all three of which the application already stores, so it
 * cannot drift out of step with them: change the marriage or the
 * memberships and the connection follows on the next render.
 *
 * Nothing here duplicates a person into another family, and nothing here
 * invents a parent link to make a picture work. Both would be lies about
 * somebody's family that would then sync to everybody else's device.
 */

export interface FamilyConnection {
  /** The marriage that is the bridge. The source of truth. */
  unionId: string
  status: UnionStatus
  startDate?: string
  /** The partner on the side you are looking from. */
  nearPersonId: string
  nearGroupId: string
  /** The partner in the other family. */
  farPersonId: string
  farGroupId: string
}

export interface FamilyConnectionInput {
  unions: readonly Union[]
  familyGroups: readonly FamilyGroup[]
  familyGroupMembers: readonly FamilyGroupMember[]
}

/** Group ids each person belongs to. A person may belong to several. */
function membershipsByPerson(
  members: readonly FamilyGroupMember[],
): Map<string, Set<string>> {
  const byPerson = new Map<string, Set<string>>()
  for (const member of members) {
    if (member.deletedAt) continue
    const groups = byPerson.get(member.personId) ?? new Set<string>()
    groups.add(member.familyGroupId)
    byPerson.set(member.personId, groups)
  }
  return byPerson
}

/**
 * Every cross-family marriage in this tree, once per direction.
 *
 *
 * WHAT COUNTS AS CROSSING
 * ───────────────────────
 * Two partners cross families when each belongs to at least one family
 * group and they SHARE NONE.
 *
 * The sharing test is the important half. Families marry within
 * themselves — cousins marry, a household holds both spouses — and in
 * those marriages both partners sit in the same group. Treating that as a
 * bridge would draw a family to itself and offer to "open" the family you
 * are already looking at, which is not a feature, it is a bug with a
 * label on it.
 *
 * A partner who belongs to no group at all is not crossing anything
 * either: an unfiled person is not a second family, and saying otherwise
 * would put a "connected family" card on half the tree the moment
 * somebody started organising it.
 */
export function findFamilyConnections(input: FamilyConnectionInput): FamilyConnection[] {
  const byPerson = membershipsByPerson(input.familyGroupMembers)
  const liveGroups = new Set(
    input.familyGroups.filter((group) => !group.deletedAt).map((group) => group.id),
  )

  const connections: FamilyConnection[] = []

  for (const union of input.unions) {
    if (union.deletedAt) continue

    const aGroups = [...(byPerson.get(union.partnerAId) ?? [])].filter((id) => liveGroups.has(id))
    const bGroups = [...(byPerson.get(union.partnerBId) ?? [])].filter((id) => liveGroups.has(id))
    if (aGroups.length === 0 || bGroups.length === 0) continue

    // Any group in common means one family, however many others they are
    // each filed under.
    const shared = aGroups.some((id) => bGroups.includes(id))
    if (shared) continue

    // Deterministic when somebody belongs to several groups: the first by
    // id, so the same records always produce the same connection rather
    // than one that changes with map iteration order.
    const nearGroupId = [...aGroups].sort()[0]
    const farGroupId = [...bGroups].sort()[0]
    if (!nearGroupId || !farGroupId) continue

    const base = {
      unionId: union.id,
      status: union.status,
      ...(union.startDate ? { startDate: union.startDate } : {}),
    }

    // Recorded from both sides, because each family should see the
    // bridge from where it stands — "connected to theirs" on one tree and
    // "connected to yours" on the other are the same marriage read from
    // opposite ends.
    connections.push({
      ...base,
      nearPersonId: union.partnerAId,
      nearGroupId,
      farPersonId: union.partnerBId,
      farGroupId,
    })
    connections.push({
      ...base,
      nearPersonId: union.partnerBId,
      nearGroupId: farGroupId,
      farPersonId: union.partnerAId,
      farGroupId: nearGroupId,
    })
  }

  return connections
}

/** The connections visible when looking at one particular family. */
export function connectionsFromGroup(
  connections: readonly FamilyConnection[],
  familyGroupId: string,
): FamilyConnection[] {
  return connections.filter((connection) => connection.nearGroupId === familyGroupId)
}

/** The connection a given union represents, looked at from one partner. */
export function connectionForUnion(
  connections: readonly FamilyConnection[],
  unionId: string,
  nearPersonId: string,
): FamilyConnection | undefined {
  return connections.find(
    (connection) => connection.unionId === unionId && connection.nearPersonId === nearPersonId,
  )
}

/** How many people a family group holds. Live memberships only. */
export function familyGroupSize(
  familyGroupMembers: readonly FamilyGroupMember[],
  familyGroupId: string,
): number {
  const people = new Set<string>()
  for (const member of familyGroupMembers) {
    if (member.deletedAt || member.familyGroupId !== familyGroupId) continue
    people.add(member.personId)
  }
  return people.size
}

/**
 * The people in one family group, for the tree that shows only them.
 *
 * Returns person ids, not people: this module knows about membership, and
 * turning ids into records is the caller's business.
 */
export function familyGroupMemberIds(
  familyGroupMembers: readonly FamilyGroupMember[],
  familyGroupId: string,
): Set<string> {
  const ids = new Set<string>()
  for (const member of familyGroupMembers) {
    if (member.deletedAt || member.familyGroupId !== familyGroupId) continue
    ids.add(member.personId)
  }
  return ids
}

/** Display name for a group, falling back to something honest. */
export function familyGroupName(
  familyGroups: readonly FamilyGroup[],
  familyGroupId: string,
): string {
  return familyGroups.find((group) => group.id === familyGroupId)?.name ?? 'another family'
}

/** The couple behind a connection, in the order the sheet shows them. */
export function connectionCouple(
  people: readonly Person[],
  connection: FamilyConnection,
): { near: Person | undefined; far: Person | undefined } {
  return {
    near: people.find((person) => person.id === connection.nearPersonId),
    far: people.find((person) => person.id === connection.farPersonId),
  }
}

/**
 * Which family the person looking is standing in.
 *
 * A connection is symmetric — the marriage joins two families and neither
 * is objectively the main one — but a chip that says "Connected to
 * another family" has to name a side, and naming the wrong one would tell
 * somebody their own family is the foreign one.
 *
 * So the tree is anchored on the person whose tree it is: whoever this
 * device has claimed, or failing that whoever is currently focused. With
 * neither, the largest family is the best available guess at "home", and
 * ties break by id so the answer never changes between renders.
 */
export function pickHomeFamilyGroup(
  familyGroupMembers: readonly FamilyGroupMember[],
  options: { claimedPersonId?: string | null; focalPersonId?: string | null },
): string | null {
  const live = familyGroupMembers.filter((member) => !member.deletedAt)

  for (const personId of [options.claimedPersonId, options.focalPersonId]) {
    if (!personId) continue
    const groups = live
      .filter((member) => member.personId === personId)
      .map((member) => member.familyGroupId)
      .sort()
    const first = groups[0]
    if (first) return first
  }

  const sizes = new Map<string, number>()
  for (const member of live) {
    sizes.set(member.familyGroupId, (sizes.get(member.familyGroupId) ?? 0) + 1)
  }
  const ranked = [...sizes.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  )
  return ranked[0]?.[0] ?? null
}
