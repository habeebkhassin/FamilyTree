// Pure, like the reconciler and the policy engine: no fake-indexeddb and
// no browser environment. If this file ever needs one, something that
// belongs beneath the view layer has leaked into it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFamilyGraph } from './graphAdapter'
import { computeRanks } from './rank'
import { projectFamilyGroups } from './groupProjection'
import { emphasisFor, projectFamilyTreeView } from './viewProjection'
import { edgeEmphasis, styleEdgesForView } from './viewEmphasis'
import type { FamilyEdge } from './types'
import type { FamilyGroup, FamilyGroupMember, ParentLink, Person, Union } from '../../types'

const TREE = 'tree-1'
const AT = '2026-01-01T00:00:00.000Z'

function person(id: string, firstName = id): Person {
  return {
    id,
    familyTreeId: TREE,
    firstName,
    lastName: 'Bello',
    gender: 'unknown',
    createdAt: AT,
    updatedAt: AT,
  }
}

function parentLink(id: string, parentId: string, childId: string): ParentLink {
  return {
    id,
    familyTreeId: TREE,
    parentId,
    childId,
    relationship: 'biological',
    createdAt: AT,
    updatedAt: AT,
  }
}

function union(id: string, partnerAId: string, partnerBId: string): Union {
  return {
    id,
    familyTreeId: TREE,
    partnerAId,
    partnerBId,
    status: 'married',
    createdAt: AT,
    updatedAt: AT,
  }
}

function familyGroup(id: string, name = id): FamilyGroup {
  return {
    id,
    familyTreeId: TREE,
    name,
    establishedPrecision: 'unknown',
    createdAt: AT,
    updatedAt: AT,
  }
}

function groupMember(id: string, familyGroupId: string, personId: string): FamilyGroupMember {
  return { id, familyTreeId: TREE, familyGroupId, personId, createdAt: AT, updatedAt: AT }
}

/**
 * Three generations with a couple in the middle, plus an unrelated
 * outsider — enough shape to catch reordering, dropped junctions, and the
 * rank bug this seam exists to keep out.
 */
function sampleGraph() {
  const people = [
    person('grand'),
    person('parent'),
    person('parentPartner'),
    person('child'),
    person('outsider'),
  ]
  const parentLinks = [
    parentLink('link-1', 'grand', 'parent'),
    parentLink('link-2', 'parent', 'child'),
    parentLink('link-3', 'parentPartner', 'child'),
  ]
  const unions = [union('union-1', 'parent', 'parentPartner')]
  return { people, parentLinks, unions, graph: buildFamilyGraph(people, parentLinks, unions) }
}

const FULL = { view: 'full' } as const

// ── Membership ───────────────────────────────────────────────────────

test('1. the full view contains every live person', () => {
  const { people, graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const view = projectFamilyTreeView(graph, ranks, FULL)
  const personIds = view.nodes.filter((node) => node.type === 'person').map((node) => node.id).sort()

  assert.deepEqual(personIds, people.map((entry) => entry.id).sort())
})

test('2. the full view contains every union junction', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const view = projectFamilyTreeView(graph, ranks, FULL)
  const junctions = view.nodes.filter((node) => node.type === 'unionJunction')

  assert.equal(junctions.length, 1)
  assert.equal(junctions[0]?.id, 'junction:union-1')
})

test('3. node ids and their order survive untouched', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const view = projectFamilyTreeView(graph, ranks, FULL)
  assert.deepEqual(view.nodes.map((node) => node.id), graph.nodes.map((node) => node.id))
  assert.equal(view.nodes, graph.nodes, 'the very same array — nothing was rebuilt or reordered')
})

test('4. edge ids and their order survive untouched', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const view = projectFamilyTreeView(graph, ranks, FULL)
  assert.deepEqual(view.edges.map((edge) => edge.id), graph.edges.map((edge) => edge.id))
  assert.equal(view.edges, graph.edges)
})

