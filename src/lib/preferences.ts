const ACTIVE_FAMILY_TREE_KEY = 'familytree.activeFamilyTreeId'

export function getStoredActiveFamilyTreeId(): string | null {
  return localStorage.getItem(ACTIVE_FAMILY_TREE_KEY)
}

export function setStoredActiveFamilyTreeId(id: string): void {
  localStorage.setItem(ACTIVE_FAMILY_TREE_KEY, id)
}
