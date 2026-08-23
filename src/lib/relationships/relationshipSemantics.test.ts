import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  ANCESTRAL_PARENT_LINKS,
  isAncestralParentLink,
  isProximityParentLink,
  PROXIMITY_PARENT_LINKS,
  semanticsOfParentLink,
  SOCIAL_PARENT_LINKS,
} from './relationshipSemantics'
import { resolveRelationships } from './relationshipResolver'
import { buildFamilyGraph } from '../../features/tree-view/graphAdapter'
import { computeRanks } from '../../features/tree-view/rank'
import { projectLineage } from '../../features/tree-view/lineageView'
import { displacementsFrom } from '../../features/tree-view/myFamilyView'
import type { ParentLink, ParentRelationship, Person, Union } from '../../types'

const TREE = 't'
const AT = '2026-01-01T00:00:00.000Z'
const person = (id: string): Person => ({
  id, familyTreeId: TREE, firstName: id, lastName: 'X', gender: 'unknown', createdAt: AT, updatedAt: AT,
})
const link = (id: string, parentId: string, childId: string, relationship: ParentRelationship): ParentLink => ({
  id, familyTreeId: TREE, parentId, childId, relationship, createdAt: AT, updatedAt: AT,
})

/** Every subtype the schema allows, listed so the partition test is exhaustive. */
const ALL_SUBTYPES: ParentRelationship[] = ['biological', 'adopted', 'step', 'foster']

// ── The rule itself ──────────────────────────────────────────────────

test('1. a biological parent participates in ancestry', () => {
  assert.equal(isAncestralParentLink('biological'), true)
  assert.equal(semanticsOfParentLink('biological'), 'ancestral')
})

test('2. an adoptive parent participates in ancestry', () => {
  assert.equal(isAncestralParentLink('adopted'), true)
  assert.equal(semanticsOfParentLink('adopted'), 'ancestral')
})

test('3. a step-parent does not participate in ancestry', () => {
  assert.equal(isAncestralParentLink('step'), false)
  assert.equal(semanticsOfParentLink('step'), 'social')
})

test('4. a foster parent does not participate in ancestry', () => {
  assert.equal(isAncestralParentLink('foster'), false)
  assert.equal(semanticsOfParentLink('foster'), 'social')
})

test('5. step and foster are still family, and every subtype is still supported', () => {
  // Categorising them is not the same as weakening them.
  for (const subtype of ALL_SUBTYPES) {
    assert.equal(isProximityParentLink(subtype), true, subtype + ' is family')
  }
  assert.equal(SOCIAL_PARENT_LINKS.has('step'), true)
  assert.equal(SOCIAL_PARENT_LINKS.has('foster'), true)
})

test('6. the two categories partition the subtype union exactly', () => {
  // Adding a subtype to ParentRelationship without classifying it fails
  // here rather than silently defaulting to one side.
  for (const subtype of ALL_SUBTYPES) {
    const ancestral = ANCESTRAL_PARENT_LINKS.has(subtype)
    const social = SOCIAL_PARENT_LINKS.has(subtype)
    assert.notEqual(ancestral, social, subtype + ' must be exactly one of ancestral or social')
  }
  assert.equal(ANCESTRAL_PARENT_LINKS.size + SOCIAL_PARENT_LINKS.size, ALL_SUBTYPES.length)
  assert.equal(PROXIMITY_PARENT_LINKS.size, ALL_SUBTYPES.length, 'proximity is the whole union')
})

// ── One source of truth ──────────────────────────────────────────────

