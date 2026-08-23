// Pure: no fake-indexeddb, no browser environment.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFamilyGraph } from './graphAdapter'
import { computeRanks } from './rank'
import { projectFamilyGroups } from './groupProjection'
import { projectFamilyTreeView } from './viewProjection'
import { ancestorsOf, projectLineage } from './lineageView'
import type { FamilyGroup, FamilyGroupMember, ParentLink, ParentRelationship, Person, Union } from '../../types'

const TREE = 'tree-1'
const AT = '2026-01-01T00:00:00.000Z'

const person = (id: string): Person => ({
  id, familyTreeId: TREE, firstName: id, lastName: 'X', gender: 'unknown', createdAt: AT, updatedAt: AT,
})
const link = (id: string, parentId: string, childId: string, relationship: ParentRelationship = 'biological'): ParentLink => ({
  id, familyTreeId: TREE, parentId, childId, relationship, createdAt: AT, updatedAt: AT,
})
const union = (id: string, a: string, b: string): Union => ({
  id, familyTreeId: TREE, partnerAId: a, partnerBId: b, status: 'married', createdAt: AT, updatedAt: AT,
})
const group = (id: string): FamilyGroup => ({
  id, familyTreeId: TREE, name: id, establishedPrecision: 'unknown', createdAt: AT, updatedAt: AT,
})
const member = (id: string, familyGroupId: string, personId: string): FamilyGroupMember => ({
  id, familyTreeId: TREE, familyGroupId, personId, createdAt: AT, updatedAt: AT,
})

const build = (people: string[], links: ParentLink[], unions: Union[] = []) => {
  const graph = buildFamilyGraph(people.map(person), links, unions)
  return { graph, ranks: computeRanks(graph.nodes, graph.edges) }
}

const idsIn = (view: { nodes: { id: string }[] }) =>
  new Set(view.nodes.filter((n) => !n.id.startsWith('junction:')).map((n) => n.id))

/**
 * Four ancestral generations on both sides, plus everyone a lineage view
 * must refuse: a sibling, an aunt, a cousin, a child, a step-parent, and
 * somebody with no connection at all.
 *
 *   ggpa ══ ggma
 *      │
 *   gpa ══ gma        mgpa ══ mgma
 *      ├────────┐        │
 *     dad ══ mum │      (mum)
 *      │      aunt ══ auncle
 *      │         │
 *   me, sib    cousin
 *      │
 *     kid
 */
function family() {
  const people = [
    'ggpa', 'ggma', 'gpa', 'gma', 'mgpa', 'mgma',
    'dad', 'mum', 'stepmum', 'aunt', 'auncle', 'cousin',
    'me', 'sib', 'kid', 'stranger',
  ]
  const links = [
    link('l1', 'ggpa', 'gpa'), link('l2', 'ggma', 'gpa'),
    link('l3', 'gpa', 'dad'), link('l4', 'gma', 'dad'),
    link('l5', 'gpa', 'aunt'), link('l6', 'gma', 'aunt'),
    link('l7', 'mgpa', 'mum'), link('l8', 'mgma', 'mum'),
    link('l9', 'dad', 'me'), link('l10', 'mum', 'me'),
    link('l11', 'dad', 'sib'), link('l12', 'mum', 'sib'),
    link('l13', 'aunt', 'cousin'), link('l14', 'auncle', 'cousin'),
    link('l15', 'me', 'kid'),
    // A step-parent must never become an ancestor.
    link('l16', 'stepmum', 'me', 'step'),
  ]
  const unions = [
    union('u1', 'ggpa', 'ggma'), union('u2', 'gpa', 'gma'), union('u3', 'mgpa', 'mgma'),
    union('u4', 'dad', 'mum'), union('u5', 'dad', 'stepmum'), union('u6', 'aunt', 'auncle'),
  ]
  return build(people, links, unions)
}

// ── The line itself ──────────────────────────────────────────────────

test('1. the focal person is present exactly once', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')
  const ids = view.nodes.map((n) => n.id)

  assert.equal(ids.filter((id) => id === 'me').length, 1)
  assert.equal(new Set(ids).size, ids.length, 'nobody is duplicated')
})

test('2. a single recorded parent is included', () => {
  const { graph, ranks } = build(['me', 'onlyParent'], [link('a', 'onlyParent', 'me')])
  assert.deepEqual([...idsIn(projectLineage(graph, ranks, 'me'))].sort(), ['me', 'onlyParent'])
})

