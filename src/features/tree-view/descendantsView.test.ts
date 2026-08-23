import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { buildFamilyGraph } from './graphAdapter'
import { computeRanks } from './rank'
import { projectFamilyGroups } from './groupProjection'
import { projectFamilyTreeView } from './viewProjection'
import { descendantsOf, projectDescendants } from './descendantsView'
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

/** People only — junctions are a drawing device, never an answer. */
const idsIn = (view: { nodes: { id: string }[] }) =>
  new Set(view.nodes.filter((n) => !n.id.startsWith('junction:')).map((n) => n.id))

/**
 * A family with something of everything the view has to get right: two
 * generations above the focal person, a sibling branch, a real cousin, a
 * step-child, a foster child, an adopted child, married-in partners at
 * two levels, four generations of descent, and somebody unrelated.
 *
 *                  ggran
 *                 /     \
 *              gran+grandad        aunt
 *              /        \            \
 *           me+spouse   sib         cousin
 *           /  |  \       \
 *      kidA kidB kidC(adopted)  sibKid
 *       |
 *  kidA+partnerA
 *      /     \
 *  gkid1   gkid2
 *    |
 * gkid1+partnerG
 *    |
 *  ggkid  ->  gggkid
 *
 *  stepKid  spouse's child, step to me
 *  fosterKid  fostered by me
 *  stranger  no links at all
 */
const family = () =>
  build(
    [
      'ggran', 'gran', 'grandad', 'aunt', 'cousin',
      'me', 'spouse', 'sib', 'sibKid',
      'kidA', 'kidB', 'kidC', 'partnerA',
      'gkid1', 'gkid2', 'partnerG', 'ggkid', 'gggkid',
      'stepKid', 'fosterKid', 'stranger',
    ],
    [
      link('l1', 'ggran', 'gran'),
      link('l2', 'ggran', 'aunt'),
      link('l3', 'aunt', 'cousin'),
      link('l4', 'gran', 'me'),
      link('l5', 'grandad', 'me'),
      link('l6', 'gran', 'sib'),
      link('l7', 'grandad', 'sib'),
      link('l8', 'sib', 'sibKid'),

      link('l9', 'me', 'kidA'),
      link('l10', 'spouse', 'kidA'),
      link('l11', 'me', 'kidB'),
      link('l12', 'spouse', 'kidB'),
      link('l13', 'me', 'kidC', 'adopted'),
      link('l14', 'spouse', 'kidC', 'adopted'),

      link('l15', 'kidA', 'gkid1'),
      link('l16', 'partnerA', 'gkid1'),
      link('l17', 'kidA', 'gkid2'),
      link('l18', 'partnerA', 'gkid2'),
      link('l19', 'gkid1', 'ggkid'),
      link('l20', 'partnerG', 'ggkid'),
      link('l21', 'ggkid', 'gggkid'),

      // Family, but not descent: her child, and a child I fostered.
      link('l22', 'spouse', 'stepKid'),
      link('l23', 'me', 'stepKid', 'step'),
      link('l24', 'me', 'fosterKid', 'foster'),
    ],
    [union('u1', 'me', 'spouse'), union('u2', 'kidA', 'partnerA'), union('u3', 'gkid1', 'partnerG')],
  )

// ── The shape of descent ─────────────────────────────────────────────

test('1. a person with no descendants still gets a real view, not an empty one', () => {
  const { graph, ranks } = build(['me', 'spouse'], [], [union('u1', 'me', 'spouse')])
  const view = projectDescendants(graph, ranks, 'me')

  assert.ok(idsIn(view).has('me'), 'the focal person is always present')
  assert.deepEqual(
    [...idsIn(view)].sort(),
    ['me', 'spouse'],
    'their partner stands beside them rather than leaving them alone',
  )
  assert.equal(view.emphasis.get('spouse'), 'context')
})

test('2. one child', () => {
  const { graph, ranks } = build(['me', 'kid'], [link('l1', 'me', 'kid')])
  const view = projectDescendants(graph, ranks, 'me')

  assert.deepEqual([...idsIn(view)].sort(), ['kid', 'me'])
  assert.equal(view.edges.length, 1, 'and the link between them survives')
})

test('3. several children all appear, none preferred over another', () => {
  const { graph, ranks } = build(
    ['me', 'a', 'b', 'c'],
    [link('l1', 'me', 'a'), link('l2', 'me', 'b'), link('l3', 'me', 'c')],
  )
  const view = projectDescendants(graph, ranks, 'me')

  assert.deepEqual([...idsIn(view)].sort(), ['a', 'b', 'c', 'me'])
  for (const id of ['a', 'b', 'c']) {
    assert.equal(view.emphasis.get(id), undefined, id + ' reads primary, like every other child')
  }
})