test('7. no other module keeps its own copy of the ancestry rule', () => {
  // The duplication this module exists to end: lineageView and the
  // resolver each used to carry their own literal set. Asserted against
  // the source so a future copy is caught the moment it appears.
  const here = fileURLToPath(new URL('.', import.meta.url))
  const files = [
    here + '../../features/tree-view/lineageView.ts',
    here + '../../features/tree-view/myFamilyView.ts',
    here + 'relationshipResolver.ts',
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.equal(
      /new Set\(\s*\[\s*'biological'\s*,\s*'adopted'/.test(source),
      false,
      file + ' must import the rule, not restate it',
    )
  }
})

test('8. the resolver and the lineage view agree, because they share the rule', () => {
  const people = ['me', 'bio', 'step'].map(person)
  const links = [link('a', 'bio', 'me', 'biological'), link('b', 'step', 'me', 'step')]
  const graph = buildFamilyGraph(people, links, [])
  const ranks = computeRanks(graph.nodes, graph.edges)

  const inLineage = new Set(projectLineage(graph, ranks, 'me').nodes.map((n) => n.id))
  assert.ok(inLineage.has('bio'))
  assert.ok(!inLineage.has('step'))

  // The resolver, measuring along the same rule, names only the
  // biological one a parent by descent.
  const bio = resolveRelationships('bio', 'me', { people, parentLinks: links, unions: [] })
  assert.ok(bio.some((r) => r.kind === 'parent'), 'a biological parent is a parent')

  const stepResult = resolveRelationships('step', 'me', { people, parentLinks: links, unions: [] })
  assert.ok(
    stepResult.every((r) => r.kind !== 'parent'),
    'a step-parent is recognised as a step relationship, never as descent',
  )
  assert.ok(stepResult.length > 0, 'and is still resolved as a real relationship')
})

test('9. lineage traversal follows the shared rule through several generations', () => {
  const people = ['me', 'adopter', 'adoptersMum', 'stepdad', 'stepdadsMum'].map(person)
  const links = [
    link('a', 'adopter', 'me', 'adopted'),
    link('b', 'adoptersMum', 'adopter', 'biological'),
    link('c', 'stepdad', 'me', 'step'),
    link('d', 'stepdadsMum', 'stepdad', 'biological'),
  ]
  const graph = buildFamilyGraph(people, links, [])
  const ids = new Set(
    projectLineage(graph, computeRanks(graph.nodes, graph.edges), 'me').nodes.map((n) => n.id),
  )

  assert.ok(ids.has('adopter'))
  assert.ok(ids.has('adoptersMum'), 'the line continues through an adoptive parent')
  assert.ok(!ids.has('stepdad'))
  assert.ok(!ids.has('stepdadsMum'), 'and never starts down a step-parent’s line')
})

// ── The deliberate difference ────────────────────────────────────────

test('10. My Family still counts a step-parent as close family', () => {
  // Proximity, not ancestry. The two views disagree on purpose, and this
  // records that the disagreement is intended rather than a bug.
  const people = ['me', 'stepdad'].map(person)
  const links = [link('a', 'stepdad', 'me', 'step')]
  const graph = buildFamilyGraph(people, links, [])

  assert.deepEqual(
    displacementsFrom(graph, 'me').get('stepdad'),
    { up: 1, down: 0 },
    'a step-parent who raised you is one generation up, and close family',
  )
})

test('11. the same person is close family to My Family and not a forebear to Lineage', () => {
  const people = ['me', 'stepdad'].map(person)
  const links = [link('a', 'stepdad', 'me', 'step')]
  const graph = buildFamilyGraph(people, links, [])
  const ranks = computeRanks(graph.nodes, graph.edges)

  const closeToMe = displacementsFrom(graph, 'me').has('stepdad')
  const inMyLine = new Set(projectLineage(graph, ranks, 'me').nodes.map((n) => n.id)).has('stepdad')

  assert.equal(closeToMe, true)
  assert.equal(inMyLine, false)
  assert.notEqual(closeToMe, inMyLine, 'two questions, two honest answers')
})

test('12. a foster parent behaves the same way as a step-parent', () => {
  const people = ['me', 'foster'].map(person)
  const links = [link('a', 'foster', 'me', 'foster')]
  const graph = buildFamilyGraph(people, links, [])
  const ranks = computeRanks(graph.nodes, graph.edges)

  assert.deepEqual(displacementsFrom(graph, 'me').get('foster'), { up: 1, down: 0 })
  assert.ok(!new Set(projectLineage(graph, ranks, 'me').nodes.map((n) => n.id)).has('foster'))
})

test('13. an adoptive parent is both close family and a forebear', () => {
  const people = ['me', 'adopter'].map(person)
  const links = [link('a', 'adopter', 'me', 'adopted')]
  const graph = buildFamilyGraph(people, links, [])
  const ranks = computeRanks(graph.nodes, graph.edges)

  assert.deepEqual(displacementsFrom(graph, 'me').get('adopter'), { up: 1, down: 0 })
  assert.ok(new Set(projectLineage(graph, ranks, 'me').nodes.map((n) => n.id)).has('adopter'))
})

test('14. partners are unaffected by any of this', () => {
  const people = ['me', 'spouse'].map(person)
  const unions: Union[] = [{
    id: 'u', familyTreeId: TREE, partnerAId: 'me', partnerBId: 'spouse',
    status: 'married', createdAt: AT, updatedAt: AT,
  }]
  const graph = buildFamilyGraph(people, [], unions)

  assert.deepEqual(
    displacementsFrom(graph, 'me').get('spouse'),
    { up: 0, down: 0 },
    'a spouse stands beside you, which no parent-link rule touches',
  )
})
