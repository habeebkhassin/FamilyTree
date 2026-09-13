import type {
  FamilyGroup,
  FamilyGroupMember,
  FamilyOriginPrecision,
  FamilyTree,
  Gender,
  ParentLink,
  ParentRelationship,
  Person,
  Union,
  UnionStatus,
} from '../../types'

/**
 * Between the database's column names and the application's field names.
 *
 * Postgres is snake_case and the domain model is camelCase, so one of the
 * two has to bend. This is the only place it happens: a small, explicit,
 * total mapping, rather than quoted camelCase columns that would make
 * every hand-written query awkward, or a clever automatic converter that
 * would silently mis-handle the one field that does not follow the rule.
 *
 * Both directions are written out. Reading a column that does not exist
 * and writing one that does not either are both mistakes this file is
 * where you would catch.
 *
 *
 * TOMBSTONES AND ABSENT FIELDS
 * ────────────────────────────
 * An optional field is absent in the domain and null in the column, and
 * the two must not be confused: `deletedAt: undefined` means live, and
 * writing `deletedAt: null` into a record would make `'deletedAt' in
 * record` true, which is not the same thing. So reading omits a key
 * rather than setting it to null.
 */

/** Drops keys whose value is null or undefined, so optional stays optional. */
function present<T extends object>(record: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value
  }
  return out as T
}

/** Postgres returns its own timestamp spelling; the domain uses ISO. */
function iso(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function isoOr(value: string | null | undefined, fallback: string): string {
  return iso(value) ?? fallback
}

const EPOCH = '1970-01-01T00:00:00.000Z'

// ── family tree ─────────────────────────────────────────────────────

export interface FamilyTreeRow {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function toFamilyTree(row: FamilyTreeRow): FamilyTree {
  return present({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: isoOr(row.created_at, EPOCH),
    updatedAt: isoOr(row.updated_at, EPOCH),
    deletedAt: iso(row.deleted_at),
  })
}

// ── person ──────────────────────────────────────────────────────────

export interface PersonRow {
  id: string
  tree_id: string
  first_name: string
  last_name: string
  gender: string
  birth_date: string | null
  death_date: string | null
  is_placeholder: boolean | null
  notes: string | null
  profile_photo_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function toPerson(row: PersonRow): Person {
  return present({
    id: row.id,
    familyTreeId: row.tree_id,
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender as Gender,
    birthDate: row.birth_date ?? undefined,
    deathDate: row.death_date ?? undefined,
    isPlaceholder: row.is_placeholder ?? undefined,
    notes: row.notes ?? undefined,
    profilePhotoId: row.profile_photo_id ?? undefined,
    createdAt: isoOr(row.created_at, EPOCH),
    updatedAt: isoOr(row.updated_at, EPOCH),
    deletedAt: iso(row.deleted_at),
  })
}

// ── parent link ─────────────────────────────────────────────────────

export interface ParentLinkRow {
  id: string
  tree_id: string
  parent_id: string
  child_id: string
  relationship: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function toParentLink(row: ParentLinkRow): ParentLink {
  return present({
    id: row.id,
    familyTreeId: row.tree_id,
    parentId: row.parent_id,
    childId: row.child_id,
    relationship: row.relationship as ParentRelationship,
    createdAt: isoOr(row.created_at, EPOCH),
    updatedAt: isoOr(row.updated_at, EPOCH),
    deletedAt: iso(row.deleted_at),
  })
}

// ── union ───────────────────────────────────────────────────────────

export interface UnionRow {
  id: string
  tree_id: string
  partner_a_id: string
  partner_b_id: string
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function toUnion(row: UnionRow): Union {
  return present({
    id: row.id,
    familyTreeId: row.tree_id,
    partnerAId: row.partner_a_id,
    partnerBId: row.partner_b_id,
    status: row.status as UnionStatus,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    createdAt: isoOr(row.created_at, EPOCH),
    updatedAt: isoOr(row.updated_at, EPOCH),
    deletedAt: iso(row.deleted_at),
  })
}

// ── family group ────────────────────────────────────────────────────

export interface FamilyGroupRow {
  id: string
  tree_id: string
  name: string
  origin_person_id: string | null
  established_precision: string
  established_date: string | null
  established_label: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function toFamilyGroup(row: FamilyGroupRow): FamilyGroup {
  return present({
    id: row.id,
    familyTreeId: row.tree_id,
    name: row.name,
    originPersonId: row.origin_person_id ?? undefined,
    establishedPrecision: row.established_precision as FamilyOriginPrecision,
    establishedDate: row.established_date ?? undefined,
    establishedLabel: row.established_label ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: isoOr(row.created_at, EPOCH),
    updatedAt: isoOr(row.updated_at, EPOCH),
    deletedAt: iso(row.deleted_at),
  })
}

// ── family group member ─────────────────────────────────────────────

export interface FamilyGroupMemberRow {
  id: string
  tree_id: string
  family_group_id: string
  person_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function toFamilyGroupMember(row: FamilyGroupMemberRow): FamilyGroupMember {
  return present({
    id: row.id,
    familyTreeId: row.tree_id,
    familyGroupId: row.family_group_id,
    personId: row.person_id,
    createdAt: isoOr(row.created_at, EPOCH),
    updatedAt: isoOr(row.updated_at, EPOCH),
    deletedAt: iso(row.deleted_at),
  })
}