test('3. both parents are included', () => {
  const { graph, ranks } = build(
    ['me', 'dad', 'mum'],
    [link('a', 'dad', 'me'), link('b', 'mum', 'me')],
    [union('u', 'dad', 'mum')],
  )
  assert.deepEqual([...idsIn(projectLineage(graph, ranks, 'me'))].sort(), ['dad', 'me', 'mum'])
})

test('4. grandparents on every side are included', () => {
  const { graph, ranks } = family()
  const ids = idsIn(projectLineage(graph, ranks, 'me'))

  for (const forebear of ['dad', 'mum', 'gpa', 'gma', 'mgpa', 'mgma']) {
    assert.ok(ids.has(forebear), forebear + ' is a forebear and must be shown')
  }
})

test('5. every ancestral branch is followed, not just the first', () => {
  const { graph } = family()
  const up = ancestorsOf(graph, 'me')

  assert.equal(up.get('dad'), 1)
  assert.equal(up.get('mum'), 1)
  assert.equal(up.get('gpa'), 2, 'paternal grandparents')
  assert.equal(up.get('mgma'), 2, 'maternal grandparents too')
})

test('6. deep ancestry keeps going', () => {
  const people = ['me', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6']
  const links = [
    link('a', 'g1', 'me'), link('b', 'g2', 'g1'), link('c', 'g3', 'g2'),
    link('d', 'g4', 'g3'), link('e', 'g5', 'g4'), link('f', 'g6', 'g5'),
  ]
  const { graph, ranks } = build(people, links)
  const view = projectLineage(graph, ranks, 'me')

  assert.equal(idsIn(view).size, 7, 'six generations up, all retained')
  assert.equal(ancestorsOf(graph, 'me').get('g6'), 6)
  assert.equal(view.hiddenNodeIds.size, 0, 'nobody was left out')
})

// ── Who is deliberately excluded ─────────────────────────────────────

test('7. siblings are not ancestors', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')

  assert.ok(!idsIn(view).has('sib'))
  assert.ok(view.hiddenNodeIds.has('sib'), 'hidden, not silently dropped')
})

test('8. aunts, uncles and cousins are not ancestors', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')

  for (const excluded of ['aunt', 'auncle', 'cousin']) {
    assert.ok(!idsIn(view).has(excluded), excluded + ' is off the line')
    assert.ok(view.hiddenNodeIds.has(excluded))
  }
})

test('9. descendants are not ancestors', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')

  assert.ok(!idsIn(view).has('kid'))
  assert.ok(view.hiddenNodeIds.has('kid'))
})

test('10. unconnected people are excluded and recorded', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')

  assert.ok(!idsIn(view).has('stranger'))
  assert.ok(view.hiddenNodeIds.has('stranger'))
})

// ── Lineage subtypes ─────────────────────────────────────────────────

test('11. an adoptive parent is an ancestor, and so are their parents', () => {
  const { graph, ranks } = build(
    ['me', 'adopter', 'adoptersMum'],
    [link('a', 'adopter', 'me', 'adopted'), link('b', 'adoptersMum', 'adopter')],
  )
  const ids = idsIn(projectLineage(graph, ranks, 'me'))

  assert.ok(ids.has('adopter'))
  assert.ok(ids.has('adoptersMum'), 'an adopted child’s grandparents really are theirs')
})

test('12. a step-parent is never an ancestor, and their line is not walked', () => {
  const { graph, ranks } = build(
    ['me', 'stepdad', 'stepdadsMum'],
    [link('a', 'stepdad', 'me', 'step'), link('b', 'stepdadsMum', 'stepdad')],
  )
  const view = projectLineage(graph, ranks, 'me')

  assert.ok(!idsIn(view).has('stepdad'))
  assert.ok(
    !idsIn(view).has('stepdadsMum'),
    'walking a step link would invent a great-grandmother the records do not support',
  )
})

test('13. a foster parent is not an ancestor either', () => {
  const { graph, ranks } = build(['me', 'foster'], [link('a', 'foster', 'me', 'foster')])
  assert.ok(!idsIn(projectLineage(graph, ranks, 'me')).has('foster'))
})

test('14. the step-parent in the full fixture is excluded even though they share a union with a parent', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')

  // stepmum partners dad, who IS an ancestor, so she is kept as context —
  // but she must never read as part of the line.
  assert.ok(idsIn(view).has('stepmum'), 'shown, because she explains a couple')
  assert.equal(view.emphasis.get('stepmum'), 'context', 'and only ever as context')
  assert.equal(ancestorsOf(graph, 'me').get('stepmum'), undefined, 'never counted as a forebear')
})

// ── Partners of ancestors ────────────────────────────────────────────