test('5. edge semantics are preserved exactly, not re-derived', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const view = projectFamilyTreeView(graph, ranks, FULL)

  const parentChild = view.edges.filter((edge) => edge.data?.kind === 'parentChild')
  const unionSegments = view.edges.filter((edge) => edge.data?.kind === 'unionSegment')
  assert.equal(parentChild.length, 3, 'one edge per ParentLink, still')
  assert.equal(unionSegments.length, 2, 'a union is still two segments meeting at its junction')

  // The child's parents share a union, so their links route via the
  // junction — that routing decision belongs to unionSelection and must
  // arrive here already made.
  const viaJunction = parentChild.filter((edge) => edge.source === 'junction:union-1')
  assert.equal(viaJunction.length, 2)

  for (const edge of view.edges) {
    const original = graph.edges.find((candidate) => candidate.id === edge.id)
    assert.deepEqual(edge.data, original?.data, `${edge.id} kept its metadata`)
  }
})

// ── The ranking invariant ────────────────────────────────────────────

test('6. ranks are carried through by reference — a view cannot have re-ranked', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const view = projectFamilyTreeView(graph, ranks, FULL)
  assert.equal(view.ranks, ranks, 'identity, not a copy: there was no opportunity to recompute')
})

test('7. the generations the view reports are the canonical ones', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const view = projectFamilyTreeView(graph, ranks, FULL)

  assert.equal(view.ranks.get('grand'), 0)
  assert.equal(view.ranks.get('parent'), 1)
  assert.equal(view.ranks.get('parentPartner'), 1, 'partners share a generation')
  assert.equal(view.ranks.get('child'), 2)
  assert.equal(view.ranks.get('outsider'), 0, 'unconnected people start at the top')
})

test('8. PHASE 4E-3 REGRESSION: projecting a view then collapsing a group leaves outsiders where they were', () => {
  // The bug this seam must never reintroduce: ranking an already-projected
  // graph let a collapsed multi-generation group drag unrelated people
  // into other generations. Ranks are computed ONCE, on the canonical
  // graph, and travel through both projections untouched.
  const { graph } = sampleGraph()
  const canonicalRanks = computeRanks(graph.nodes, graph.edges)
  const outsiderRank = canonicalRanks.get('outsider')
  const childRank = canonicalRanks.get('child')

  const groups = [familyGroup('group-1', 'The Bellos')]
  const members = [
    groupMember('m1', 'group-1', 'grand'),
    groupMember('m2', 'group-1', 'parent'),
    groupMember('m3', 'group-1', 'child'),
  ]

  const view = projectFamilyTreeView(graph, canonicalRanks, FULL)

  for (const collapsed of [new Set<string>(), new Set(['group-1'])]) {
    const projected = projectFamilyGroups(view, groups, members, collapsed, view.ranks)
    assert.equal(
      projected.ranks.get('outsider'),
      outsiderRank,
      'collapsing a group must not move someone outside it',
    )
    if (collapsed.size === 0) {
      assert.equal(projected.ranks.get('child'), childRank)
    }
  }
})

test('9. the view layer never recomputes genealogy, even when handed odd ranks', () => {
  // Ranks supplied by the caller are passed on verbatim, whatever they
  // say. If the view layer were quietly ranking for itself, this would
  // come back with the "correct" values instead of the ones given.
  const { graph } = sampleGraph()
  const nonsense = new Map(graph.nodes.map((node) => [node.id, 99]))

  const view = projectFamilyTreeView(graph, nonsense, FULL)
  assert.equal(view.ranks.get('child'), 99)
  assert.equal(view.ranks, nonsense)
})

// ── Determinism ──────────────────────────────────────────────────────

test('10. the same input always produces the same view', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const first = projectFamilyTreeView(graph, ranks, FULL)
  const second = projectFamilyTreeView(graph, ranks, FULL)
  assert.deepEqual(first, second)
})

