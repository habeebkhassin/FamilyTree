import { exportFamilyTree } from '../backup'
import type { AdoptableTree, CloudTreeStore } from './cloudTrees'

/**
 * Saving a local family tree to an account — Milestone 2.
 *
 * EXPLICIT, ALWAYS. Nothing here runs because somebody signed in. It runs
 * because they pressed a button naming one tree, which is the whole
 * difference between an application that keeps your family where you put
 * it and one that helps itself.
 *
 *
 * WHAT IS SENT, AND WHAT IS NOT
 * ─────────────────────────────
 * The payload is built from `exportFamilyTree`, the projection the backup
 * format already produces — one place gathers a complete tree, and this
 * reuses it rather than walking Dexie a second time and drifting from it.
 *
 * Four things in that projection are deliberately dropped:
 *
 *   changeEvents   history belongs to synchronisation, which does not
 *                  exist yet; uploading it now would mean inventing the
 *                  server sequence that makes it meaningful
 *   outbox         this device's to-do list
 *   syncState      this device's cursor
 *   governance     roles, claims and invitations are the server's to
 *                  decide, never a client's to assert — the local rows
 *                  are a cache of decisions, and uploading them would
 *                  invert that
 *
 * Media metadata is dropped too: the bytes live nowhere in the cloud yet,
 * so a row pointing at them would point at nothing.
 *
 *
 * THE LOCAL TREE IS NOT TOUCHED
 * ─────────────────────────────
 * This function reads. It does not write to Dexie, does not mark the tree
 * as adopted, and does not delete anything — so a cloud failure, whatever
 * its cause, leaves the family exactly as it was. Whether a tree is in
 * the cloud is answered by asking the cloud, not by a local flag that
 * could be wrong.
 */
export async function adoptLocalTree(
  familyTreeId: string,
  store: CloudTreeStore,
): Promise<string> {
  const backup = await exportFamilyTree(familyTreeId)

  const payload: AdoptableTree = {
    familyTree: backup.data.familyTree,
    people: backup.data.people,
    parentLinks: backup.data.parentLinks,
    unions: backup.data.unions,
    familyGroups: backup.data.familyGroups,
    familyGroupMembers: backup.data.familyGroupMembers,
  }

  return store.adopt(payload)
}
