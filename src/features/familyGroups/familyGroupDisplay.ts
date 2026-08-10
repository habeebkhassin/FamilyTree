import type { FamilyGroup } from '../../types'

/**
 * Formats a FamilyGroup's origin/establishment info per its precision —
 * mirrors personDisplay.ts's plain-value formatters (no "Established "
 * prefix baked in; callers add that in JSX, same as formatFullDate).
 * Returns null when there's nothing meaningful to show (precision is
 * 'unknown', or 'approximate' with neither a label nor a date).
 */
export function formatFamilyGroupOrigin(
  group: Pick<FamilyGroup, 'establishedPrecision' | 'establishedDate' | 'establishedLabel'>,
): string | null {
  const { establishedPrecision, establishedDate, establishedLabel } = group

  if (establishedPrecision === 'unknown') return null

  if (establishedPrecision === 'approximate') {
    if (establishedLabel) return establishedLabel
    if (establishedDate) return `~${new Date(establishedDate).getFullYear()}`
    return null
  }

  if (!establishedDate) return null
  const date = new Date(establishedDate)

  if (establishedPrecision === 'year') return String(date.getFullYear())
  if (establishedPrecision === 'month') {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export function formatMemberCount(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`
}
