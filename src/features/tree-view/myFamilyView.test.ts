// Pure: no fake-indexeddb, no browser environment.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFamilyGraph } from './graphAdapter'
import { computeRanks } from './rank'
import { projectFamilyGroups } from './groupProjection'
import { projectFamilyTreeView } from './viewProjection'
import { centreOnHousehold } from './focalCentering'
import {
  displacementsFrom,
  emphasisForDisplacement,
  focalHouseholds,
  projectMyFamily,
} from './myFamilyView'
import type { FamilyGroup, FamilyGroupMember, ParentLink, Person, Union } from '../../types'

const TREE = 'tree-1'
const AT = '2026-01-01T00:00:00.000Z'

const person = (id: string): Person => ({
  id, familyTreeId: TREE, firstName: id, lastName: 'B', gender: 'unknown', createdAt: AT, updatedAt: AT,
})
const link = (id: string, parentId: string, childId: string): ParentLink => ({
  id, familyTreeId: TREE, parentId, childId, relationship: 'biological', createdAt: AT, updatedAt: AT,
})
const union = (id: string, partnerAId: string, partnerBId: string): Union => ({
  id, familyTreeId: TREE, partnerAId, partnerBId, status: 'married', createdAt: AT, updatedAt: AT,
})
const group = (id: string): FamilyGroup => ({
  id, familyTreeId: TREE, name: id, establishedPrecision: 'unknown', createdAt: AT, updatedAt: AT,
})
const member = (id: string, familyGroupId: string, personId: string): FamilyGroupMember => ({
  id, familyTreeId: TREE, familyGroupId, personId, createdAt: AT, updatedAt: AT,
})

/**
 * Four generations around `me`, with a spouse, a sibling, an aunt, a
 * cousin, a niece, a child, a grandchild, a great-grandparent, and a
 * wholly unconnected person — one of every tier the hierarchy names.
 *
 *   ggpa
 *    │
 *   gpa ══ gma
 *    ├──────────┬─────────┐
 *   dad ══ mum  aunt ══ auncle
 *    ├─────┐      │
 *   me ══ spouse  cousin
 *    │     sib ── nephew
 *   kid
 *    │
 *   grandkid
 */
function family() {
  const people = [
    'ggpa', 'gpa', 'gma', 'dad', 'mum', 'aunt', 'auncle', 'cousin',
    'me', 'spouse', 'sib', 'nephew', 'kid', 'grandkid', 'stranger',
  ].map(person)

  const parentLinks = [
    link('l1', 'ggpa', 'gpa'),
    link('l2', 'gpa', 'dad'), link('l3', 'gma', 'dad'),
    link('l4', 'gpa', 'aunt'), link('l5', 'gma', 'aunt'),
    link('l6', 'dad', 'me'), link('l7', 'mum', 'me'),
    link('l8', 'dad', 'sib'), link('l9', 'mum', 'sib'),
    link('l10', 'aunt', 'cousin'),
    link('l11', 'sib', 'nephew'),
    link('l12', 'me', 'kid'), link('l13', 'spouse', 'kid'),
    link('l14', 'kid', 'grandkid'),
  ]
  const unions = [
    union('u1', 'gpa', 'gma'),
    union('u2', 'dad', 'mum'),
    union('u3', 'aunt', 'auncle'),
    union('u4', 'me', 'spouse'),
  ]
  const graph = buildFamilyGraph(people, parentLinks, unions)
  return { people, parentLinks, unions, graph, ranks: computeRanks(graph.nodes, graph.edges) }
}

const displacementOf = (id: string) => {
  const { graph } = family()
  const found = displacementsFrom(graph, 'me').get(id)
  return found ? `${found.up},${found.down}` : 'unreachable'
}

// ── Generational displacement ────────────────────────────────────────