test('15. the focal person’s OWN spouse is not shown — they are not part of the line', () => {
  // Lineage answers "where did I come from". A spouse contributed nothing
  // to that, and belongs to My Family instead.
  const { graph, ranks } = build(
    ['me', 'dad', 'myWife'],
    [link('a', 'dad', 'me')],
    [union('u', 'me', 'myWife')],
  )
  const view = projectLineage(graph, ranks, 'me')

  assert.ok(!idsIn(view).has('myWife'))
  assert.ok(view.hiddenNodeIds.has('myWife'), 'hidden, not silently dropped')
  assert.ok(idsIn(view).has('dad'), 'while the line upward is untouched')
})

test('16. a forebear’s spouse who is not an ancestor is kept as context', () => {
  const { graph, ranks } = build(
    ['me', 'dad', 'dadsWife'],
    [link('a', 'dad', 'me')],
    [union('u', 'dad', 'dadsWife')],
  )
  const view = projectLineage(graph, ranks, 'me')

  assert.ok(idsIn(view).has('dadsWife'))
  assert.equal(view.emphasis.get('dadsWife'), 'context')
})

test('17. a union junction between two forebears survives so its edges do not strand', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')
  const ids = new Set(view.nodes.map((n) => n.id))

  assert.ok(ids.has('junction:u4'), 'dad and mum are partnered, so their junction is drawn')
  for (const edge of view.edges) {
    assert.ok(ids.has(edge.source), edge.id + ' source present')
    assert.ok(ids.has(edge.target), edge.id + ' target present')
  }
})

test('18. a union between two people who are both off the line is not drawn', () => {
  const { graph, ranks } = family()
  const ids = new Set(projectLineage(graph, ranks, 'me').nodes.map((n) => n.id))

  assert.ok(!ids.has('junction:u6'), 'the aunt and her husband are not on the line')
})

// ── Emphasis ─────────────────────────────────────────────────────────

test('19. the line quietens gradually as it recedes', () => {
  const people = ['me', 'p', 'gp', 'ggp', 'gggp', 'ggggp']
  const links = [
    link('a', 'p', 'me'), link('b', 'gp', 'p'), link('c', 'ggp', 'gp'),
    link('d', 'gggp', 'ggp'), link('e', 'ggggp', 'gggp'),
  ]
  const { graph, ranks } = build(people, links)
  const view = projectLineage(graph, ranks, 'me')
  const tier = (id: string) => view.emphasis.get(id) ?? 'primary'

  assert.equal(tier('me'), 'primary')
  assert.equal(tier('p'), 'primary', 'parents anchor the view with the focal person')
  assert.equal(tier('gp'), 'secondary')
  assert.equal(tier('ggp'), 'secondary')
  assert.equal(tier('gggp'), 'context', 'deep history steps back')
  assert.equal(tier('ggggp'), 'context')
})

// ── Ranks, purity, determinism ───────────────────────────────────────

test('20. ranks are carried through by reference and never recomputed', () => {
  const { graph, ranks } = family()
  for (const focus of ['me', 'gpa', 'stranger', null]) {
    assert.equal(projectLineage(graph, ranks, focus).ranks, ranks, 'focus ' + focus)
  }
})

test('21. generations are the canonical ones, unchanged by framing', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')

  for (const node of view.nodes) {
    assert.equal(view.ranks.get(node.id), ranks.get(node.id), node.id + ' kept its generation')
  }
  assert.ok((ranks.get('me') as number) > (ranks.get('dad') as number))
})

test('22. the canonical graph is never mutated', () => {
  const { graph, ranks } = family()
  const before = JSON.stringify({
    nodes: graph.nodes.map((n) => n.id),
    edges: graph.edges.map((e) => e.id),
  })

  for (const focus of ['me', 'dad', 'gpa', 'cousin', 'stranger']) projectLineage(graph, ranks, focus)

  assert.equal(
    JSON.stringify({ nodes: graph.nodes.map((n) => n.id), edges: graph.edges.map((e) => e.id) }),
    before,
  )
})

test('23. every retained edge keeps its canonical identity', () => {
  const { graph, ranks } = family()
  for (const edge of projectLineage(graph, ranks, 'me').edges) {
    const original = graph.edges.find((candidate) => candidate.id === edge.id)
    assert.equal(edge, original, edge.id + ' is the very same edge object')
  }
})

