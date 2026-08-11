import type { ParentLink, Person, Union } from '../../types'
import type {
  RelationshipGraph,
  RelationshipKind,
  RelationshipPeriod,
  ResolvedRelationship,
} from './relationshipTypes'

/**
 * Derives every genealogical relationship between two people from the
 * stored facts — People, ParentLinks, Unions and their dates — and
 * nothing else.
 *
 * The database records FACTS. This module performs the INTERPRETATION,
 * and is deliberately the only place that does: "aunt", "stepmother" and
 * "second cousin" are readings of the graph, not data, so they are never
 * written back. Nothing here mutates, reads storage, or depends on React
 * — which is what lets it run unchanged against cloud-loaded family data
 * later.
 *
 * Two consequences worth stating plainly:
 *
 *  - A pair can hold SEVERAL relationships at once, and all of them are
 *    returned. Someone can be both an aunt (since the child was born) and
 *    a stepmother (since marrying the child's parent). Neither cancels
 *    the other, and the resolver refuses to pick a winner — choosing a
 *    "current" one is a family's decision, made in the UI.
 *  - A period is only reported when the facts support it. A step-parent's
 *    start comes from the Union that created the relationship; a blood
 *    aunt's, from the later of the two birth dates. Where neither exists
 *    the period is null rather than a guess.
 *
 * IMPORTANT: this must be fed the underlying genealogy graph, never the
 * collapsed family-group projection used for drawing. Collapsing a group
 * is a visualization state and must not change what two people are to
 * each other.
 */
export function resolveRelationships(
  personAId: string,
  personBId: string,
  graph: RelationshipGraph,
): ResolvedRelationship[] {
  if (personAId === personBId) return []

  const index = buildIndex(graph)
  const personA = index.peopleById.get(personAId)
  const personB = index.peopleById.get(personBId)
  if (!personA || !personB) return []

  const found: ResolvedRelationship[] = []
  const push = (relationship: ResolvedRelationship | null) => {
    if (relationship) found.push(relationship)
  }

  // --- Direct parent/child, in both directions ------------------------
  for (const link of index.parentLinksByChild.get(personBId) ?? []) {
    if (link.parentId !== personAId) continue
    push(directParentRelationship(link, personA, personB, index, 'aToB'))
  }
  for (const link of index.parentLinksByChild.get(personAId) ?? []) {
    if (link.parentId !== personBId) continue
    push(directParentRelationship(link, personB, personA, index, 'bToA'))
  }

  // --- Partners --------------------------------------------------------
  for (const union of index.unionsByPerson.get(personAId) ?? []) {
    if (otherPartner(union, personAId) !== personBId) continue
    const kind: RelationshipKind = union.status === 'married' ? 'spouse' : 'partner'
    push({
      id: `union:${union.id}`,
      kind,
      reciprocalKind: kind,
      period: clampToLifetimes({ start: union.startDate ?? null, end: union.endDate ?? null }, personA, personB),
      path: [personAId, personBId],
      via: 'union',
    })
  }

  // --- Siblings --------------------------------------------------------
  push(siblingRelationship(personA, personB, index))

  // --- Grandparents / great-grandparents, both directions -------------
  push(ancestorRelationship(personA, personB, index, 2))
  push(ancestorRelationship(personB, personA, index, 2, true))
  push(ancestorRelationship(personA, personB, index, 3))
  push(ancestorRelationship(personB, personA, index, 3, true))

  // --- Aunt/uncle and their reciprocals -------------------------------
  for (const relationship of auntUncleRelationships(personA, personB, index, false)) push(relationship)
  for (const relationship of auntUncleRelationships(personB, personA, index, true)) push(relationship)

  // --- Cousins ---------------------------------------------------------
  push(cousinRelationship(personA, personB, index))

  // --- Step-parent / step-child, both directions ----------------------
  for (const relationship of stepParentRelationships(personA, personB, index, false)) push(relationship)
  for (const relationship of stepParentRelationships(personB, personA, index, true)) push(relationship)

  // --- Step-siblings ---------------------------------------------------
  push(stepSiblingRelationship(personA, personB, index))

  return dedupe(found)
}

// ---------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------

interface GraphIndex {
  peopleById: Map<string, Person>
  parentLinksByChild: Map<string, ParentLink[]>
  parentLinksByParent: Map<string, ParentLink[]>
  unionsByPerson: Map<string, Union[]>
}

