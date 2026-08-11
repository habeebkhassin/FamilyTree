// Pure-function tests: the resolver reads no storage, so unlike the
// storage suite these need no IndexedDB shim.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Gender, ParentLink, ParentRelationship, Person, Union, UnionStatus } from '../../types'
import { formatRelationshipLabel, formatRelationshipPeriod } from './relationshipDisplay'
import { resolveRelationships } from './relationshipResolver'
import type { RelationshipGraph, RelationshipKind, ResolvedRelationship } from './relationshipTypes'

const TREE_ID = 'tree-1'
const ISO = '2024-01-01T00:00:00.000Z'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function makePerson(firstName: string, options: { gender?: Gender; birth?: string; death?: string } = {}): Person {
  return {
    id: nextId('person'),
    familyTreeId: TREE_ID,
    firstName,
    lastName: '',
    gender: options.gender ?? 'unknown',
    birthDate: options.birth,
    deathDate: options.death,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function makeParentLink(parent: Person, child: Person, relationship: ParentRelationship = 'biological'): ParentLink {
  return {
    id: nextId('link'),
    familyTreeId: TREE_ID,
    parentId: parent.id,
    childId: child.id,
    relationship,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function makeUnion(
  a: Person,
  b: Person,
  options: { status?: UnionStatus; start?: string; end?: string } = {},
): Union {
  return {
    id: nextId('union'),
    familyTreeId: TREE_ID,
    partnerAId: a.id,
    partnerBId: b.id,
    status: options.status ?? 'married',
    startDate: options.start,
    endDate: options.end,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function graphOf(people: Person[], parentLinks: ParentLink[], unions: Union[] = []): RelationshipGraph {
  return { people, parentLinks, unions }
}

function kinds(results: ResolvedRelationship[]): RelationshipKind[] {
  return results.map((result) => result.kind).sort()
}

function find(results: ResolvedRelationship[], kind: RelationshipKind): ResolvedRelationship {
  const match = results.find((result) => result.kind === kind)
  if (!match) throw new Error(`expected a "${kind}" relationship, got: ${kinds(results).join(', ') || '(none)'}`)
  return match
}

test('1. parent and child are resolved in both directions', () => {
  const parent = makePerson('Parent')
  const child = makePerson('Child', { birth: '1999-04-02' })
  const graph = graphOf([parent, child], [makeParentLink(parent, child)])

  const forward = resolveRelationships(parent.id, child.id, graph)
  assert.deepEqual(kinds(forward), ['parent'])
  assert.equal(find(forward, 'parent').reciprocalKind, 'child')
  assert.equal(find(forward, 'parent').period.start, '1999-04-02', 'a parent relationship begins at the birth')

  const backward = resolveRelationships(child.id, parent.id, graph)
  assert.deepEqual(kinds(backward), ['child'])
  assert.equal(find(backward, 'child').reciprocalKind, 'parent')
})

test('2. gender turns the neutral kind into mother/father and son/daughter', () => {
  const mother = makePerson('Mona', { gender: 'female' })
  const son = makePerson('Sam', { gender: 'male' })
  const graph = graphOf([mother, son], [makeParentLink(mother, son)])

  const results = resolveRelationships(mother.id, son.id, graph)
  assert.equal(formatRelationshipLabel(find(results, 'parent').kind, mother), 'Mother')
  assert.equal(formatRelationshipLabel(find(results, 'parent').reciprocalKind, son), 'Son')
})

test('3. two shared parents make full siblings', () => {
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const one = makePerson('One', { birth: '1990-01-01' })
  const two = makePerson('Two', { birth: '1994-01-01' })
  const graph = graphOf(
    [mum, dad, one, two],
    [makeParentLink(mum, one), makeParentLink(dad, one), makeParentLink(mum, two), makeParentLink(dad, two)],
  )

  const results = resolveRelationships(one.id, two.id, graph)
  assert.ok(kinds(results).includes('sibling'))
  assert.equal(find(results, 'sibling').period.start, '1994-01-01', 'starts when the younger one is born')
})

test('4. exactly one shared parent makes half-siblings, not siblings', () => {
  const mum = makePerson('Mum')
  const dadA = makePerson('Dad A')
  const dadB = makePerson('Dad B')
  const one = makePerson('One')
  const two = makePerson('Two')
  const graph = graphOf(
    [mum, dadA, dadB, one, two],
    [makeParentLink(mum, one), makeParentLink(dadA, one), makeParentLink(mum, two), makeParentLink(dadB, two)],
  )

  const results = resolveRelationships(one.id, two.id, graph)
  assert.ok(kinds(results).includes('halfSibling'))
  assert.ok(!kinds(results).includes('sibling'))
})

test('5. grandparent and great-grandparent are found at the right depth', () => {
  const great = makePerson('Great')
  const grand = makePerson('Grand')
  const parent = makePerson('Parent')
  const child = makePerson('Child')
  const graph = graphOf(
    [great, grand, parent, child],
    [makeParentLink(great, grand), makeParentLink(grand, parent), makeParentLink(parent, child)],
  )

  assert.ok(kinds(resolveRelationships(grand.id, child.id, graph)).includes('grandparent'))
  assert.ok(kinds(resolveRelationships(child.id, grand.id, graph)).includes('grandchild'))
  assert.ok(kinds(resolveRelationships(great.id, child.id, graph)).includes('greatGrandparent'))
  assert.ok(kinds(resolveRelationships(child.id, great.id, graph)).includes('greatGrandchild'))
})

test('6/7. aunt and nephew are reciprocal, and dated from the younger birth', () => {
  const grand = makePerson('Grand')
  const parent = makePerson('Parent')
  const aunt = makePerson('Ava', { gender: 'female', birth: '1975-01-01' })
  const nibling = makePerson('Habeeb', { gender: 'male', birth: '1999-06-01' })
  const graph = graphOf(
    [grand, parent, aunt, nibling],
    [makeParentLink(grand, parent), makeParentLink(grand, aunt), makeParentLink(parent, nibling)],
  )

  const forward = resolveRelationships(aunt.id, nibling.id, graph)
  const auntRel = find(forward, 'auntUncle')
  assert.equal(auntRel.reciprocalKind, 'niblingByBlood')
  assert.equal(formatRelationshipLabel(auntRel.kind, aunt), 'Aunt')
  assert.equal(formatRelationshipLabel(auntRel.reciprocalKind, nibling), 'Nephew')
  assert.equal(auntRel.period.start, '1999-06-01')
  assert.equal(formatRelationshipPeriod(auntRel.period), '1999 – Present')

  assert.ok(kinds(resolveRelationships(nibling.id, aunt.id, graph)).includes('niblingByBlood'))
})

test('8. first cousins are found through sibling parents', () => {
  const grand = makePerson('Grand')
  const parentA = makePerson('Parent A')
  const parentB = makePerson('Parent B')
  const cousinA = makePerson('Cousin A')
  const cousinB = makePerson('Cousin B')
  const graph = graphOf(
    [grand, parentA, parentB, cousinA, cousinB],
    [
      makeParentLink(grand, parentA),
      makeParentLink(grand, parentB),
      makeParentLink(parentA, cousinA),
      makeParentLink(parentB, cousinB),
    ],
  )

  const results = resolveRelationships(cousinA.id, cousinB.id, graph)
  assert.ok(kinds(results).includes('cousin'))
  assert.equal(find(results, 'cousin').reciprocalKind, 'cousin')
})

test('9. a married union resolves as spouse and carries the union dates', () => {
  const wife = makePerson('Wife', { gender: 'female' })
  const husband = makePerson('Husband', { gender: 'male' })
  const graph = graphOf([wife, husband], [], [makeUnion(wife, husband, { start: '2010-05-01' })])

  const results = resolveRelationships(wife.id, husband.id, graph)
  const spouse = find(results, 'spouse')
  assert.equal(spouse.period.start, '2010-05-01')
  assert.equal(spouse.period.end, null)
  assert.equal(formatRelationshipLabel(spouse.kind, wife), 'Wife')
  assert.equal(formatRelationshipLabel(spouse.reciprocalKind, husband), 'Husband')
})

test('10. two unions between the same pair stay distinct', () => {
  const a = makePerson('A')
  const b = makePerson('B')
  const graph = graphOf(
    [a, b],
    [],
    [
      makeUnion(a, b, { status: 'divorced', start: '2000-01-01', end: '2008-01-01' }),
      makeUnion(a, b, { status: 'married', start: '2015-01-01' }),
    ],
  )

  const results = resolveRelationships(a.id, b.id, graph)
  assert.equal(results.length, 2, 'a remarriage is two relationships, not one')
  assert.equal(formatRelationshipPeriod(results[0]?.period ?? { start: null, end: null }), '2000 – 2008')
  assert.equal(formatRelationshipPeriod(results[1]?.period ?? { start: null, end: null }), '2015 – Present')
})

test('11. a step-parent is derived from the union with the child’s parent, dated from that union', () => {
  const parent = makePerson('Parent')
  const stepParent = makePerson('Ava', { gender: 'female' })
  const child = makePerson('Habeeb', { gender: 'male', birth: '1999-06-01' })
  const graph = graphOf(
    [parent, stepParent, child],
    [makeParentLink(parent, child)],
    [makeUnion(parent, stepParent, { start: '2023-03-01' })],
  )

  const results = resolveRelationships(stepParent.id, child.id, graph)
  const step = find(results, 'stepParent')
  assert.equal(step.period.start, '2023-03-01', 'the step relationship begins with the marriage, not the birth')
  assert.equal(formatRelationshipLabel(step.kind, stepParent), 'Stepmother')
  assert.equal(formatRelationshipLabel(step.reciprocalKind, child), 'Stepson')
  assert.ok(kinds(resolveRelationships(child.id, stepParent.id, graph)).includes('stepChild'))
})

test('12. adopted and foster ParentLinks keep their own kind', () => {
  const adopter = makePerson('Adopter')
  const adoptee = makePerson('Adoptee')
  const fosterParent = makePerson('Foster')
  const fosterChild = makePerson('Fostered')
  const graph = graphOf(
    [adopter, adoptee, fosterParent, fosterChild],
    [makeParentLink(adopter, adoptee, 'adopted'), makeParentLink(fosterParent, fosterChild, 'foster')],
  )

  assert.ok(kinds(resolveRelationships(adopter.id, adoptee.id, graph)).includes('adoptiveParent'))
  assert.ok(kinds(resolveRelationships(adoptee.id, adopter.id, graph)).includes('adoptedChild'))
  assert.ok(kinds(resolveRelationships(fosterParent.id, fosterChild.id, graph)).includes('fosterParent'))
  assert.ok(kinds(resolveRelationships(fosterChild.id, fosterParent.id, graph)).includes('fosterChild'))
})

test('13/19. the Ava/Habeeb case returns BOTH aunt and stepmother, each with its own period', () => {
  // Ava is the sibling of Habeeb's father, and later marries Habeeb's
  // mother — so she is simultaneously his aunt and his stepmother, and
  // neither reading cancels the other.
  const grand = makePerson('Grand')
  const father = makePerson('Father', { gender: 'male' })
  const mother = makePerson('Mother', { gender: 'female' })
  const ava = makePerson('Ava', { gender: 'female', birth: '1975-01-01' })
  const habeeb = makePerson('Habeeb', { gender: 'male', birth: '1999-06-01' })

  const graph = graphOf(
    [grand, father, mother, ava, habeeb],
    [
      makeParentLink(grand, father),
      makeParentLink(grand, ava),
      makeParentLink(father, habeeb),
      makeParentLink(mother, habeeb),
    ],
    [makeUnion(mother, ava, { start: '2023-03-01' })],
  )

  const results = resolveRelationships(ava.id, habeeb.id, graph)
  const resultKinds = kinds(results)
  assert.ok(resultKinds.includes('auntUncle'), 'aunt survives')
  assert.ok(resultKinds.includes('stepParent'), 'stepmother is also found')

  assert.equal(formatRelationshipPeriod(find(results, 'auntUncle').period), '1999 – Present')
  assert.equal(formatRelationshipPeriod(find(results, 'stepParent').period), '2023 – Present')

  // And the reciprocal view holds both, too.
  const reciprocal = kinds(resolveRelationships(habeeb.id, ava.id, graph))
  assert.ok(reciprocal.includes('niblingByBlood'))
  assert.ok(reciprocal.includes('stepChild'))
})

test('14. every relationship states its reciprocal without needing a second lookup', () => {
  const parent = makePerson('Parent')
  const child = makePerson('Child')
  const graph = graphOf([parent, child], [makeParentLink(parent, child)])

  const forward = find(resolveRelationships(parent.id, child.id, graph), 'parent')
  const backward = find(resolveRelationships(child.id, parent.id, graph), 'child')
  assert.equal(forward.reciprocalKind, backward.kind)
  assert.equal(backward.reciprocalKind, forward.kind)
})

test('15. missing gender falls back to a neutral term rather than guessing', () => {
  const parent = makePerson('Parent') // gender: 'unknown'
  const child = makePerson('Child', { gender: 'other' })
  const graph = graphOf([parent, child], [makeParentLink(parent, child)])

  const results = resolveRelationships(parent.id, child.id, graph)
  assert.equal(formatRelationshipLabel(find(results, 'parent').kind, parent), 'Parent')
  assert.equal(formatRelationshipLabel(find(results, 'parent').reciprocalKind, child), 'Child')
})

test('16/20. unrelated people produce nothing, and neither does a person with themselves', () => {
  const a = makePerson('A')
  const b = makePerson('B')
  const unrelated = makePerson('Unrelated')
  const graph = graphOf([a, b, unrelated], [makeParentLink(a, b)])

  assert.deepEqual(resolveRelationships(a.id, unrelated.id, graph), [], 'no relationship is invented')
  assert.deepEqual(resolveRelationships(unrelated.id, b.id, graph), [])
  assert.deepEqual(resolveRelationships(a.id, a.id, graph), [], 'a person is not related to themselves')
  assert.deepEqual(resolveRelationships(a.id, 'missing-id', graph), [], 'unknown ids resolve to nothing')
})

test('17. the path explains the connection, starting at A and ending at B', () => {
  const grand = makePerson('Grand')
  const parent = makePerson('Parent')
  const aunt = makePerson('Aunt')
  const nibling = makePerson('Nibling')
  const graph = graphOf(
    [grand, parent, aunt, nibling],
    [makeParentLink(grand, parent), makeParentLink(grand, aunt), makeParentLink(parent, nibling)],
  )

  const auntRel = find(resolveRelationships(aunt.id, nibling.id, graph), 'auntUncle')
  assert.equal(auntRel.path[0], aunt.id, 'path starts at A')
  assert.equal(auntRel.path[auntRel.path.length - 1], nibling.id, 'path ends at B')
  assert.deepEqual(auntRel.path, [aunt.id, parent.id, nibling.id])

  const grandRel = find(resolveRelationships(grand.id, nibling.id, graph), 'grandparent')
  assert.deepEqual(grandRel.path, [grand.id, parent.id, nibling.id])
})

test('18. a death closes the period, and an undated union reports an unknown start', () => {
  const a = makePerson('A', { birth: '1950-01-01', death: '2005-08-01' })
  const b = makePerson('B', { birth: '1980-01-01' })
  const graph = graphOf([a, b], [makeParentLink(a, b)], [])

  const parentRel = find(resolveRelationships(a.id, b.id, graph), 'parent')
  assert.equal(parentRel.period.end, '2005-08-01', 'a relationship cannot outlive either person')
  assert.equal(formatRelationshipPeriod(parentRel.period), '1980 – 2005')

  const x = makePerson('X')
  const y = makePerson('Y')
  const undated = graphOf([x, y], [], [makeUnion(x, y)])
  const spouse = find(resolveRelationships(x.id, y.id, undated), 'spouse')
  assert.equal(spouse.period.start, null, 'no start date is invented')
  assert.equal(formatRelationshipPeriod(spouse.period), 'Dates unknown')
})

test('18b. every combination of known and unknown ends has its own consistent wording', () => {
  assert.equal(formatRelationshipPeriod({ start: '1999-06-01', end: '2005-08-01' }), '1999 – 2005')
  assert.equal(formatRelationshipPeriod({ start: '1999-06-01', end: null }), '1999 – Present')
  assert.equal(formatRelationshipPeriod({ start: null, end: '2005-08-01' }), 'Until 2005')
  assert.equal(
    formatRelationshipPeriod({ start: null, end: null }),
    'Dates unknown',
    'nothing datable reads as a whole phrase, not a half-filled range',
  )
})

test('19b. step-siblings are found through their parents’ union, and only when no parent is shared', () => {
  const parentA = makePerson('Parent A')
  const parentB = makePerson('Parent B')
  const childA = makePerson('Child A')
  const childB = makePerson('Child B')
  const graph = graphOf(
    [parentA, parentB, childA, childB],
    [makeParentLink(parentA, childA), makeParentLink(parentB, childB)],
    [makeUnion(parentA, parentB, { start: '2018-01-01' })],
  )

  const results = resolveRelationships(childA.id, childB.id, graph)
  assert.ok(kinds(results).includes('stepSibling'))
  assert.equal(find(results, 'stepSibling').period.start, '2018-01-01')

  // Full siblings must never also be reported as step-siblings.
  const shared = graphOf(
    [parentA, parentB, childA, childB],
    [
      makeParentLink(parentA, childA),
      makeParentLink(parentB, childA),
      makeParentLink(parentA, childB),
      makeParentLink(parentB, childB),
    ],
    [makeUnion(parentA, parentB)],
  )
  assert.ok(!kinds(resolveRelationships(childA.id, childB.id, shared)).includes('stepSibling'))
})

test('20b. results are deterministic and free of duplicates', () => {
  const grand = makePerson('Grand')
  const father = makePerson('Father')
  const mother = makePerson('Mother')
  const ava = makePerson('Ava')
  const habeeb = makePerson('Habeeb')
  const graph = graphOf(
    [grand, father, mother, ava, habeeb],
    [
      makeParentLink(grand, father),
      makeParentLink(grand, ava),
      makeParentLink(father, habeeb),
      makeParentLink(mother, habeeb),
    ],
    [makeUnion(mother, ava, { start: '2023-03-01' })],
  )

  const first = resolveRelationships(ava.id, habeeb.id, graph)
  const second = resolveRelationships(ava.id, habeeb.id, graph)
  assert.deepEqual(first, second, 'same input, same output')

  const ids = first.map((relationship) => relationship.id)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate relationship ids')
})