test('4. grandchildren are reached through their parent', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')
  assert.ok(idsIn(view).has('gkid1'))
  assert.ok(idsIn(view).has('gkid2'))
})

test('5. a deep chain is followed to its end, and generations are counted correctly', () => {
  const { graph } = family()
  const down = descendantsOf(graph, 'me')

  assert.equal(down.get('me'), 0)
  assert.equal(down.get('kidA'), 1)
  assert.equal(down.get('gkid1'), 2)
  assert.equal(down.get('ggkid'), 3)
  assert.equal(down.get('gggkid'), 4, 'four generations down is still descent')
})

test('6. biological children are descendants', () => {
  const { graph, ranks } = build(['me', 'kid'], [link('l1', 'me', 'kid', 'biological')])
  assert.ok(idsIn(projectDescendants(graph, ranks, 'me')).has('kid'))
})

test('7. an adopted child is a descendant, and so is their line', () => {
  const { graph, ranks } = build(
    ['me', 'kid', 'gkid'],
    [link('l1', 'me', 'kid', 'adopted'), link('l2', 'kid', 'gkid')],
  )
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))

  assert.ok(ids.has('kid'))
  assert.ok(ids.has('gkid'), 'an adopted child’s own children descend from you too')
})

test('8. a step-child is not descent, and neither is their line', () => {
  const { graph, ranks } = build(
    ['me', 'stepKid', 'stepGkid'],
    [link('l1', 'me', 'stepKid', 'step'), link('l2', 'stepKid', 'stepGkid')],
  )
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))

  assert.ok(!ids.has('stepKid'), 'family, but not somebody who came from you')
  assert.ok(!ids.has('stepGkid'), 'and the walk never starts down their line')
})

test('9. a foster child is not descent either', () => {
  const { graph, ranks } = build(
    ['me', 'fosterKid'],
    [link('l1', 'me', 'fosterKid', 'foster')],
  )
  assert.ok(!idsIn(projectDescendants(graph, ranks, 'me')).has('fosterKid'))
})

test('10. a step-child stays out even when drawn from the same junction as their half-siblings', () => {
  // The case the fixture exists for: stepKid's edges are routed through
  // the same union junction as kidA's, so the junction being kept must
  // not carry them in with it.
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')

  assert.ok(!idsIn(view).has('stepKid'))
  assert.ok(!idsIn(view).has('fosterKid'))
  assert.ok(
    !view.edges.some((e) => e.data?.kind === 'parentChild' && e.data.childId === 'stepKid'),
    'and no edge is left pointing at them',
  )
})

// ── Partners are context, never a route ──────────────────────────────

test('11. a descendant’s partner appears, as context', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')

  assert.ok(idsIn(view).has('partnerA'), 'so the couple reads as a couple')
  assert.equal(view.emphasis.get('partnerA'), 'context', 'never outranking a descendant')
  assert.equal(view.emphasis.get('partnerG'), 'context')
})

test('12. the focal person’s own partner is kept, unlike in Lineage', () => {
  // Structural, not a preference: the children's edges are drawn FROM the
  // union junction, so dropping it would strand every one of them.
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')

  assert.ok(idsIn(view).has('spouse'))
  assert.equal(view.emphasis.get('spouse'), 'context')

  for (const kid of ['kidA', 'kidB', 'kidC']) {
    assert.ok(
      view.edges.some((e) => e.data?.kind === 'parentChild' && e.data.childId === kid),
      kid + ' is still attached to the family rather than floating',
    )
  }
})

test('13. a partner brings none of their own family with them', () => {
  const { graph, ranks } = build(
    ['me', 'kid', 'inLaw', 'inLawParent', 'inLawOther'],
    [
      link('l1', 'me', 'kid'),
      link('l2', 'inLawParent', 'inLaw'),
      link('l3', 'inLaw', 'inLawOther'),
    ],
    [union('u1', 'kid', 'inLaw')],
  )
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))

  assert.ok(ids.has('inLaw'), 'the partner is context')
  assert.ok(!ids.has('inLawParent'), 'their parents are not')
  assert.ok(!ids.has('inLawOther'), 'and their child by somebody else is not descended from me')
})

// ── Everyone this view is not about ──────────────────────────────────

test('14. siblings and their children are excluded', () => {
  const { graph, ranks } = family()
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))
  assert.ok(!ids.has('sib'))
  assert.ok(!ids.has('sibKid'), 'a niece is family, but she did not come from me')
})

