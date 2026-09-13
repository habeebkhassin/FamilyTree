import type {
  FamilyGroup,
  FamilyGroupMember,
  FamilyTree,
  ParentLink,
  Person,
  Union,
} from '../../types'

/**
 * Family trees kept in an account — Milestone 2.
 *
 * The seam, declared the same way as AuthClient and RemoteAdapter: an
 * interface that names no vendor, so everything above it is testable with
 * no network and so the shape is decided by what this application needs.
 *
 *
 * WHAT THIS IS NOT
 * ────────────────
 * Not synchronisation. There is no sequence, no change log, no cursor and
 * no merge. Adoption is a one-way seeding of a tree somebody explicitly
 * chose to save, and fetching is a one-way read of what was saved. Two-way
 * sync is a later milestone and will arrive through RemoteAdapter, not by
 * growing this into it.
 */

/** A tree as the account sees it, without downloading the family. */
export interface CloudTreeSummary {
  id: string
  name: string
  description?: string
  /** This account's role in it. Reported by the server, never assumed. */
  role: string
  updatedAt: string
}

/** Everything that belongs to one tree, ready to be written locally. */
export interface CloudTreeContents {
  familyTree: FamilyTree
  people: Person[]
  parentLinks: ParentLink[]
  unions: Union[]
  familyGroups: FamilyGroup[]
  familyGroupMembers: FamilyGroupMember[]
}

/** What adoption uploads. Exactly the canonical records, and nothing else —
    no change events, no governance, no device state, no media bytes. */
export type AdoptableTree = CloudTreeContents

export interface CloudTreeStore {
  /**
   * Make sure this account has a profile. Safe to call repeatedly.
   *
   * No email: the address is identity, and identity comes from the
   * provider. The server reads it from auth.users, so a client cannot
   * assert one — which matters now that an email decides who an
   * invitation belongs to.
   */
  ensureProfile(displayName: string | null): Promise<void>
  /** Trees this account can reach. Empty is a normal answer. */
  listTrees(): Promise<CloudTreeSummary[]>
  /** Save a local tree to the account. Returns the id it kept. */
  adopt(tree: AdoptableTree): Promise<string>
  /** Read one tree back. Used to materialise it on another device. */
  fetchTree(familyTreeId: string): Promise<CloudTreeContents>
}

/**
 * The store for having no cloud.
 *
 * A sibling of NullRemoteAdapter and NoAuthClient, and used for the same
 * reason: it is what the application genuinely runs on when there is
 * nothing configured. It reports no trees and refuses to pretend it saved
 * one.
 */
export class NoCloudTreeStore implements CloudTreeStore {
  async ensureProfile(_displayName: string | null): Promise<void> {
    // Nothing to ensure. Not an error: a caller tidying up on startup
    // should not have to special-case having no cloud.
  }

  async listTrees(): Promise<CloudTreeSummary[]> {
    return []
  }

  async adopt(): Promise<string> {
    throw new Error('This copy of FamilyTree has no cloud configured, so there is nowhere to save to.')
  }

  async fetchTree(): Promise<CloudTreeContents> {
    throw new Error('This copy of FamilyTree has no cloud configured.')
  }
}
