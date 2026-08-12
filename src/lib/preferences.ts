const ACTIVE_FAMILY_TREE_KEY = 'familytree.activeFamilyTreeId'

export function getStoredActiveFamilyTreeId(): string | null {
  return localStorage.getItem(ACTIVE_FAMILY_TREE_KEY)
}

export function setStoredActiveFamilyTreeId(id: string): void {
  localStorage.setItem(ACTIVE_FAMILY_TREE_KEY, id)
}

/**
 * Who each tree is being explored from — Phase 5C-1.
 *
 * VIEW STATE, kept per tree and per device. It is deliberately not a
 * column on FamilyTree and not a Dexie table: a viewpoint is not a
 * genealogical fact, and storing it with the genealogy would imply the
 * family has one, which it does not. Two people opening the same tree
 * should each see it from their own position.
 *
 * Guarded because a viewpoint is never worth breaking the tree over: if
 * storage is unavailable, focus simply does not persist across reloads.
 */
function focalPersonKey(familyTreeId: string): string {
  return `familytree.focalPerson.${familyTreeId}`
}

export function getStoredFocalPersonId(familyTreeId: string): string | null {
  try {
    return localStorage.getItem(focalPersonKey(familyTreeId))
  } catch {
    return null
  }
}

export function setStoredFocalPersonId(familyTreeId: string, personId: string): void {
  try {
    localStorage.setItem(focalPersonKey(familyTreeId), personId)
  } catch {
    // Best effort.
  }
}

export function clearStoredFocalPersonId(familyTreeId: string): void {
  try {
    localStorage.removeItem(focalPersonKey(familyTreeId))
  } catch {
    // Best effort.
  }
}