test('1. displacement measures generations up and down, with partners beside you', () => {
  assert.equal(displacementOf('me'), '0,0')
  assert.equal(displacementOf('spouse'), '0,0', 'a spouse stands beside you, not above or below')
  assert.equal(displacementOf('dad'), '1,0')
  assert.equal(displacementOf('mum'), '1,0')
  assert.equal(displacementOf('kid'), '0,1')
  assert.equal(displacementOf('sib'), '1,1', 'up to a parent, back down')
  assert.equal(displacementOf('gpa'), '2,0')
  assert.equal(displacementOf('grandkid'), '0,2')
  assert.equal(displacementOf('aunt'), '2,1')
  assert.equal(displacementOf('nephew'), '1,2')
  assert.equal(displacementOf('cousin'), '2,2')
  assert.equal(displacementOf('ggpa'), '3,0')
  assert.equal(displacementOf('stranger'), 'unreachable')
})

test('2. a sibling is (1,1) whether or not the parents have a recorded union', () => {
  // Under hop-counting these two cases differ, which would draw two kinds
  // of sibling differently for a reason no reader could guess.
  const withUnion = family().graph
  assert.deepEqual(displacementsFrom(withUnion, 'me').get('sib'), { up: 1, down: 1 })

  const people = ['p', 'a', 'b'].map(person)
  const noUnion = buildFamilyGraph(people, [link('x1', 'p', 'a'), link('x2', 'p', 'b')], [])
  assert.deepEqual(displacementsFrom(noUnion, 'a').get('b'), { up: 1, down: 1 })
})

test('3. the tiers reproduce the intended hierarchy exactly', () => {
  const tier = (up: number, down: number) => emphasisForDisplacement({ up, down })

  // Primary: you, your partner, parents, children, siblings.
  for (const [up, down] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.equal(tier(up as number, down as number), 'primary', `${up},${down}`)
  }
  // Secondary: grandparents, grandchildren, aunts/uncles, nieces/nephews.
  for (const [up, down] of [[2, 0], [0, 2], [2, 1], [1, 2]]) {
    assert.equal(tier(up as number, down as number), 'secondary', `${up},${down}`)
  }
  // Context: cousins and anything further out.
  for (const [up, down] of [[2, 2], [3, 0], [0, 3], [3, 1]]) {
    assert.equal(tier(up as number, down as number), 'context', `${up},${down}`)
  }
})

test('4. displacement is deterministic regardless of record order', () => {
  const { people, parentLinks, unions } = family()
  const forwards = buildFamilyGraph(people, parentLinks, unions)
  const backwards = buildFamilyGraph([...people].reverse(), [...parentLinks].reverse(), [...unions].reverse())

  const a = displacementsFrom(forwards, 'me')
  const b = displacementsFrom(backwards, 'me')
  assert.equal(a.size, b.size)
  for (const [id, value] of a) assert.deepEqual(b.get(id), value, id)
})

// ── Projection membership ────────────────────────────────────────────

test('5. the focal person, their parents, partner, siblings and children are all present', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')
  const ids = new Set(view.nodes.map((node) => node.id))

  for (const id of ['me', 'dad', 'mum', 'spouse', 'sib', 'kid']) {
    assert.ok(ids.has(id), `${id} must be in My Family`)
  }
})

test('6. the focal person appears exactly once, and nobody is duplicated', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')

  const ids = view.nodes.map((node) => node.id)
  assert.equal(ids.filter((id) => id === 'me').length, 1)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate nodes')
  const edgeIds = view.edges.map((edge) => edge.id)
  assert.equal(new Set(edgeIds).size, edgeIds.length, 'no duplicate edges')
})

test('7. distant relatives stay in frame as context rather than disappearing', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')
  const ids = new Set(view.nodes.map((node) => node.id))

  assert.ok(ids.has('cousin'), 'a cousin is still discoverable')
  assert.ok(ids.has('ggpa'), 'a great-grandparent is where you came from')
  assert.equal(view.emphasis.get('cousin'), 'context')
  assert.equal(view.emphasis.get('ggpa'), 'context')
})