test('11. the order people were loaded in does not change what the view contains', () => {
  const { people, parentLinks, unions } = sampleGraph()
  const forwards = buildFamilyGraph(people, parentLinks, unions)
  const backwards = buildFamilyGraph([...people].reverse(), [...parentLinks].reverse(), [...unions].reverse())

  const viewA = projectFamilyTreeView(forwards, computeRanks(forwards.nodes, forwards.edges), FULL)
  const viewB = projectFamilyTreeView(backwards, computeRanks(backwards.nodes, backwards.edges), FULL)

  assert.deepEqual(
    viewA.nodes.map((node) => node.id).sort(),
    viewB.nodes.map((node) => node.id).sort(),
  )
  assert.deepEqual(
    viewA.edges.map((edge) => edge.id).sort(),
    viewB.edges.map((edge) => edge.id).sort(),
  )
  for (const node of viewA.nodes) {
    assert.equal(viewA.ranks.get(node.id), viewB.ranks.get(node.id), `${node.id} kept its generation`)
  }
})

// ── Focal person ─────────────────────────────────────────────────────

test('12. the focal person does not change what the full view contains', () => {
  const { graph, people } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const withoutFocus = projectFamilyTreeView(graph, ranks, { view: 'full' })
  for (const focus of [...people.map((entry) => entry.id), null, undefined, 'someone-who-left']) {
    const withFocus = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: focus })
    assert.deepEqual(withFocus.nodes, withoutFocus.nodes, `focus on ${focus} changed the family`)
    assert.deepEqual(withFocus.edges, withoutFocus.edges)
    assert.deepEqual(withFocus.hiddenNodeIds, withoutFocus.hiddenNodeIds)
  }
})

// ── Emphasis and elision ─────────────────────────────────────────────

test('13. the full view emphasises nobody and hides nobody', () => {
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)

  assert.equal(view.emphasis.size, 0, 'sparse: an absent entry means primary')
  assert.equal(view.hiddenNodeIds.size, 0)
  for (const node of view.nodes) {
    assert.equal(emphasisFor(view, node.id), 'primary')
  }
  assert.equal(emphasisFor(view, 'nobody-at-all'), 'primary', 'and the default is safe')
})

// ── Composition with the rest of the pipeline ────────────────────────

test('14. family group projection still works through the new seam', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const groups = [familyGroup('group-1', 'The Bellos')]
  const members = [groupMember('m1', 'group-1', 'grand'), groupMember('m2', 'group-1', 'parent')]

  const view = projectFamilyTreeView(graph, ranks, FULL)

  const expanded = projectFamilyGroups(view, groups, members, new Set(), view.ranks)
  assert.equal(
    expanded.nodes.filter((node) => node.type === 'person').length,
    5,
    'expanded, everyone is still drawn individually',
  )

  const collapsed = projectFamilyGroups(view, groups, members, new Set(['group-1']), view.ranks)
  const groupNodes = collapsed.nodes.filter((node) => node.type === 'familyGroup')
  assert.equal(groupNodes.length, 1, 'collapsed, the group becomes one node')
  assert.ok(
    collapsed.nodes.filter((node) => node.type === 'person').length < 5,
    'and its members are absorbed',
  )
})

test('15. inserting the view seam changes nothing the old pipeline produced', () => {
  // The whole point of this phase: `full` is an identity projection, so
  // the graph reaching group projection is byte-for-byte what reached it
  // before the seam existed.
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const groups = [familyGroup('group-1')]
  const members = [groupMember('m1', 'group-1', 'grand')]
  const collapsed = new Set(['group-1'])

  const before = projectFamilyGroups(graph, groups, members, collapsed, ranks)

  const view = projectFamilyTreeView(graph, ranks, FULL)
  const after = projectFamilyGroups(view, groups, members, collapsed, view.ranks)

  assert.deepEqual(after.nodes, before.nodes)
  assert.deepEqual(after.edges, before.edges)
  assert.deepEqual([...after.ranks].sort(), [...before.ranks].sort())
})

// ── A map, not a list ────────────────────────────────────────────────