test('15. ancestors are excluded', () => {
  const { graph, ranks } = family()
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))
  for (const id of ['gran', 'grandad', 'ggran']) assert.ok(!ids.has(id), id + ' is excluded')
})

test('16. cousins and their branch are excluded', () => {
  const { graph, ranks } = family()
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))
  assert.ok(!ids.has('aunt'))
  assert.ok(!ids.has('cousin'))
})

test('17. disconnected people are excluded', () => {
  const { graph, ranks } = family()
  const ids = idsIn(projectDescendants(graph, ranks, 'me'))
  assert.ok(!ids.has('stranger'))
})

test('18. every canonical person is either shown or recorded as hidden', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')
  const shown = new Set(view.nodes.map((n) => n.id))

  for (const node of graph.nodes) {
    assert.ok(
      shown.has(node.id) !== view.hiddenNodeIds.has(node.id),
      node.id + ' must be exactly one of shown or hidden',
    )
  }
  assert.equal(shown.size + view.hiddenNodeIds.size, graph.nodes.length, 'nobody is lost silently')
  assert.ok(view.hiddenNodeIds.has('sib'))
  assert.ok(view.hiddenNodeIds.has('gran'))
  assert.ok(view.hiddenNodeIds.has('stranger'))
})

// ── Emphasis ─────────────────────────────────────────────────────────

test('19. emphasis steps back one generation at a time', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')

  assert.equal(view.emphasis.get('me'), undefined, 'the focal person is primary')
  assert.equal(view.emphasis.get('kidA'), undefined, 'children are primary')
  assert.equal(view.emphasis.get('kidC'), undefined, 'including the adopted one')
  assert.equal(view.emphasis.get('gkid1'), 'secondary', 'grandchildren are secondary')
  assert.equal(view.emphasis.get('gkid2'), 'secondary')
  assert.equal(view.emphasis.get('ggkid'), 'context', 'and beyond that, context')
  assert.equal(view.emphasis.get('gggkid'), 'context')
})

test('20. emphasis is sparse, and only ever names people the view shows', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')
  const shown = new Set(view.nodes.map((n) => n.id))

  for (const id of view.emphasis.keys()) {
    assert.ok(shown.has(id), id + ' is emphasised but not shown')
    assert.notEqual(view.emphasis.get(id), 'primary', 'primary is the absent default')
  }
})

// ── Focus ────────────────────────────────────────────────────────────

test('21. changing the focal person completely re-projects the view', () => {
  const { graph, ranks } = family()
  const mine = idsIn(projectDescendants(graph, ranks, 'me'))
  const theirs = idsIn(projectDescendants(graph, ranks, 'kidA'))

  assert.ok(mine.has('kidB'))
  assert.ok(!theirs.has('kidB'), 'a sibling of the new focal person is no longer in frame')
  assert.ok(theirs.has('gkid1'), 'and their own children now read as children')

  const kidAView = projectDescendants(graph, ranks, 'kidA')
  assert.equal(kidAView.emphasis.get('gkid1'), undefined, 'primary from where kidA stands')
  assert.equal(kidAView.emphasis.get('ggkid'), 'secondary', 'one tier nearer than before')
})

test('22. focusing an ancestor of nobody in the tree still works', () => {
  const { graph, ranks } = family()
  const ids = idsIn(projectDescendants(graph, ranks, 'gggkid'))
  assert.deepEqual([...ids], ['gggkid'])
})

test('23. with no focal person, or one who is not in the graph, the whole graph comes back', () => {
  const { graph, ranks } = family()

  for (const focal of [null, undefined, 'nobody']) {
    const view = projectDescendants(graph, ranks, focal)
    assert.equal(view.nodes, graph.nodes, 'by reference, so nothing downstream re-lays-out')
    assert.equal(view.edges, graph.edges)
    assert.equal(view.hiddenNodeIds.size, 0, 'and nothing is claimed to be hidden')
  }
})

// ── Ranks, groups, and the rest of the pipeline ──────────────────────

test('24. ranks are carried through by reference and never recomputed', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')

  assert.equal(view.ranks, ranks, 'the same map, not an equal one')
  for (const node of view.nodes) {
    assert.equal(view.ranks.get(node.id), ranks.get(node.id), node.id + ' kept its generation')
  }
})

