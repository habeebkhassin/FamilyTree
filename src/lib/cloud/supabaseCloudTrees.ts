import type { AdoptableTree, CloudTreeContents, CloudTreeStore, CloudTreeSummary } from './cloudTrees'
import {
  toFamilyGroup,
  toFamilyGroupMember,
  toFamilyTree,
  toParentLink,
  toPerson,
  toUnion,
} from './cloudRows'
import type {
  FamilyGroupMemberRow,
  FamilyGroupRow,
  FamilyTreeRow,
  ParentLinkRow,
  PersonRow,
  UnionRow,
} from './cloudRows'
import { getSupabaseClient } from './supabaseClient'
import type { SupabaseLike } from './supabaseClient'

/**
 * Cloud trees, through Supabase — Milestone 2.
 *
 * Every read here goes through row-level security, so this file contains
 * no authorisation logic at all and must not grow any. "Which trees may I
 * see" is answered by `select * from family_trees` returning only the ones
 * the account is a member of; a filter written here would be decoration
 * over the real rule and would rot the moment the policy changed.
 *
 * Likewise the account id: it is never sent. The database reads
 * auth.uid() from the request's own token, which a client cannot forge.
 */

/** Supabase reports failures in the payload rather than by throwing. */
function unwrap<T>(result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data as T
}

async function rows<T>(client: SupabaseLike, table: string, treeId: string, what: string): Promise<T[]> {
  const result = await client.from(table).select('*').eq('tree_id', treeId)
  return unwrap<T[]>(result, what) ?? []
}

export class SupabaseCloudTreeStore implements CloudTreeStore {
  async ensureProfile(email: string | null, displayName: string | null): Promise<void> {
    const client = await getSupabaseClient()
    unwrap(
      await client.rpc('ensure_profile', { p_email: email, p_display_name: displayName }),
      'Could not set up your account',
    )
  }

  async listTrees(): Promise<CloudTreeSummary[]> {
    const client = await getSupabaseClient()

    // Row-level security decides what comes back. Both queries are
    // filtered to this account's trees without either one saying so.
    const trees = unwrap<FamilyTreeRow[]>(
      await client.from('family_trees').select('*').order('updated_at', { ascending: false }),
      'Could not list your family trees',
    )
    const memberships = unwrap<{ tree_id: string; role: string }[]>(
      await client.from('tree_members').select('tree_id, role'),
      'Could not read your access',
    )

    const roleByTree = new Map(memberships.map((row) => [row.tree_id, row.role]))
    return (trees ?? [])
      .filter((row) => !row.deleted_at)
      .map((row) => {
        const tree = toFamilyTree(row)
        return {
          id: tree.id,
          name: tree.name,
          ...(tree.description !== undefined && { description: tree.description }),
          // Absent only if the two queries raced a membership change.
          role: roleByTree.get(row.id) ?? 'viewer',
          updatedAt: tree.updatedAt,
        }
      })
  }

  /**
   * One call, one transaction.
   *
   * The whole tree goes to `adopt_family_tree` as a single payload so the
   * database can create the tree, the owner membership and every record
   * together or not at all. Uploading table by table from here would
   * leave a half-saved family behind whenever a connection dropped, and a
   * half-saved family is worse than none.
   */
  async adopt(tree: AdoptableTree): Promise<string> {
    const client = await getSupabaseClient()
    const returned = unwrap<string>(
      await client.rpc('adopt_family_tree', { payload: tree }),
      'Could not save this family tree to your account',
    )
    // The database returns the id it kept, which is the local one.
    return returned ?? tree.familyTree.id
  }

  async fetchTree(familyTreeId: string): Promise<CloudTreeContents> {
    const client = await getSupabaseClient()

    const trees = unwrap<FamilyTreeRow[]>(
      await client.from('family_trees').select('*').eq('id', familyTreeId),
      'Could not open that family tree',
    )
    const row = trees?.[0]
    if (!row) {
      // Indistinguishable from "does not exist", and deliberately so: a
      // policy that hid a tree should not then confirm it is there.
      throw new Error('That family tree is not available to your account.')
    }

    const [people, parentLinks, unions, familyGroups, familyGroupMembers] = await Promise.all([
      rows<PersonRow>(client, 'people', familyTreeId, 'Could not read the people'),
      rows<ParentLinkRow>(client, 'parent_links', familyTreeId, 'Could not read the relationships'),
      rows<UnionRow>(client, 'unions', familyTreeId, 'Could not read the partnerships'),
      rows<FamilyGroupRow>(client, 'family_groups', familyTreeId, 'Could not read the branches'),
      rows<FamilyGroupMemberRow>(client, 'family_group_members', familyTreeId, 'Could not read the branch members'),
    ])

    return {
      familyTree: toFamilyTree(row),
      people: people.map(toPerson),
      parentLinks: parentLinks.map(toParentLink),
      unions: unions.map(toUnion),
      familyGroups: familyGroups.map(toFamilyGroup),
      familyGroupMembers: familyGroupMembers.map(toFamilyGroupMember),
    }
  }
}