test('16. the projection stays a graph, never an ordered sequence', () => {
  // Guards the product principle: the canvas is a spatial family map, so
  // the view layer must keep handing downstream a set of nodes and edges
  // that layout is free to place in 2D. A view that returned an order —
  // or that sorted its nodes into a chain — would quietly foreclose that.
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)

  assert.ok(Array.isArray(view.nodes) && Array.isArray(view.edges))
  assert.equal(view.nodes, graph.nodes, 'no reordering happened at all')

  // Several people share a generation: a chain could not represent that,
  // and the view must not have flattened them into one.
  const rankOne = view.nodes.filter((node) => view.ranks.get(node.id) === 1)
  assert.ok(rankOne.length > 1, 'a generation can hold more than one person')

  // And nothing in the result implies a sequence position.
  for (const node of view.nodes) {
    assert.equal('order' in node, false)
    assert.equal('index' in node, false)
  }
})

// ── Visual hierarchy: emphasis by distance (Phase 5C-3) ──────────────
// Emphasis changes how loudly a node is drawn. It must never change WHICH
// nodes there are, what they are connected to, or what generation they
// are in — the tests below assert exactly that alongside the tiering.

test('17. with nobody focused, everyone is primary — the tree looks as it always did', () => {
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)

  assert.equal(view.emphasis.size, 0)
  for (const node of view.nodes) assert.equal(emphasisFor(view, node.id), 'primary')
})

test('18. close family reads at full strength, distant kin steps back', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const view = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'child' })

  assert.equal(emphasisFor(view, 'child'), 'primary', 'the focal person')
  assert.equal(emphasisFor(view, 'parent'), 'primary')
  assert.equal(emphasisFor(view, 'parentPartner'), 'primary', 'the other parent')
  assert.equal(emphasisFor(view, 'grand'), 'primary', 'a grandparent is still close family')
  assert.equal(emphasisFor(view, 'outsider'), 'context', 'unconnected people recede')
})

test('19. a partner is one step away, so a couple reads as one unit', () => {
  // Passing through the union junction is free. Were it not, a spouse
  // would tier the same as a grandparent, which is plainly wrong.
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const view = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'parent' })

  assert.equal(emphasisFor(view, 'parentPartner'), 'primary')
  assert.equal(emphasisFor(view, 'junction:union-1'), 'primary', 'the bond itself is near too')
})

test('20. distance is measured from the focal person, so moving focus re-tiers', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)

  const fromChild = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'child' })
  const fromOutsider = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'outsider' })

  assert.equal(emphasisFor(fromChild, 'grand'), 'primary')
  assert.equal(emphasisFor(fromOutsider, 'grand'), 'context', 'from outside, the family recedes')
  assert.equal(emphasisFor(fromOutsider, 'outsider'), 'primary')
})

test('21. emphasis never changes the nodes, the edges or the ranks', () => {
  // The load-bearing guarantee of this phase.
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const plain = projectFamilyTreeView(graph, ranks, FULL)

  for (const focus of ['child', 'grand', 'outsider', 'nobody-here']) {
    const focused = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: focus })
    assert.equal(focused.nodes, plain.nodes, `focus on ${focus} rebuilt the nodes`)
    assert.equal(focused.edges, plain.edges, `focus on ${focus} rebuilt the edges`)
    assert.equal(focused.ranks, ranks, `focus on ${focus} touched the ranks`)
    assert.deepEqual(focused.hiddenNodeIds, plain.hiddenNodeIds, 'nobody is hidden by emphasis')
  }
})

test('22. a focal person who is not in the graph leaves every tier alone', () => {
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const view = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'ghost' })

  assert.equal(view.emphasis.size, 0, 'no tiering rather than everyone dimmed')
})

