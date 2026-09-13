import type { ParentRelationship, Person, UnionStatus } from '../../types'

export function formatName(person: Pick<Person, 'firstName' | 'lastName'>): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ').trim()
}

export function formatYearRange(person: Pick<Person, 'birthDate' | 'deathDate'>): string | null {
  const birthYear = person.birthDate ? new Date(person.birthDate).getFullYear() : null
  const deathYear = person.deathDate ? new Date(person.deathDate).getFullYear() : null

  if (birthYear && deathYear) return `${birthYear}–${deathYear}`
  if (birthYear) return `Born ${birthYear}`
  if (deathYear) return `Died ${deathYear}`
  return null
}

/**
 * Whole years between a date and a later one, or null if the two make no
 * sense together. Calendar-aware: a birthday that has not come round yet
 * this year has not happened.
 */
function yearsBetween(fromIso: string, to: Date): number | null {
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null

  let years = to.getFullYear() - from.getFullYear()
  const monthDelta = to.getMonth() - from.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && to.getDate() < from.getDate())) years -= 1
  return years < 0 || years > 150 ? null : years
}

/**
 * The one quiet line under a name on a tree card.
 *
 * The reference reads "56 · Dev - Infosys" — an age beside an occupation.
 * A Person here has a birth date and a death date and no occupation
 * field, and the brief says to show what the data supports and omit the
 * rest. So this shows the age, and will pick an occupation up unchanged
 * on the day one exists.
 *
 * Someone who has died is not given a current age: their lifespan is the
 * meaningful fact, and a number counting up from a date they are no
 * longer living through would simply be wrong.
 *
 * Returns the short text to draw and the full phrase to say. "56" under a
 * name is unambiguous to somebody looking at a family tree and completely
 * ambiguous to a screen reader arriving at a bare number.
 */
export function formatNodeMeta(
  person: Pick<Person, 'birthDate' | 'deathDate'>,
  now: Date = new Date(),
): { text: string; spoken: string } | null {
  if (person.deathDate) {
    const range = formatYearRange(person)
    if (!range) return null
    const ageAtDeath = person.birthDate
      ? yearsBetween(person.birthDate, new Date(person.deathDate))
      : null
    return {
      text: range,
      spoken: ageAtDeath === null ? range : `${range}, died aged ${ageAtDeath}`,
    }
  }

  if (person.birthDate) {
    const age = yearsBetween(person.birthDate, now)
    if (age === null) return null
    return { text: String(age), spoken: `${age} years old` }
  }

  return null
}

/**
 * Whether a person answers to a search box.
 *
 * Shared by the People directory and the tree's search, so there is one
 * definition of "matches" rather than two that can drift apart.
 */
export function matchesQuery(
  person: Pick<Person, 'firstName' | 'lastName'>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return formatName(person).toLowerCase().includes(needle)
}

export function formatFullDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  const initials = (first + last).toUpperCase()
  return initials || '?'
}

const PARENT_LINK_BADGE: Record<Exclude<ParentRelationship, 'biological'>, string> = {
  adopted: 'Adopted',
  step: 'Step',
  foster: 'Foster',
}

/** Biological is the unmarked default — only non-biological links get a badge. */
export function formatParentLinkBadge(relationship: ParentRelationship): string | undefined {
  if (relationship === 'biological') return undefined
  return PARENT_LINK_BADGE[relationship]
}

const UNION_STATUS_LABEL: Record<UnionStatus, string> = {
  married: 'Married',
  partnered: 'Partnered',
  engaged: 'Engaged',
  divorced: 'Divorced',
  separated: 'Separated',
  widowed: 'Widowed',
}

export function formatUnionStatusLabel(status: UnionStatus): string {
  return UNION_STATUS_LABEL[status]
}
