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