test('23. tiering is deterministic and independent of load order', () => {
  const { people, parentLinks, unions } = sampleGraph()
  const forwards = buildFamilyGraph(people, parentLinks, unions)
  const backwards = buildFamilyGraph(
    [...people].reverse(),
    [...parentLinks].reverse(),
    [...unions].reverse(),
  )

  const a = projectFamilyTreeView(forwards, computeRanks(forwards.nodes, forwards.edges), {
    view: 'full',
    focalPersonId: 'child',
  })
  const b = projectFamilyTreeView(backwards, computeRanks(backwards.nodes, backwards.edges), {
    view: 'full',
    focalPersonId: 'child',
  })

  for (const node of a.nodes) {
    assert.equal(emphasisFor(a, node.id), emphasisFor(b, node.id), `${node.id} tiered differently`)
  }
})

// ── Edge styling ─────────────────────────────────────────────────────

test('24. a union bond is drawn heavier than a line of descent', () => {
  // The two used to be indistinguishable in the common case — biological
  // child, married couple — which is most of a real tree.
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)
  const styled = styleEdgesForView(graph.edges, view)

  const unionWidth = styled.find((edge) => edge.data?.kind === 'unionSegment')?.style?.strokeWidth
  const descentWidth = styled.find((edge) => edge.data?.kind === 'parentChild')?.style?.strokeWidth
  assert.ok(typeof unionWidth === 'number' && typeof descentWidth === 'number')
  assert.ok(unionWidth > descentWidth, 'a couple bond reads as heavier than descent')
})

test('25. an edge is drawn at the strength of its quieter end', () => {
  // Otherwise the focal person sprouts bright spokes into the background.
  const { graph } = sampleGraph()
  const ranks = computeRanks(graph.nodes, graph.edges)
  const view = projectFamilyTreeView(graph, ranks, { view: 'full', focalPersonId: 'child' })

  const near = styleEdgesForView(graph.edges, view).find((edge) => edge.id === 'link-2')
  assert.ok(near, 'the parent -> child edge exists')
  assert.equal(edgeEmphasis(near, view), 'primary')
})

test('26. styling preserves every edge, its id and its meaning', () => {
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)
  const styled = styleEdgesForView(graph.edges, view)

  assert.deepEqual(
    styled.map((edge) => edge.id),
    graph.edges.map((edge) => edge.id),
  )
  for (const edge of styled) {
    const original = graph.edges.find((candidate) => candidate.id === edge.id)
    assert.deepEqual(edge.data, original?.data, `${edge.id} kept its meaning`)
    assert.equal(edge.source, original?.source)
    assert.equal(edge.target, original?.target)
  }
  assert.notEqual(styled, graph.edges, 'and the originals were not mutated')
  assert.equal(graph.edges[0]?.style?.strokeWidth, 1.5, 'the adapter output is untouched')
})

test('27. a collapsed-group boundary edge stays quieter than a real one', () => {
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)

  const real = graph.edges.find((edge) => edge.data?.kind === 'parentChild')
  const realData = real?.data
  assert.ok(real && realData)

  const boundary: FamilyEdge = { ...real, id: 'boundary-1', data: { ...realData, boundary: true } }
  const [styledReal, styledBoundary] = styleEdgesForView([real, boundary], view)

  assert.ok(
    (styledBoundary?.style?.opacity as number) < (styledReal?.style?.opacity as number),
    'a boundary edge stands for something inside a collapsed group, and says so quietly',
  )
  assert.equal(styledBoundary?.type, 'smoothstep', 'and keeps its orthogonal routing')
})

test('28. with nobody focused the tree is drawn exactly as it was before this phase', () => {
  // The unfocused view is the one most users see most of the time, so the
  // hierarchy must cost it nothing: same 1.5px descent lines, full opacity.
  const { graph } = sampleGraph()
  const view = projectFamilyTreeView(graph, computeRanks(graph.nodes, graph.edges), FULL)
  const styled = styleEdgesForView(graph.edges, view)

  for (const edge of styled) {
    assert.equal(edge.style?.opacity, 1, edge.id + ' should be at full strength')
    if (edge.data?.kind === 'parentChild') {
      assert.equal(edge.style?.strokeWidth, 1.5, 'the width the adapter has always used')
    }
  }
})