test('25. generation spacing is preserved: descent is monotonic in rank', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')
  const down = descendantsOf(graph, 'me')
  const meRank = ranks.get('me') as number

  for (const [id, generations] of down) {
    assert.equal(
      ranks.get(id),
      meRank + generations,
      id + ' sits exactly ' + generations + ' generations below the focal person',
    )
  }
  assert.ok(view.nodes.length > 0)
})

test('26. family groups still project on top of descendants, in every collapse state', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')
  const groups = [group('g1'), group('g2')]
  const members = [
    member('m1', 'g1', 'kidA'), member('m2', 'g1', 'partnerA'),
    member('m3', 'g2', 'gkid1'), member('m4', 'g2', 'gkid2'),
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
      projected.ranks.get('gggkid'),
      ranks.get('gggkid'),
      'nor anybody else',
    )
  }
})

test('27. the view dispatches through projectFamilyTreeView', () => {
  const { graph, ranks } = family()
  const dispatched = projectFamilyTreeView(graph, ranks, { view: 'descendants', focalPersonId: 'me' })
  const direct = projectDescendants(graph, ranks, 'me')

  assert.equal(dispatched.view, 'descendants')
  assert.deepEqual(dispatched.nodes.map((n) => n.id), direct.nodes.map((n) => n.id))
  assert.equal(dispatched.ranks, ranks)
})

// ── Structural guarantees ────────────────────────────────────────────

test('28. no duplicate nodes', () => {
  const { graph, ranks } = family()
  const ids = projectDescendants(graph, ranks, 'me').nodes.map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('29. no duplicate edges, and every edge has both ends present', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')
  const ids = view.edges.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'no edge appears twice')

  const shown = new Set(view.nodes.map((n) => n.id))
  for (const edge of view.edges) {
    assert.ok(shown.has(edge.source), edge.id + ' source is present')
    assert.ok(shown.has(edge.target), edge.id + ' target is present')
  }
})

test('30. ordering is deterministic, and follows the canonical graph', () => {
  const { graph, ranks } = family()
  const once = projectDescendants(graph, ranks, 'me')
  const twice = projectDescendants(graph, ranks, 'me')

  assert.deepEqual(once.nodes.map((n) => n.id), twice.nodes.map((n) => n.id))
  assert.deepEqual(once.edges.map((e) => e.id), twice.edges.map((e) => e.id))
  assert.deepEqual([...once.hiddenNodeIds], [...twice.hiddenNodeIds])
  assert.deepEqual([...once.emphasis], [...twice.emphasis])

  // Filtered from the canonical arrays, so canonical order is preserved
  // and the projection cannot reorder anybody.
  const canonical = graph.nodes.map((n) => n.id).filter((id) => once.nodes.some((n) => n.id === id))
  assert.deepEqual(once.nodes.map((n) => n.id), canonical)
})

test('31. nodes and edges are the canonical objects, never rebuilt', () => {
  const { graph, ranks } = family()
  const view = projectDescendants(graph, ranks, 'me')

  for (const node of view.nodes) {
    assert.ok(graph.nodes.includes(node), node.id + ' is the canonical node object')
  }
  for (const edge of view.edges) {
    assert.ok(graph.edges.includes(edge), edge.id + ' is the canonical edge object')
  }
})

test('32. no household rail is emitted, so Family Groups own this canvas alone', () => {
  const { graph, ranks } = family()
  assert.equal(projectDescendants(graph, ranks, 'me').familyUnits.size, 0)
})

test('33. the projection is pure: no runtime imports beyond the shared rule', () => {
  const source = readFileSync(fileURLToPath(new URL('./descendantsView.ts', import.meta.url)), 'utf8')

  const runtimeImports = [...source.matchAll(/^import (?!type )(.+?) from '(.+?)'/gm)].map((m) => m[2])
  assert.deepEqual(
    runtimeImports,
    ['../../lib/relationships/relationshipSemantics'],
    'the only value imported is the shared relationship semantics',
  )

  // Comments stripped first — the docstring says the words "no React, no
  // Dexie", and a check that cannot tell prose from code would either fail
  // on that or have to be weakened until it proved nothing.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  for (const forbidden of ['react', 'dexie', 'localStorage', 'fetch(', 'Date.now', 'new Date', 'window.', 'document.', 'crypto.']) {
    assert.equal(
      code.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      'must not reference ' + forbidden,
    )
  }
})

test('34. the ancestry rule is imported, never restated', () => {
  const source = readFileSync(fileURLToPath(new URL('./descendantsView.ts', import.meta.url)), 'utf8')
  assert.equal(
    /new Set\(\s*\[\s*'biological'/.test(source),
    false,
    'the biological/adoptive list belongs to relationshipSemantics.ts alone',
  )
})