test('8. someone with no connection is recorded as hidden, never silently dropped', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')

  assert.ok(!view.nodes.some((node) => node.id === 'stranger'))
  assert.ok(view.hiddenNodeIds.has('stranger'), 'the interface can still say more people exist')
})

test('9. beyond the range, people are hidden rather than shown as unrelated', () => {
  // A fifth generation up is out of range; it must land in hiddenNodeIds
  // so the view can indicate the family continues past the frame.
  const people = ['g4', 'g3', 'g2', 'g1', 'me'].map(person)
  const links = [
    link('a', 'g4', 'g3'), link('b', 'g3', 'g2'), link('c', 'g2', 'g1'), link('d', 'g1', 'me'),
  ]
  const graph = buildFamilyGraph(people, links, [])
  const view = projectMyFamily(graph, computeRanks(graph.nodes, graph.edges), 'me')

  const ids = new Set(view.nodes.map((node) => node.id))
  assert.ok(ids.has('g3'), 'three generations up is in range')
  assert.ok(!ids.has('g4'), 'four is beyond it')
  assert.ok(view.hiddenNodeIds.has('g4'), 'and is reported, so the family does not appear to end')
})

test('10. no edge is left pointing at somebody who is not drawn', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')
  const ids = new Set(view.nodes.map((node) => node.id))

  for (const edge of view.edges) {
    assert.ok(ids.has(edge.source), `${edge.id} source is present`)
    assert.ok(ids.has(edge.target), `${edge.id} target is present`)
  }
})

test('11. every retained edge keeps its canonical id and meaning', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')

  for (const edge of view.edges) {
    const original = graph.edges.find((candidate) => candidate.id === edge.id)
    assert.ok(original, `${edge.id} exists in the canonical graph`)
    assert.equal(edge, original, 'the very same edge object — never rebuilt')
  }
})

// ── Focal person behaviour ───────────────────────────────────────────

test('12. changing the focal person changes the structure around them', () => {
  const { graph, ranks } = family()
  const fromMe = projectMyFamily(graph, ranks, 'me')
  const fromCousin = projectMyFamily(graph, ranks, 'cousin')

  assert.equal(fromMe.emphasis.get('cousin'), 'context')
  assert.equal(fromCousin.emphasis.get('cousin'), undefined, 'the cousin is now primary')
  assert.equal(fromCousin.emphasis.get('me'), 'context', 'and I am the distant one')

  // Different frames, from the same unchanged genealogy.
  assert.notDeepEqual(
    fromMe.nodes.map((node) => node.id),
    fromCousin.nodes.map((node) => node.id),
  )
})

test('13. with no focal person the whole family is shown rather than nothing', () => {
  const { graph, ranks } = family()
  for (const focus of [null, undefined, 'nobody-here']) {
    const view = projectMyFamily(graph, ranks, focus)
    assert.equal(view.nodes, graph.nodes, 'the canonical graph, untouched')
    assert.equal(view.hiddenNodeIds.size, 0)
    assert.equal(view.familyUnits.size, 0)
  }
})

test('14. a person with no relationships still gets a view of themselves', () => {
  const graph = buildFamilyGraph([person('alone')], [], [])
  const view = projectMyFamily(graph, computeRanks(graph.nodes, graph.edges), 'alone')

  assert.deepEqual(view.nodes.map((node) => node.id), ['alone'])
  assert.deepEqual(view.edges, [])
  assert.equal(view.hiddenNodeIds.size, 0)
})

// ── Ranks and the canonical graph ────────────────────────────────────

test('15. ranks are carried through by reference and never recomputed', () => {
  const { graph, ranks } = family()
  for (const focus of ['me', 'cousin', 'stranger', null]) {
    assert.equal(projectMyFamily(graph, ranks, focus).ranks, ranks, `focus ${focus}`)
  }
})