test('24. the projection is deterministic and order-independent', () => {
  const a = family()
  const first = projectLineage(a.graph, a.ranks, 'me')
  const second = projectLineage(a.graph, a.ranks, 'me')
  assert.deepEqual(first.nodes.map((n) => n.id), second.nodes.map((n) => n.id))
  assert.deepEqual([...first.emphasis].sort(), [...second.emphasis].sort())

  // Same family, records loaded in the opposite order.
  const people = ['me', 'dad', 'mum', 'gpa']
  const links = [link('a', 'dad', 'me'), link('b', 'mum', 'me'), link('c', 'gpa', 'dad')]
  const forwards = buildFamilyGraph(people.map(person), links, [])
  const backwards = buildFamilyGraph([...people].reverse().map(person), [...links].reverse(), [])
  assert.deepEqual(
    [...idsIn(projectLineage(forwards, computeRanks(forwards.nodes, forwards.edges), 'me'))].sort(),
    [...idsIn(projectLineage(backwards, computeRanks(backwards.nodes, backwards.edges), 'me'))].sort(),
  )
})

// ── Focal person ─────────────────────────────────────────────────────

test('25. changing the focal person re-projects the line', () => {
  const { graph, ranks } = family()
  const fromMe = idsIn(projectLineage(graph, ranks, 'me'))
  const fromCousin = idsIn(projectLineage(graph, ranks, 'cousin'))

  assert.ok(fromMe.has('mum') && !fromMe.has('auncle'))
  assert.ok(fromCousin.has('auncle'), 'the cousin descends from the uncle')
  assert.ok(!fromCousin.has('mum'), 'and not from my mother')
  assert.ok(fromCousin.has('gpa'), 'the shared grandparents are on both lines')
})

test('26. a focal person at the top of the tree sees only themselves', () => {
  // Nobody is recorded above them, and their own spouse is not part of
  // their line — so the honest answer is a single card plus a count of
  // everyone else, not a fabricated sense of ancestry.
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'ggpa')

  assert.deepEqual([...idsIn(view)], ['ggpa'])
  assert.ok(view.hiddenNodeIds.has('ggma'), 'even the spouse is reported as elsewhere')
  assert.ok(view.hiddenNodeIds.size > 0, 'and the rest of the family with them')
})

test('27. with no focal person the whole family is shown rather than nothing', () => {
  const { graph, ranks } = family()
  for (const focus of [null, undefined, 'nobody-here']) {
    const view = projectLineage(graph, ranks, focus)
    assert.equal(view.nodes, graph.nodes, 'the canonical graph, untouched')
    assert.equal(view.hiddenNodeIds.size, 0)
  }
})

test('28. someone with no recorded parents still gets a view of themselves', () => {
  const { graph, ranks } = build(['alone'], [])
  const view = projectLineage(graph, ranks, 'alone')

  assert.deepEqual(view.nodes.map((n) => n.id), ['alone'])
  assert.deepEqual(view.edges, [])
})

// ── Hidden accounting, groups, and the other views ───────────────────

test('29. every canonical person is either shown or recorded as hidden', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')
  const shown = new Set(view.nodes.map((n) => n.id))

  for (const node of graph.nodes) {
    assert.ok(
      shown.has(node.id) !== view.hiddenNodeIds.has(node.id),
      node.id + ' must be exactly one of shown or hidden',
    )
  }
  assert.equal(shown.size + view.hiddenNodeIds.size, graph.nodes.length)
})

test('30. family groups still project on top of lineage, in every collapse state', () => {
  const { graph, ranks } = family()
  const view = projectLineage(graph, ranks, 'me')
  const groups = [group('g1'), group('g2')]
  const members = [
    member('m1', 'g1', 'gpa'), member('m2', 'g1', 'gma'),
    member('m3', 'g2', 'mgpa'),
  ]

  for (const collapsed of [new Set<string>(), new Set(['g1']), new Set(['g1', 'g2']), new Set(['g2'])]) {
    const projected = projectFamilyGroups(
      { nodes: view.nodes, edges: view.edges },
      groups,
      members,
      collapsed,
      view.ranks,
    )
    assert.ok(projected.nodes.length > 0, 'collapsed=' + [...collapsed] + ' produced a graph')
    assert.equal(
      projected.ranks.get('me'),
      ranks.get('me'),
      'collapsing a group never moves the focal person between generations',
    )
    assert.equal(
      projected.nodes.filter((n) => n.type === 'familyGroup').length,
      collapsed.size,
      'one container per collapsed group',
    )
  }
})

test('31. the other views are unaffected', () => {
  const { graph, ranks } = family()

  const full = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'me' })
  assert.equal(full.nodes, graph.nodes, 'full is still an identity projection')
  assert.equal(full.hiddenNodeIds.size, 0)

  const mine = projectFamilyTreeView(graph, ranks, { view: 'my-family', focalPersonId: 'me' })
  assert.ok(
    new Set(mine.nodes.map((n) => n.id)).has('sib'),
    'My Family still shows siblings, which lineage deliberately does not',
  )
})
