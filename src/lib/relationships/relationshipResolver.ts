import type { ParentLink, Person, Union } from '../../types'
import type {
  LineageDistance,
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

  // --- Everything measured through a shared forebear -------------------
  // Siblings, grandparents, aunts, cousins and their removals all come
  // out of one calculation rather than a rule apiece.
  for (const relationship of lineageRelationships(personA, personB, index)) push(relationship)

  // --- Aunt/uncle by marriage -----------------------------------------
  for (const relationship of auntUncleByMarriageRelationships(personA, personB, index, false)) push(relationship)
  for (const relationship of auntUncleByMarriageRelationships(personB, personA, index, true)) push(relationship)

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

/**
 * Which ParentLink subtypes carry lineage.
 *
 * Biological and adoptive links make someone part of the family line — an
 * adopted child's grandparents really are their grandparents — so both are
 * followed. Step and foster links are not: they are the transitional
 * relationships the dedicated step detectors already describe, and walking
 * through them would quietly turn a step-parent's mother into a plain
 * "grandmother", which is exactly the kind of confident-but-wrong label
 * this engine is supposed to avoid.
 */
const LINEAGE_SUBTYPES: ReadonlySet<ParentLink['relationship']> = new Set(['biological', 'adopted'])

function lineageParentIdsOf(personId: string, index: GraphIndex): string[] {
  return (index.parentLinksByChild.get(personId) ?? [])
    .filter((link) => LINEAGE_SUBTYPES.has(link.relationship))
    .map((link) => link.parentId)
}

interface AncestorHit {
  /** Generations up from the starting person; 0 is the person themselves. */
  distance: number
  /** Ids from the starting person up to this forebear, inclusive at both ends. */
  path: string[]
}

/**
 * Every forebear reachable by walking up lineage links, with the shortest
 * distance to each. Breadth-first, so the first time a forebear is seen is
 * by the shortest route; a visited set means malformed or cyclic data
 * terminates instead of recursing forever.
 */
function ancestorMap(personId: string, index: GraphIndex): Map<string, AncestorHit> {
  const found = new Map<string, AncestorHit>([[personId, { distance: 0, path: [personId] }]])
  let frontier: AncestorHit[] = [{ distance: 0, path: [personId] }]

  while (frontier.length > 0) {
    const next: AncestorHit[] = []
    for (const entry of frontier) {
      const currentId = entry.path[entry.path.length - 1] as string
      for (const parentId of lineageParentIdsOf(currentId, index)) {
        if (found.has(parentId)) continue
        const hit = { distance: entry.distance + 1, path: [...entry.path, parentId] }
        found.set(parentId, hit)
        next.push(hit)
      }
    }
    frontier = next
  }
  return found
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

/**
 * Everything that can be measured through a shared forebear, from one
 * calculation instead of a rule per relationship.
 *
 * For each shared forebear, count the generations up to it from each
 * person — dA and dB. Those two numbers alone name the relationship:
 *
 *   dA=0            A is the forebear      -> ancestor of B
 *   dB=0            B is the forebear      -> descendant of B
 *   dA=1, dB=1      shared parent          -> sibling (full or half)
 *   dA=1, dB=2      sibling of B's parent  -> aunt/uncle
 *   dA=1, dB=3      sibling of a grandparent -> great-aunt/uncle
 *   dA=2, dB=2      -> first cousins
 *   dA=3, dB=3      -> second cousins
 *   dA=2, dB=3      -> first cousins once removed
 *   dA=3, dB=5      -> second cousins twice removed
 *
 * so the general rule for two collateral branches is: the cousin degree
 * is min(dA,dB)-1 and the removal is |dA-dB|, with min(dA,dB)=1 being the
 * sibling/aunt/nibling family instead. Nothing needs adding to reach a
 * fourth cousin four times removed.
 *
 * Only the MOST RECENT shared forebears are used. Siblings share their
 * parents AND their grandparents, and without this they would be reported
 * as first cousins as well; discarding any forebear that is itself an
 * ancestor of another shared forebear removes those echoes. What it keeps
 * is genuinely separate connections — being first cousins on one side and
 * second cousins on the other survives, because neither shared forebear
 * sits above the other.
 */
function lineageRelationships(personA: Person, personB: Person, index: GraphIndex): ResolvedRelationship[] {
  const ancestorsA = ancestorMap(personA.id, index)
  const ancestorsB = ancestorMap(personB.id, index)

  const shared = [...ancestorsA.keys()].filter((id) => ancestorsB.has(id))
  if (shared.length === 0) return []

  // Drop any shared forebear that an ancestor of another shared forebear.
  const sharedSet = new Set(shared)
  const mostRecent = shared.filter((candidateId) => {
    for (const otherId of shared) {
      if (otherId === candidateId) continue
      const otherAncestors = ancestorMap(otherId, index)
      if (otherAncestors.has(candidateId)) return false
    }
    return true
  })
  // Guard against a malformed cycle leaving nothing behind.
  const forebears = mostRecent.length > 0 ? mostRecent : [...sharedSet]

  // Group by the pair of distances: two grandparents who are a couple
  // describe ONE first-cousin relationship, not two.
  const byDistance = new Map<string, { dA: number; dB: number; ids: string[] }>()
  for (const forebearId of forebears) {
    const hitA = ancestorsA.get(forebearId) as AncestorHit
    const hitB = ancestorsB.get(forebearId) as AncestorHit
    const key = `${hitA.distance}:${hitB.distance}`
    const group = byDistance.get(key) ?? { dA: hitA.distance, dB: hitB.distance, ids: [] }
    group.ids.push(forebearId)
    byDistance.set(key, group)
  }

  const results: ResolvedRelationship[] = []
  for (const group of [...byDistance.values()].sort((a, b) => a.dA + a.dB - (b.dA + b.dB))) {
    const classified = classifyLineage(group.dA, group.dB, group.ids.length)
    if (!classified) continue

    // One route per shared forebear. Grouping them into a single result
    // is what stops a married couple producing two identical cards, but
    // the routes themselves are real and are kept rather than discarded —
    // four of them is how double first cousins differ from ordinary ones.
    const forebearIds = [...group.ids].sort()
    const paths = forebearIds.map((id) => {
      const hitA = ancestorsA.get(id) as AncestorHit
      const hitB = ancestorsB.get(id) as AncestorHit
      // A -> ... -> shared forebear -> ... -> B, without repeating the forebear.
      return [...hitA.path, ...[...hitB.path].reverse().slice(1)]
    })

    results.push({
      id: `lineage:${classified.kind}:${forebearIds.join(',')}`,
      kind: classified.kind,
      reciprocalKind: classified.reciprocalKind,
      lineage: classified.lineage,
      period: coexistencePeriod(personA, personB),
      path: paths[0] as string[],
      via: 'derived',
      commonAncestorIds: forebearIds,
      paths,
    })
  }
  return results
}

interface ClassifiedLineage {
  kind: RelationshipKind
  reciprocalKind: RelationshipKind
  lineage: LineageDistance
}

/**
 * `sharedForebearCount` only matters for siblings: sharing both parents
 * is a full sibling, sharing one is a half sibling.
 */
function classifyLineage(dA: number, dB: number, sharedForebearCount: number): ClassifiedLineage | null {
  // A direct parent or child is described by its ParentLink, which knows
  // whether it is biological, adoptive, step or foster — so lineage stays
  // out of it rather than reporting a second, subtype-blind "parent".
  if (dA === 0 && dB === 1) return null
  if (dB === 0 && dA === 1) return null

  if (dA === 0) {
    return {
      kind: 'ancestor',
      reciprocalKind: 'descendant',
      lineage: { generations: dB },
    }
  }
  if (dB === 0) {
    return {
      kind: 'descendant',
      reciprocalKind: 'ancestor',
      lineage: { generations: dA },
    }
  }

  const nearer = Math.min(dA, dB)
  const removal = Math.abs(dA - dB)

  if (nearer === 1) {
    if (removal === 0) {
      const kind: RelationshipKind = sharedForebearCount >= 2 ? 'sibling' : 'halfSibling'
      return { kind, reciprocalKind: kind, lineage: {} }
    }
    // The closer person is the sibling of the other's ancestor.
    const greats = removal - 1
    return dA < dB
      ? { kind: 'auntUncle', reciprocalKind: 'nibling', lineage: { greats } }
      : { kind: 'nibling', reciprocalKind: 'auntUncle', lineage: { greats } }
  }

  return {
    kind: 'cousin',
    reciprocalKind: 'cousin',
    lineage: { cousinDegree: nearer - 1, removed: removal },
  }
}

/**
 * A is partnered with a sibling of one of B's parents. Kept separate from
 * the lineage calculation because it is not a shared-forebear
 * relationship at all, and kept deliberately narrow: extending it to
 * every possible in-law would mean labelling connections the records
 * cannot reliably support.
 */
function auntUncleByMarriageRelationships(
  candidate: Person,
  nibling: Person,
  index: GraphIndex,
  reversed: boolean,
): ResolvedRelationship[] {
  const results: ResolvedRelationship[] = []
  const candidateAncestors = ancestorMap(candidate.id, index)

  for (const parentId of lineageParentIdsOf(nibling.id, index)) {
    if (parentId === candidate.id) continue
    // Only when the candidate is not already related by blood, so a
    // relative who also married in is not reported twice.
    if (candidateAncestors.has(parentId)) continue

    for (const union of index.unionsByPerson.get(candidate.id) ?? []) {
      const spouseId = otherPartner(union, candidate.id)
      if (spouseId === parentId) continue

      const spouseParents = lineageParentIdsOf(spouseId, index)
      const parentParents = lineageParentIdsOf(parentId, index)
      if (!spouseParents.some((id) => parentParents.includes(id))) continue

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
    // The distances are part of the identity: a first cousin and a second
    // cousin are different relationships even when the route between them
    // happens to be written the same way.
    const { generations, greats, cousinDegree, removed } = relationship.lineage ?? {}
    const key = [
      relationship.kind,
      generations ?? '',
      greats ?? '',
      cousinDegree ?? '',
      removed ?? '',
      relationship.path.join('>'),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(relationship)
  }
  return result
}