test('16. generations are the canonical ones, unchanged by framing', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')

  for (const node of view.nodes) {
    assert.equal(view.ranks.get(node.id), ranks.get(node.id), `${node.id} kept its generation`)
  }
  assert.ok((ranks.get('me') as number) > (ranks.get('dad') as number), 'a child is below its parent')
})

test('17. the canonical graph is never mutated, whoever is focused', () => {
  const { graph, ranks } = family()
  const before = JSON.stringify({
    nodes: graph.nodes.map((node) => node.id),
    edges: graph.edges.map((edge) => edge.id),
  })

  for (const focus of ['me', 'cousin', 'kid', 'ggpa', 'stranger']) {
    projectMyFamily(graph, ranks, focus)
  }

  assert.equal(
    JSON.stringify({
      nodes: graph.nodes.map((node) => node.id),
      edges: graph.edges.map((edge) => edge.id),
    }),
    before,
  )
})

test('18. the projection is deterministic', () => {
  const { graph, ranks } = family()
  const first = projectMyFamily(graph, ranks, 'me')
  const second = projectMyFamily(graph, ranks, 'me')

  assert.deepEqual(first.nodes.map((n) => n.id), second.nodes.map((n) => n.id))
  assert.deepEqual([...first.emphasis].sort(), [...second.emphasis].sort())
  assert.deepEqual([...first.familyUnits].sort(), [...second.familyUnits].sort())
})

// ── Family units ─────────────────────────────────────────────────────

test('19. the focal person belongs to the family they came from and the one they made', () => {
  const { graph } = family()
  const units = focalHouseholds(graph, 'me')

  assert.ok(units.has('me'))
  // Born into: parents and siblings. Made: partner and children.
  for (const id of ['dad', 'mum', 'sib', 'spouse', 'kid']) {
    assert.ok(units.has(id), `${id} shares a household with me`)
  }
  // Not in either household.
  for (const id of ['gpa', 'aunt', 'cousin', 'grandkid', 'stranger']) {
    assert.ok(!units.has(id), `${id} is not in my household`)
  }
})

test('20. someone with children but no union and no recorded parents still heads a household', () => {
  // The root of a tree is the common case: no parents recorded above them
  // and no marriage recorded beside them, yet they plainly head a family.
  // Anchoring only on unions and parents left them with no rail at all.
  const graph = buildFamilyGraph(
    ['root', 'childA', 'childB'].map(person),
    [link('l1', 'root', 'childA'), link('l2', 'root', 'childB')],
    [],
  )
  const units = focalHouseholds(graph, 'root')

  assert.ok(units.has('root'), 'the head of the household is in it')
  assert.ok(units.has('childA'))
  assert.ok(units.has('childB'))
  assert.equal(new Set(units.values()).size, 1, 'one household, not one per child')
})

test('21. a partnered person gains no extra household from the same children', () => {
  // Children of a couple route through the union junction, so the junction
  // already anchors them — the person must not anchor a second, duplicate
  // household around the same family.
  const { graph } = family()
  const units = focalHouseholds(graph, 'me')

  assert.equal(new Set(units.values()).size, 2, 'born into one, made one')
  assert.equal(units.get('kid'), units.get('spouse'), 'my child and my partner share my household')
})

test('22. a person is only ever in one unit, and unit ids are stable', () => {
  const { graph } = family()
  const units = focalHouseholds(graph, 'me')

  assert.equal(new Set(units.keys()).size, units.size, 'no person appears twice')
  assert.ok(new Set(units.values()).size <= 2, 'at most the two households I belong to')
  assert.deepEqual([...units], [...focalHouseholds(graph, 'me')], 'and it is deterministic')
})

test('23. no junction is ever a member of a household', () => {
  const { graph } = family()
  for (const id of focalHouseholds(graph, 'me').keys()) {
    assert.ok(!id.startsWith('junction:'), 'a junction is a drawing device, not a person')
  }
})