function buildIndex(graph: RelationshipGraph): GraphIndex {
  const peopleById = new Map(graph.people.map((person) => [person.id, person]))
  const parentLinksByChild = new Map<string, ParentLink[]>()
  const parentLinksByParent = new Map<string, ParentLink[]>()
  for (const link of graph.parentLinks) {
    // Ignore links pointing at people who aren't in this snapshot, so a
    // partial graph degrades to fewer relationships rather than crashing.
    if (!peopleById.has(link.parentId) || !peopleById.has(link.childId)) continue
    pushInto(parentLinksByChild, link.childId, link)
    pushInto(parentLinksByParent, link.parentId, link)
  }

  const unionsByPerson = new Map<string, Union[]>()
  for (const union of graph.unions) {
    if (!peopleById.has(union.partnerAId) || !peopleById.has(union.partnerBId)) continue
    pushInto(unionsByPerson, union.partnerAId, union)
    pushInto(unionsByPerson, union.partnerBId, union)
  }

  return { peopleById, parentLinksByChild, parentLinksByParent, unionsByPerson }
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

function otherPartner(union: Union, personId: string): string {
  return union.partnerAId === personId ? union.partnerBId : union.partnerAId
}

function parentIdsOf(personId: string, index: GraphIndex): string[] {
  return (index.parentLinksByChild.get(personId) ?? []).map((link) => link.parentId)
}

/** Ancestors exactly `depth` generations up, each with the path taken to reach them. */
function ancestorsAtDepth(personId: string, depth: number, index: GraphIndex): { id: string; path: string[] }[] {
  let frontier: { id: string; path: string[] }[] = [{ id: personId, path: [personId] }]
  for (let step = 0; step < depth; step += 1) {
    const next: { id: string; path: string[] }[] = []
    for (const entry of frontier) {
      for (const parentId of parentIdsOf(entry.id, index)) {
        // A cycle is impossible in stored data (storage rejects them), but
        // guarding keeps a hand-built graph from looping forever.
        if (entry.path.includes(parentId)) continue
        next.push({ id: parentId, path: [...entry.path, parentId] })
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return frontier
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a || !b) return null
  return a > b ? a : b
}

function earliestOf(...dates: (string | null | undefined)[]): string | null {
  const known = dates.filter((date): date is string => Boolean(date))
  if (known.length === 0) return null
  return known.reduce((earliest, date) => (date < earliest ? date : earliest))
}

/**
 * A relationship cannot outlive either person, so a recorded death closes
 * it even when the relationship itself has no end date of its own.
 */
function clampToLifetimes(period: RelationshipPeriod, ...people: Person[]): RelationshipPeriod {
  const deaths = people.map((person) => person.deathDate)
  return { start: period.start, end: earliestOf(period.end, ...deaths) }
}

/**
 * The default period for a relationship that exists purely because both
 * people exist — siblings, grandparents, aunts, cousins. It begins when
 * the younger of the two is born, and ends when the first of them dies.
 */
function coexistencePeriod(personA: Person, personB: Person): RelationshipPeriod {
  return clampToLifetimes({ start: laterOf(personA.birthDate, personB.birthDate), end: null }, personA, personB)
}

// ---------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------

const PARENT_KIND_BY_SUBTYPE: Record<ParentLink['relationship'], RelationshipKind> = {
  biological: 'parent',
  adopted: 'adoptiveParent',
  step: 'stepParent',
  foster: 'fosterParent',
}

const CHILD_KIND_BY_SUBTYPE: Record<ParentLink['relationship'], RelationshipKind> = {
  biological: 'child',
  adopted: 'adoptedChild',
  step: 'stepChild',
  foster: 'fosterChild',
}

/**
 * `parent` is the recorded parent and `child` the recorded child; the
 * direction flag says which of them is person A, since the result is
 * always expressed as "A is <kind> of B".
 */
function directParentRelationship(
  link: ParentLink,
  parent: Person,
  child: Person,
  index: GraphIndex,
  direction: 'aToB' | 'bToA',
): ResolvedRelationship {
  const parentKind = PARENT_KIND_BY_SUBTYPE[link.relationship]
  const childKind = CHILD_KIND_BY_SUBTYPE[link.relationship]

  // A biological parent's relationship starts at the child's birth. A step
  // relationship starts when the union that created it began — the link
  // itself carries no date — so fall back to that when one exists.
  const period =
    link.relationship === 'step'
      ? (stepPeriodFromUnions(parent.id, child.id, index) ?? { start: null, end: null })
      : { start: child.birthDate ?? null, end: null }

  return {
    id: `parentLink:${link.id}`,
    kind: direction === 'aToB' ? parentKind : childKind,
    reciprocalKind: direction === 'aToB' ? childKind : parentKind,
    period: clampToLifetimes(period, parent, child),
    path: direction === 'aToB' ? [parent.id, child.id] : [child.id, parent.id],
    via: 'parentLink',
  }
}

function siblingRelationship(personA: Person, personB: Person, index: GraphIndex): ResolvedRelationship | null {
  const parentsA = new Set(parentIdsOf(personA.id, index))
  const parentsB = new Set(parentIdsOf(personB.id, index))
  const shared = [...parentsA].filter((parentId) => parentsB.has(parentId)).sort()
  if (shared.length === 0) return null

  // Two shared parents is a full sibling; exactly one, a half sibling —
  // matching how deriveRelationships already classifies them elsewhere.
  const kind: RelationshipKind = shared.length >= 2 ? 'sibling' : 'halfSibling'
  return {
    id: `sibling:${shared.join(',')}`,
    kind,
    reciprocalKind: kind,
    period: coexistencePeriod(personA, personB),
    path: [personA.id, shared[0] as string, personB.id],
    via: 'derived',
  }
}

/** A is `depth` generations above B (2 = grandparent, 3 = great-grandparent). */
function ancestorRelationship(
  ancestor: Person,
  descendant: Person,
  index: GraphIndex,
  depth: 2 | 3,
  reversed = false,
): ResolvedRelationship | null {
  const match = ancestorsAtDepth(descendant.id, depth, index).find((entry) => entry.id === ancestor.id)
  if (!match) return null

  const ancestorKind: RelationshipKind = depth === 2 ? 'grandparent' : 'greatGrandparent'
  const descendantKind: RelationshipKind = depth === 2 ? 'grandchild' : 'greatGrandchild'
  // match.path runs descendant -> ... -> ancestor.
  const pathFromAncestor = [...match.path].reverse()

  return {
    id: `ancestor:${depth}:${ancestor.id}:${descendant.id}`,
    kind: reversed ? descendantKind : ancestorKind,
    reciprocalKind: reversed ? ancestorKind : descendantKind,
    period: coexistencePeriod(ancestor, descendant),
    path: reversed ? match.path : pathFromAncestor,
    via: 'derived',
  }
}

/**
 * A is the sibling of one of B's parents — or the partner of such a
 * person, which is an aunt/uncle by marriage and kept distinct so the UI
 * can word it honestly.
 */
function auntUncleRelationships(
  candidate: Person,
  nibling: Person,
  index: GraphIndex,
  reversed: boolean,
): ResolvedRelationship[] {
  const results: ResolvedRelationship[] = []
  const candidateParents = new Set(parentIdsOf(candidate.id, index))

  for (const parentId of parentIdsOf(nibling.id, index)) {
    if (parentId === candidate.id) continue
    const parent = index.peopleById.get(parentId)
    if (!parent) continue

    // Blood: candidate and the nibling's parent share a parent.
    const sharesParent = parentIdsOf(parentId, index).some((grandparentId) =>
      candidateParents.has(grandparentId),
    )
    if (sharesParent) {
      results.push({
        id: `auntUncle:${candidate.id}:${parentId}:${nibling.id}`,
        kind: reversed ? 'niblingByBlood' : 'auntUncle',
        reciprocalKind: reversed ? 'auntUncle' : 'niblingByBlood',
        period: coexistencePeriod(candidate, nibling),
        path: reversed ? [nibling.id, parentId, candidate.id] : [candidate.id, parentId, nibling.id],
        via: 'derived',
      })
      continue
    }

    // By marriage: candidate is partnered with a sibling of the parent.
    for (const union of index.unionsByPerson.get(candidate.id) ?? []) {
      const spouseId = otherPartner(union, candidate.id)
      if (spouseId === parentId) continue
      const spouseSharesParent = parentIdsOf(spouseId, index).some((grandparentId) =>
        parentIdsOf(parentId, index).includes(grandparentId),
      )
      if (!spouseSharesParent) continue

      results.push({
        id: `auntUncleByMarriage:${union.id}:${nibling.id}`,
        kind: reversed ? 'niblingByMarriage' : 'auntUncleByMarriage',
        reciprocalKind: reversed ? 'auntUncleByMarriage' : 'niblingByMarriage',
        // It only becomes an in-law relationship once the union exists.
        period: clampToLifetimes(
          { start: laterOf(union.startDate, nibling.birthDate) ?? union.startDate ?? null, end: union.endDate ?? null },
          candidate,
          nibling,
        ),
        path: reversed
          ? [nibling.id, parentId, spouseId, candidate.id]
          : [candidate.id, spouseId, parentId, nibling.id],
        via: 'derived',
      })
    }
  }

  return results
}

/** First cousins: their parents are siblings. */
function cousinRelationship(personA: Person, personB: Person, index: GraphIndex): ResolvedRelationship | null {
  for (const parentAId of parentIdsOf(personA.id, index)) {
    const grandparentsA = new Set(parentIdsOf(parentAId, index))
    for (const parentBId of parentIdsOf(personB.id, index)) {
      if (parentAId === parentBId) continue
      const sharesGrandparent = parentIdsOf(parentBId, index).some((id) => grandparentsA.has(id))
      if (!sharesGrandparent) continue

      return {
        id: `cousin:${[parentAId, parentBId].sort().join(',')}`,
        kind: 'cousin',
        reciprocalKind: 'cousin',
        period: coexistencePeriod(personA, personB),
        path: [personA.id, parentAId, parentBId, personB.id],
        via: 'derived',
      }
    }
  }
  return null
}

/**
 * The union period during which `stepParentId` was partnered with any
 * parent of `childId` — the only factual basis for when a step
 * relationship began, since ParentLink stores no dates.
 */
function stepPeriodFromUnions(
  stepParentId: string,
  childId: string,
  index: GraphIndex,
): RelationshipPeriod | null {
  const childParents = new Set(parentIdsOf(childId, index))
  for (const union of index.unionsByPerson.get(stepParentId) ?? []) {
    if (!childParents.has(otherPartner(union, stepParentId))) continue
    return { start: union.startDate ?? null, end: union.endDate ?? null }
  }
  return null
}

/**
 * A is partnered with one of B's parents but is not B's own parent. The
 * explicit `relationship: 'step'` ParentLink is handled separately by the
 * direct detector; this covers the far more common case where the step
 * relationship is implied by a Union rather than recorded as a link.
 */
function stepParentRelationships(
  candidate: Person,
  child: Person,
  index: GraphIndex,
  reversed: boolean,
): ResolvedRelationship[] {
  const childParents = new Set(parentIdsOf(child.id, index))
  if (childParents.has(candidate.id)) return []

  const results: ResolvedRelationship[] = []
  for (const union of index.unionsByPerson.get(candidate.id) ?? []) {
    const partnerId = otherPartner(union, candidate.id)
    if (!childParents.has(partnerId)) continue

    results.push({
      id: `stepParent:${union.id}:${child.id}`,
      kind: reversed ? 'stepChild' : 'stepParent',
      reciprocalKind: reversed ? 'stepParent' : 'stepChild',
      period: clampToLifetimes(
        { start: union.startDate ?? null, end: union.endDate ?? null },
        candidate,
        child,
      ),
      path: reversed ? [child.id, partnerId, candidate.id] : [candidate.id, partnerId, child.id],
      via: 'union',
    })
  }
  return results
}

/** Their parents are partnered with each other, and they share no parent of their own. */
function stepSiblingRelationship(
  personA: Person,
  personB: Person,
  index: GraphIndex,
): ResolvedRelationship | null {
  const parentsA = parentIdsOf(personA.id, index)
  const parentsB = parentIdsOf(personB.id, index)
  if (parentsA.some((id) => parentsB.includes(id))) return null

  for (const parentAId of parentsA) {
    for (const union of index.unionsByPerson.get(parentAId) ?? []) {
      const partnerId = otherPartner(union, parentAId)
      if (!parentsB.includes(partnerId)) continue

      return {
        id: `stepSibling:${union.id}`,
        kind: 'stepSibling',
        reciprocalKind: 'stepSibling',
        period: clampToLifetimes(
          { start: union.startDate ?? null, end: union.endDate ?? null },
          personA,
          personB,
        ),
        path: [personA.id, parentAId, partnerId, personB.id],
        via: 'union',
      }
    }
  }
  return null
}

/**
 * Two detectors can legitimately describe the same connection (an
 * explicit `step` ParentLink alongside the union that implies it). Keep
 * the first, in detector order, so output is deterministic.
 */
function dedupe(relationships: ResolvedRelationship[]): ResolvedRelationship[] {
  const seen = new Set<string>()
  const result: ResolvedRelationship[] = []
  for (const relationship of relationships) {
    const key = `${relationship.kind}|${relationship.path.join('>')}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(relationship)
  }
  return result
}
