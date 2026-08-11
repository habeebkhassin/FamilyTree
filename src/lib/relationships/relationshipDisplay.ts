import type { Person } from '../../types'
import type { RelationshipKind, RelationshipPeriod } from './relationshipTypes'

/**
 * Turns the resolver's neutral kinds into English. Kept separate from the
 * resolver on purpose: the resolver states what the graph supports, and
 * this decides how to say it — which is where gender, and one day
 * translation, belong.
 *
 * A gendered word is only ever used when the person's gender is actually
 * recorded. "unknown" or "other" always falls back to the neutral term,
 * because guessing "Aunt" from a name or a graph position would be
 * inventing a fact the family never entered.
 */
const NEUTRAL_LABEL: Record<RelationshipKind, string> = {
  parent: 'Parent',
  child: 'Child',
  adoptiveParent: 'Adoptive parent',
  adoptedChild: 'Adopted child',
  fosterParent: 'Foster parent',
  fosterChild: 'Foster child',
  stepParent: 'Step-parent',
  stepChild: 'Step-child',
  sibling: 'Sibling',
  halfSibling: 'Half-sibling',
  stepSibling: 'Step-sibling',
  grandparent: 'Grandparent',
  grandchild: 'Grandchild',
  greatGrandparent: 'Great-grandparent',
  greatGrandchild: 'Great-grandchild',
  auntUncle: 'Aunt / Uncle',
  niblingByBlood: 'Niece / Nephew',
  auntUncleByMarriage: 'Aunt / Uncle by marriage',
  niblingByMarriage: 'Niece / Nephew by marriage',
  cousin: 'Cousin',
  spouse: 'Spouse',
  partner: 'Partner',
}

const GENDERED_LABEL: Partial<Record<RelationshipKind, { female: string; male: string }>> = {
  parent: { female: 'Mother', male: 'Father' },
  child: { female: 'Daughter', male: 'Son' },
  adoptiveParent: { female: 'Adoptive mother', male: 'Adoptive father' },
  adoptedChild: { female: 'Adopted daughter', male: 'Adopted son' },
  fosterParent: { female: 'Foster mother', male: 'Foster father' },
  fosterChild: { female: 'Foster daughter', male: 'Foster son' },
  stepParent: { female: 'Stepmother', male: 'Stepfather' },
  stepChild: { female: 'Stepdaughter', male: 'Stepson' },
  sibling: { female: 'Sister', male: 'Brother' },
  halfSibling: { female: 'Half-sister', male: 'Half-brother' },
  stepSibling: { female: 'Stepsister', male: 'Stepbrother' },
  grandparent: { female: 'Grandmother', male: 'Grandfather' },
  grandchild: { female: 'Granddaughter', male: 'Grandson' },
  greatGrandparent: { female: 'Great-grandmother', male: 'Great-grandfather' },
  greatGrandchild: { female: 'Great-granddaughter', male: 'Great-grandson' },
  auntUncle: { female: 'Aunt', male: 'Uncle' },
  niblingByBlood: { female: 'Niece', male: 'Nephew' },
  auntUncleByMarriage: { female: 'Aunt by marriage', male: 'Uncle by marriage' },
  niblingByMarriage: { female: 'Niece by marriage', male: 'Nephew by marriage' },
  spouse: { female: 'Wife', male: 'Husband' },
}

/**
 * `subject` is the person the label describes — for "Ava is Habeeb's
 * aunt", that is Ava.
 */
export function formatRelationshipLabel(kind: RelationshipKind, subject: Person | undefined): string {
  const gendered = GENDERED_LABEL[kind]
  if (gendered && subject) {
    if (subject.gender === 'female') return gendered.female
    if (subject.gender === 'male') return gendered.male
  }
  return NEUTRAL_LABEL[kind]
}

/** Year only — a relationship's precision is the year it changed, not the day. */
function formatYear(date: string): string {
  const year = new Date(date).getFullYear()
  return Number.isNaN(year) ? date : String(year)
}

/**
 * How long the relationship has held, worked out from recorded birth,
 * death and union dates. Never fabricates a year.
 *
 * Each combination of known/unknown ends gets its own consistent wording,
 * rather than pushing a placeholder through the same range template — a
 * relationship with nothing datable reads "Dates unknown", not the
 * half-sentence "Unknown start – Present".
 */
export function formatRelationshipPeriod(period: RelationshipPeriod): string {
  if (period.start && period.end) return `${formatYear(period.start)} – ${formatYear(period.end)}`
  if (period.start) return `${formatYear(period.start)} – Present`
  if (period.end) return `Until ${formatYear(period.end)}`
  return 'Dates unknown'
}

/** "Habeeb is Ava's nephew" — the reciprocal, spelled out for the panel. */
export function formatReciprocalSentence(
  reciprocalKind: RelationshipKind,
  personB: Person | undefined,
  personA: Person | undefined,
): string {
  const label = formatRelationshipLabel(reciprocalKind, personB).toLowerCase()
  const bName = personB?.firstName ?? 'They'
  const aName = personA?.firstName ?? 'them'
  return `${bName} is ${aName}'s ${label}`
}