test('24. multiple unions each contribute a household', () => {
  const people = ['me', 'first', 'second', 'childA', 'childB'].map(person)
  const graph = buildFamilyGraph(
    people,
    [link('a', 'me', 'childA'), link('b', 'first', 'childA'), link('c', 'me', 'childB'), link('d', 'second', 'childB')],
    [union('u1', 'me', 'first'), union('u2', 'me', 'second')],
  )
  const units = focalHouseholds(graph, 'me')

  for (const id of ['first', 'second', 'childA', 'childB']) {
    assert.ok(units.has(id), `${id} is in one of my households`)
  }
  assert.equal(new Set(units.values()).size, 2, 'a remarriage is two households, not one')
})

// ── Composition with the rest of the pipeline ────────────────────────

test('25. family groups still project on top of My Family', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')
  const groups = [group('g1'), group('g2')]
  const members = [
    member('m1', 'g1', 'dad'), member('m2', 'g1', 'mum'),
    member('m3', 'g2', 'kid'),
  ]

  for (const collapsed of [
    new Set<string>(),
    new Set(['g1']),
    new Set(['g1', 'g2']),
    new Set(['g2']),
  ]) {
    const projected = projectFamilyGroups(
      { nodes: view.nodes, edges: view.edges },
      groups,
      members,
      collapsed,
      view.ranks,
    )
    assert.ok(projected.nodes.length > 0, `collapsed=${[...collapsed]} produced a graph`)
    assert.equal(
      projected.ranks.get('me'),
      ranks.get('me'),
      'collapsing a group never moves the focal person between generations',
    )
    const groupNodes = projected.nodes.filter((node) => node.type === 'familyGroup')
    assert.equal(groupNodes.length, collapsed.size, 'one container per collapsed group')
  }
})

test('26. a collapsed group stays a collapsed group, not an automatic family unit', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')

  // The derived households and the user's Family Groups are separate
  // concepts and must not be conflated.
  for (const unitId of view.familyUnits.values()) {
    assert.ok(unitId.startsWith('unit:'), 'household ids are namespaced away from group ids')
    assert.ok(!unitId.startsWith('group:'))
  }
})

test('27. the full view is unaffected by any of this', () => {
  const { graph, ranks } = family()
  const full = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'me' })

  assert.equal(full.nodes, graph.nodes, 'still an identity projection')
  assert.equal(full.edges, graph.edges)
  assert.equal(full.ranks, ranks)
  assert.equal(full.hiddenNodeIds.size, 0, 'the full view hides nobody')
  assert.equal(full.familyUnits.size, 0, 'and draws no household rails')
})

// ── Centring ─────────────────────────────────────────────────────────

test('28. centring moves the household to the origin without rearranging anything', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')
  const laidOut = view.nodes.map((node, index) => ({
    ...node,
    position: { x: 100 + index * 50, y: index * 10 },
  }))

  const centred = centreOnHousehold(laidOut, 'me', view.familyUnits)

  // Every gap is preserved exactly: this is a translation, not a layout.
  for (let index = 1; index < centred.length; index += 1) {
    const before = (laidOut[index] as { position: { x: number } }).position.x - (laidOut[index - 1] as { position: { x: number } }).position.x
    const after = (centred[index] as { position: { x: number } }).position.x - (centred[index - 1] as { position: { x: number } }).position.x
    assert.equal(after, before, 'horizontal spacing is untouched')
  }
  for (let index = 0; index < centred.length; index += 1) {
    assert.equal(
      (centred[index] as { position: { y: number } }).position.y,
      (laidOut[index] as { position: { y: number } }).position.y,
      'generation is untouched',
    )
  }
})

test('29. centring is a no-op without a focal person', () => {
  const { graph, ranks } = family()
  const view = projectMyFamily(graph, ranks, 'me')
  const laidOut = view.nodes.map((node) => ({ ...node, position: { x: 40, y: 0 } }))

  assert.equal(centreOnHousehold(laidOut, null, view.familyUnits), laidOut)
  assert.equal(centreOnHousehold([], 'me', view.familyUnits).length, 0)
})
