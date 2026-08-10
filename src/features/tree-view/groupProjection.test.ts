// Pure-function tests: the projection touches no storage, so unlike
// familyGroups.test.ts these need no IndexedDB shim at all. Fixtures are
// fed through the real buildFamilyGraph so the projection is exercised
// against genuine adapter output (junction routing included) rather than
// a hand-built approximation of it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type {
  FamilyGroup,
  FamilyGroupMember,
  ParentLink,
  ParentRelationship,
  Person,
  Union,
  UnionStatus,
} from '../../types'
import { buildFamilyGraph } from './graphAdapter'
import { familyGroupNodeId, projectFamilyGroups } from './groupProjection'
import { computeRanks } from './rank'
import type { FamilyEdge, FamilyGraph, FamilyGroupNodeData } from './types'

const TREE_ID = 'tree-1'
const ISO = '2024-01-01T00:00:00.000Z'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function makePerson(firstName: string): Person {
  return {
    id: nextId('person'),
    familyTreeId: TREE_ID,
    firstName,
    lastName: '',
    gender: 'unknown',
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

function makeUnion(partnerA: Person, partnerB: Person, status: UnionStatus = 'married'): Union {
  return {
    id: nextId('union'),
    familyTreeId: TREE_ID,
    partnerAId: partnerA.id,
    partnerBId: partnerB.id,
    status,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function makeGroup(name: string): FamilyGroup {
  return {
    id: nextId('group'),
    familyTreeId: TREE_ID,
    name,
    establishedPrecision: 'unknown',
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function makeMembership(group: FamilyGroup, person: Person): FamilyGroupMember {
  return {
    id: nextId('member'),
    familyTreeId: TREE_ID,
    familyGroupId: group.id,
    personId: person.id,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function personNodeIds(graph: FamilyGraph): string[] {
  return graph.nodes.filter((node) => node.type === 'person').map((node) => node.id)
}

/** Node/edge shape only — the projection also returns a rank map, which the identity tests aren't about. */
function shape(graph: FamilyGraph): FamilyGraph {
  return { nodes: graph.nodes, edges: graph.edges }
}

function groupNodeData(graph: FamilyGraph, group: FamilyGroup): FamilyGroupNodeData {
  const node = graph.nodes.find((candidate) => candidate.id === familyGroupNodeId(group.id))
  if (!node) throw new Error(`expected a projected node for group "${group.name}"`)
  if (node.type !== 'familyGroup') throw new Error(`expected node for "${group.name}" to be a familyGroup node`)
  return node.data
}

function edgesBetween(graph: FamilyGraph, source: string, target: string): FamilyEdge[] {
  return graph.edges.filter((edge) => edge.source === source && edge.target === target)
}

/** Every projected edge must name at least one real underlying edge from the source graph. */
function assertNoFabricatedEdges(projected: FamilyGraph, original: FamilyGraph): void {
  const realEdgeIds = new Set(original.edges.map((edge) => edge.id))
  for (const edge of projected.edges) {
    const underlying = edge.data?.underlyingEdgeIds
    if (!underlying) {
      assert.ok(realEdgeIds.has(edge.id), `pass-through edge ${edge.id} must be an original edge`)
      continue
    }
    assert.ok(underlying.length > 0, `projected edge ${edge.id} must cite at least one underlying edge`)
    for (const id of underlying) {
      assert.ok(realEdgeIds.has(id), `projected edge ${edge.id} cites unknown underlying edge ${id}`)
    }
  }
}

test('1. no family groups at all leaves the graph completely untouched', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const graph = buildFamilyGraph([gran, mum], [makeParentLink(gran, mum)], [])

  const projected = projectFamilyGroups(graph, [], [], new Set())

  assert.deepEqual(shape(projected), graph)
})

test('2. one collapsed group absorbs its members and drops their internal edge', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const outsider = makePerson('Outsider')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph([gran, mum, outsider], [makeParentLink(gran, mum)], [])

  const projected = projectFamilyGroups(
    graph,
    [group],
    [makeMembership(group, gran), makeMembership(group, mum)],
    new Set([group.id]),
  )

  assert.deepEqual(personNodeIds(projected), [outsider.id], 'only the ungrouped person stays a person node')
  const data = groupNodeData(projected, group)
  assert.deepEqual(data.absorbedPersonIds, [gran.id, mum.id].sort((a, b) => a.localeCompare(b)))
  assert.equal(data.memberCount, 2)
  assert.equal(projected.edges.length, 0, 'the wholly-internal parent link is not drawn')
})

test('3. an expanded (non-collapsed) group leaves the graph identical', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph([gran, mum], [makeParentLink(gran, mum)], [])

  const projected = projectFamilyGroups(
    graph,
    [group],
    [makeMembership(group, gran), makeMembership(group, mum)],
    new Set(),
  )

  assert.deepEqual(shape(projected), graph)
})

test('4. a collapsed group with no external edges becomes one node and no edges', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const group = makeGroup('Self-contained Family')
  const graph = buildFamilyGraph([gran, mum], [makeParentLink(gran, mum)], [])

  const projected = projectFamilyGroups(
    graph,
    [group],
    [makeMembership(group, gran), makeMembership(group, mum)],
    new Set([group.id]),
  )

  assert.equal(projected.nodes.length, 1)
  assert.equal(projected.nodes[0]?.id, familyGroupNodeId(group.id))
  assert.equal(projected.edges.length, 0)
})

test('5. a single external connection is re-pointed onto the group node', () => {
  const mum = makePerson('Mum')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const link = makeParentLink(mum, kid)
  const graph = buildFamilyGraph([mum, kid], [link], [])

  const projected = projectFamilyGroups(graph, [group], [makeMembership(group, mum)], new Set([group.id]))

  const boundary = edgesBetween(projected, familyGroupNodeId(group.id), kid.id)
  assert.equal(boundary.length, 1)
  assert.equal(boundary[0]?.data?.kind, 'parentChild', 'keeps the original kind so rank.ts still constrains it')
  assert.equal(boundary[0]?.data?.boundary, true)
  assert.deepEqual(boundary[0]?.data?.underlyingEdgeIds, [link.id])
  assertNoFabricatedEdges(projected, graph)
})

test('6. multiple external connections stay separate, but two parents of one child merge into one edge', () => {
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const cousin = makePerson('Cousin')
  const kidA = makePerson('Kid A')
  const kidB = makePerson('Kid B')
  const kidC = makePerson('Kid C')
  const spouseOut = makePerson('Spouse Outside')
  const parentOut = makePerson('Parent Outside')
  const group = makeGroup('Big Family')

  // mum + dad are both inside the group and both parent all three kids, so
  // each kid's two ParentLinks route through the same (absorbed) junction.
  const marriage = makeUnion(mum, dad)
  const links = [kidA, kidB, kidC].flatMap((kid) => [makeParentLink(mum, kid), makeParentLink(dad, kid)])
  // One member married outside, and one member with a parent outside.
  const outsideMarriage = makeUnion(cousin, spouseOut)
  links.push(makeParentLink(parentOut, cousin))

  const graph = buildFamilyGraph(
    [mum, dad, cousin, kidA, kidB, kidC, spouseOut, parentOut],
    links,
    [marriage, outsideMarriage],
  )
  const projected = projectFamilyGroups(
    graph,
    [group],
    [mum, dad, cousin].map((person) => makeMembership(group, person)),
    new Set([group.id]),
  )

  const groupId = familyGroupNodeId(group.id)
  for (const kid of [kidA, kidB, kidC]) {
    const edges = edgesBetween(projected, groupId, kid.id)
    assert.equal(edges.length, 1, 'both parents of a child collapse to a single line, not two overlapping ones')
    assert.equal(edges[0]?.data?.underlyingEdgeIds?.length, 2, 'but both ParentLinks are still cited')
  }
  assert.equal(edgesBetween(projected, parentOut.id, groupId).length, 1, 'the external parent link survives')
  // The outside marriage keeps its junction, since only one partner was absorbed.
  const junctionId = `junction:${outsideMarriage.id}`
  assert.equal(edgesBetween(projected, groupId, junctionId).length, 1)
  assert.equal(edgesBetween(projected, junctionId, spouseOut.id).length, 1)
  assertNoFabricatedEdges(projected, graph)
})

test('7. a person in two groups is never absorbed, whether one or both are collapsed', () => {
  const maternalGran = makePerson('Maternal Gran')
  const paternalGran = makePerson('Paternal Gran')
  const you = makePerson('You')
  const maternal = makeGroup('Maternal Family')
  const paternal = makeGroup('Paternal Family')
  const graph = buildFamilyGraph(
    [maternalGran, paternalGran, you],
    [makeParentLink(maternalGran, you), makeParentLink(paternalGran, you)],
    [],
  )
  const members = [
    makeMembership(maternal, maternalGran),
    makeMembership(paternal, paternalGran),
    makeMembership(maternal, you),
    makeMembership(paternal, you),
  ]

  // Only one collapsed: `you` belongs to an expanded group too, so stays.
  const oneCollapsed = projectFamilyGroups(graph, [maternal, paternal], members, new Set([maternal.id]))
  assert.ok(personNodeIds(oneCollapsed).includes(you.id), 'a mixed bridge stays visible')
  assert.deepEqual(groupNodeData(oneCollapsed, maternal).absorbedPersonIds, [maternalGran.id])

  // Both collapsed: there is no non-arbitrary absorber, and `you` is the bridge.
  const bothCollapsed = projectFamilyGroups(
    graph,
    [maternal, paternal],
    members,
    new Set([maternal.id, paternal.id]),
  )
  assert.deepEqual(personNodeIds(bothCollapsed), [you.id])
  assert.equal(edgesBetween(bothCollapsed, familyGroupNodeId(maternal.id), you.id).length, 1)
  assert.equal(edgesBetween(bothCollapsed, familyGroupNodeId(paternal.id), you.id).length, 1)
  assert.deepEqual(groupNodeData(bothCollapsed, maternal).absorbedPersonIds, [maternalGran.id])
  assert.deepEqual(groupNodeData(bothCollapsed, paternal).absorbedPersonIds, [paternalGran.id])
  assertNoFabricatedEdges(bothCollapsed, graph)
})

test('8. two collapsed groups joined by a real marriage meet at the surviving junction', () => {
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const maternal = makeGroup('Maternal Family')
  const paternal = makeGroup('Paternal Family')
  const marriage = makeUnion(mum, dad)
  const graph = buildFamilyGraph([mum, dad], [], [marriage])

  const projected = projectFamilyGroups(
    graph,
    [maternal, paternal],
    [makeMembership(maternal, mum), makeMembership(paternal, dad)],
    new Set([maternal.id, paternal.id]),
  )

  const junctionId = `junction:${marriage.id}`
  assert.ok(
    projected.nodes.some((node) => node.id === junctionId),
    'the junction survives because its partners were absorbed into different groups',
  )
  assert.equal(edgesBetween(projected, familyGroupNodeId(maternal.id), junctionId).length, 1)
  assert.equal(edgesBetween(projected, junctionId, familyGroupNodeId(paternal.id)).length, 1)
  assert.equal(personNodeIds(projected).length, 0)
  assertNoFabricatedEdges(projected, graph)
})

test('9. an adopted relationship crossing a group boundary keeps its subtype', () => {
  const mum = makePerson('Mum')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph([mum, kid], [makeParentLink(mum, kid, 'adopted')], [])

  const projected = projectFamilyGroups(graph, [group], [makeMembership(group, mum)], new Set([group.id]))

  const edge = edgesBetween(projected, familyGroupNodeId(group.id), kid.id)[0]
  assert.equal(edge?.data?.kind, 'parentChild')
  assert.equal(edge?.data && 'relationship' in edge.data ? edge.data.relationship : undefined, 'adopted')
})

test('10. a step relationship crossing a group boundary keeps its subtype', () => {
  const mum = makePerson('Mum')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph([mum, kid], [makeParentLink(mum, kid, 'step')], [])

  const projected = projectFamilyGroups(graph, [group], [makeMembership(group, mum)], new Set([group.id]))

  const edge = edgesBetween(projected, familyGroupNodeId(group.id), kid.id)[0]
  assert.equal(edge?.data && 'relationship' in edge.data ? edge.data.relationship : undefined, 'step')
})

test('11. multiple unions crossing a boundary stay distinct and are never merged', () => {
  const person = makePerson('Twice Married')
  const firstSpouse = makePerson('First Spouse')
  const secondSpouse = makePerson('Second Spouse')
  const group = makeGroup('Their Family')
  const firstUnion = makeUnion(person, firstSpouse, 'divorced')
  const secondUnion = makeUnion(person, secondSpouse, 'married')
  const graph = buildFamilyGraph([person, firstSpouse, secondSpouse], [], [firstUnion, secondUnion])

  const projected = projectFamilyGroups(graph, [group], [makeMembership(group, person)], new Set([group.id]))

  const groupId = familyGroupNodeId(group.id)
  assert.equal(edgesBetween(projected, groupId, `junction:${firstUnion.id}`).length, 1)
  assert.equal(edgesBetween(projected, groupId, `junction:${secondUnion.id}`).length, 1)
  assert.equal(edgesBetween(projected, `junction:${firstUnion.id}`, firstSpouse.id).length, 1)
  assert.equal(edgesBetween(projected, `junction:${secondUnion.id}`, secondSpouse.id).length, 1)
  assertNoFabricatedEdges(projected, graph)
})

test('12. expanding restores every original node and edge exactly', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const marriage = makeUnion(mum, dad)
  const graph = buildFamilyGraph(
    [gran, mum, dad, kid],
    [makeParentLink(gran, mum), makeParentLink(mum, kid), makeParentLink(dad, kid)],
    [marriage],
  )
  const members = [gran, mum].map((person) => makeMembership(group, person))

  const collapsed = projectFamilyGroups(graph, [group], members, new Set([group.id]))
  assert.notDeepEqual(shape(collapsed), graph, 'sanity: collapsing actually changed something')

  const expanded = projectFamilyGroups(graph, [group], members, new Set())
  assert.deepEqual(shape(expanded), graph, 'expanding returns the original graph verbatim')
})

test('13. a person node is never duplicated, however many groups they belong to', () => {
  const you = makePerson('You')
  const relative = makePerson('Relative')
  const groups = ['A', 'B', 'C'].map((name) => makeGroup(name))
  const graph = buildFamilyGraph([you, relative], [makeParentLink(relative, you)], [])
  const members = groups.map((group) => makeMembership(group, you))

  const projected = projectFamilyGroups(graph, groups, members, new Set(groups.map((group) => group.id)))

  const ids = projected.nodes.map((node) => node.id)
  assert.equal(new Set(ids).size, ids.length, 'no node id appears twice')
  assert.equal(personNodeIds(projected).filter((id) => id === you.id).length, 1)
})

test('14. no projected edge is invented — all cite real underlying records', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph(
    [gran, mum, dad, kid],
    [makeParentLink(gran, mum), makeParentLink(mum, kid), makeParentLink(dad, kid)],
    [makeUnion(mum, dad)],
  )

  const projected = projectFamilyGroups(
    graph,
    [group],
    [gran, mum].map((person) => makeMembership(group, person)),
    new Set([group.id]),
  )

  assertNoFabricatedEdges(projected, graph)
})

test('15. disconnected collapsed groups gain no edge between them', () => {
  const a1 = makePerson('A1')
  const a2 = makePerson('A2')
  const b1 = makePerson('B1')
  const b2 = makePerson('B2')
  const groupA = makeGroup('Family A')
  const groupB = makeGroup('Family B')
  const graph = buildFamilyGraph([a1, a2, b1, b2], [makeParentLink(a1, a2), makeParentLink(b1, b2)], [])

  const projected = projectFamilyGroups(
    graph,
    [groupA, groupB],
    [makeMembership(groupA, a1), makeMembership(groupA, a2), makeMembership(groupB, b1), makeMembership(groupB, b2)],
    new Set([groupA.id, groupB.id]),
  )

  assert.equal(projected.nodes.length, 2)
  assert.equal(projected.edges.length, 0, 'unrelated families are never joined by the projection')
})

test('16. an empty collapsed group still renders a node, with no members and no edges', () => {
  const outsider = makePerson('Outsider')
  const group = makeGroup('Empty Family')
  const graph = buildFamilyGraph([outsider], [], [])

  const projected = projectFamilyGroups(graph, [group], [], new Set([group.id]))

  const data = groupNodeData(projected, group)
  assert.equal(data.memberCount, 0)
  assert.deepEqual(data.absorbedPersonIds, [])
  assert.equal(projected.edges.length, 0)
  assert.deepEqual(personNodeIds(projected), [outsider.id])
})

test('17. a single-person group absorbs that person and re-points their edges', () => {
  const mum = makePerson('Mum')
  const gran = makePerson('Gran')
  const kid = makePerson('Kid')
  const group = makeGroup('Just Mum')
  const graph = buildFamilyGraph([mum, gran, kid], [makeParentLink(gran, mum), makeParentLink(mum, kid)], [])

  const projected = projectFamilyGroups(graph, [group], [makeMembership(group, mum)], new Set([group.id]))

  const groupId = familyGroupNodeId(group.id)
  assert.deepEqual(personNodeIds(projected).sort(), [gran.id, kid.id].sort())
  assert.equal(edgesBetween(projected, gran.id, groupId).length, 1)
  assert.equal(edgesBetween(projected, groupId, kid.id).length, 1)
  assert.equal(groupNodeData(projected, group).memberCount, 1)
})

test('18. the projection is deterministic for identical input', () => {
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph(
    [mum, dad, kid],
    [makeParentLink(mum, kid), makeParentLink(dad, kid)],
    [makeUnion(mum, dad)],
  )
  const members = [makeMembership(group, mum)]

  const first = projectFamilyGroups(graph, [group], members, new Set([group.id]))
  const second = projectFamilyGroups(graph, [group], members, new Set([group.id]))

  assert.deepEqual(first, second)
})

test('19. a projected graph still satisfies rank.ts constraints', () => {
  const gran = makePerson('Gran')
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const kid = makePerson('Kid')
  const group = makeGroup("Mother's Family")
  const graph = buildFamilyGraph(
    [gran, mum, dad, kid],
    [makeParentLink(gran, mum), makeParentLink(mum, kid), makeParentLink(dad, kid)],
    [makeUnion(mum, dad)],
  )

  const projected = projectFamilyGroups(
    graph,
    [group],
    [gran, mum].map((person) => makeMembership(group, person)),
    new Set([group.id]),
  )
  const ranks = computeRanks(projected.nodes, projected.edges)

  for (const node of projected.nodes) {
    assert.ok(ranks.has(node.id), `every projected node gets a rank (${node.id})`)
  }
  for (const edge of projected.edges) {
    const sourceRank = ranks.get(edge.source) ?? 0
    const targetRank = ranks.get(edge.target) ?? 0
    if (edge.data?.kind === 'parentChild') {
      assert.ok(sourceRank < targetRank, `parent must rank above child on ${edge.id}`)
    } else if (edge.data?.kind === 'unionSegment') {
      assert.equal(sourceRank, targetRank, `partners must share a rank on ${edge.id}`)
    }
  }
})

test('20. a collapsed group whose members all belong to another collapsed group absorbs nothing', () => {
  // Documented degenerate case: when one group is a subset of another and
  // both are collapsed, every member is a bridge, so nothing is absorbed
  // and both group nodes render empty. Pinned here so the behaviour can
  // only ever change deliberately.
  const one = makePerson('One')
  const two = makePerson('Two')
  const outer = makeGroup('Outer Family')
  const inner = makeGroup('Inner Family')
  const graph = buildFamilyGraph([one, two], [makeParentLink(one, two)], [])
  const members = [
    makeMembership(outer, one),
    makeMembership(outer, two),
    makeMembership(inner, one),
    makeMembership(inner, two),
  ]

  const projected = projectFamilyGroups(graph, [outer, inner], members, new Set([outer.id, inner.id]))

  assert.deepEqual(personNodeIds(projected).sort(), [one.id, two.id].sort(), 'everyone stays visible')
  assert.deepEqual(groupNodeData(projected, outer).absorbedPersonIds, [])
  assert.deepEqual(groupNodeData(projected, inner).absorbedPersonIds, [])
  assert.equal(projected.edges.length, 1, 'the original parent link is untouched')
})

// ── Phase 4E-3c: the rank invariant ──────────────────────────────────
// Real data showed that ranking the PROJECTED graph let a collapsed
// multi-generation group drag outsiders into different generations
// (shoo/habee moved Gen 3 -> Gen 5). Ranks are now computed from the
// genealogy graph before any projection and carried through untouched;
// these tests pin that down.

/**
 * Four real generations, and a group that spans all of them while an
 * external parent sits above and external children hang below — the exact
 * shape that broke before.
 */
function buildMultiGenerationFixture() {
  const gran = makePerson('Gran') // Gen 1, in group
  const parent = makePerson('Parent') // Gen 2, in group
  const child = makePerson('Child') // Gen 3, in group
  const grandchild = makePerson('Grandchild') // Gen 4, in group
  const externalParent = makePerson('External Parent') // Gen 2, outside — parents an absorbed member
  const externalChild = makePerson('External Child') // Gen 3, outside — parented by an absorbed member
  const group = makeGroup('Four Generation Family')

  const links = [
    makeParentLink(gran, parent),
    makeParentLink(parent, child),
    makeParentLink(child, grandchild),
    makeParentLink(externalParent, child),
    makeParentLink(parent, externalChild),
  ]
  const graph = buildFamilyGraph(
    [gran, parent, child, grandchild, externalParent, externalChild],
    links,
    [],
  )
  const members = [gran, parent, child, grandchild].map((person) => makeMembership(group, person))
  return { graph, group, members, gran, parent, child, grandchild, externalParent, externalChild }
}

test('21. collapsing a multi-generation group leaves every external person on their original generation', () => {
  const f = buildMultiGenerationFixture()
  const before = computeRanks(f.graph.nodes, f.graph.edges)

  const projected = projectFamilyGroups(f.graph, [f.group], f.members, new Set([f.group.id]))

  for (const node of projected.nodes) {
    if (node.type !== 'person') continue
    assert.equal(
      projected.ranks.get(node.id),
      before.get(node.id),
      `${node.id} must keep its genealogical rank when a group collapses`,
    )
  }
})

test('22. external parent and external child keep their exact generations across every collapse state', () => {
  const f = buildMultiGenerationFixture()
  const before = computeRanks(f.graph.nodes, f.graph.edges)

  for (const collapsed of [new Set<string>(), new Set([f.group.id])]) {
    const projected = projectFamilyGroups(f.graph, [f.group], f.members, collapsed)
    assert.equal(projected.ranks.get(f.externalParent.id), before.get(f.externalParent.id), 'external parent')
    assert.equal(projected.ranks.get(f.externalChild.id), before.get(f.externalChild.id), 'external child')
  }
})

test('23. re-expanding restores every member to their original genealogical rank', () => {
  const f = buildMultiGenerationFixture()
  const before = computeRanks(f.graph.nodes, f.graph.edges)

  projectFamilyGroups(f.graph, [f.group], f.members, new Set([f.group.id]))
  const reExpanded = projectFamilyGroups(f.graph, [f.group], f.members, new Set())

  for (const person of [f.gran, f.parent, f.child, f.grandchild]) {
    assert.equal(reExpanded.ranks.get(person.id), before.get(person.id), `${person.firstName} after re-expansion`)
  }
  assert.deepEqual(shape(reExpanded), f.graph, 'and the graph itself is the original one')
})

test('24. a collapsed group reports the generation span of its members instead of one flat rank', () => {
  const f = buildMultiGenerationFixture()
  const before = computeRanks(f.graph.nodes, f.graph.edges)

  const projected = projectFamilyGroups(f.graph, [f.group], f.members, new Set([f.group.id]))
  const data = groupNodeData(projected, f.group)

  assert.equal(data.minRank, before.get(f.gran.id), 'span starts at the shallowest member');
  assert.equal(data.maxRank, before.get(f.grandchild.id), 'span ends at the deepest member')
  assert.ok(data.maxRank > data.minRank, 'this group genuinely spans several generations')
  assert.equal(projected.ranks.get(familyGroupNodeId(f.group.id)), data.minRank, 'drawn from the top of its span')
})

test('25. two groups spanning different generation ranges each keep their own span, and people keep their ranks', () => {
  const aTop = makePerson('A Top') // Gen 1
  const aMid = makePerson('A Mid') // Gen 2
  const bMid = makePerson('B Mid') // Gen 2
  const bLow = makePerson('B Low') // Gen 3
  const bridge = makePerson('Bridge') // Gen 3, ungrouped
  const groupA = makeGroup('Group A')
  const groupB = makeGroup('Group B')
  const graph = buildFamilyGraph(
    [aTop, aMid, bMid, bLow, bridge],
    [makeParentLink(aTop, aMid), makeParentLink(aMid, bMid), makeParentLink(bMid, bLow), makeParentLink(bMid, bridge)],
    [],
  )
  const members = [
    makeMembership(groupA, aTop),
    makeMembership(groupA, aMid),
    makeMembership(groupB, bMid),
    makeMembership(groupB, bLow),
  ]
  const before = computeRanks(graph.nodes, graph.edges)

  const projected = projectFamilyGroups(graph, [groupA, groupB], members, new Set([groupA.id, groupB.id]))

  assert.deepEqual(
    [groupNodeData(projected, groupA).minRank, groupNodeData(projected, groupA).maxRank],
    [before.get(aTop.id), before.get(aMid.id)],
  )
  assert.deepEqual(
    [groupNodeData(projected, groupB).minRank, groupNodeData(projected, groupB).maxRank],
    [before.get(bMid.id), before.get(bLow.id)],
  )
  assert.equal(projected.ranks.get(bridge.id), before.get(bridge.id), 'the ungrouped person is unmoved')
})

test('26. two collapsed groups joined by a marriage never produce a direct group-to-group edge', () => {
  const mum = makePerson('Mum')
  const dad = makePerson('Dad')
  const you = makePerson('You')
  const maternal = makeGroup('Maternal')
  const paternal = makeGroup('Paternal')
  const marriage = makeUnion(mum, dad)
  const graph = buildFamilyGraph(
    [mum, dad, you],
    [makeParentLink(mum, you), makeParentLink(dad, you)],
    [marriage],
  )

  const projected = projectFamilyGroups(
    graph,
    [maternal, paternal],
    [makeMembership(maternal, mum), makeMembership(paternal, dad)],
    new Set([maternal.id, paternal.id]),
  )

  const maternalId = familyGroupNodeId(maternal.id)
  const paternalId = familyGroupNodeId(paternal.id)
  for (const edge of projected.edges) {
    const joinsTheTwoGroups =
      (edge.source === maternalId && edge.target === paternalId) ||
      (edge.source === paternalId && edge.target === maternalId)
    assert.ok(!joinsTheTwoGroups, 'a FamilyGroup is not a person and can never be another group’s partner')
  }
  // The real union's junction is what actually joins them, and the child
  // still hangs off that junction rather than off either group.
  const junctionId = `junction:${marriage.id}`
  assert.ok(projected.nodes.some((node) => node.id === junctionId), 'the real junction survives')
  assert.equal(edgesBetween(projected, junctionId, you.id).length, 2, 'both original ParentLinks still reach the child')
  assertNoFabricatedEdges(projected, graph)
})

test('27. collapsing never changes the rank of ANY person, across every combination of collapsed groups', () => {
  const f = buildMultiGenerationFixture()
  const second = makeGroup('Second Family')
  const secondMembers = [makeMembership(second, f.externalParent)]
  const allGroups = [f.group, second]
  const allMembers = [...f.members, ...secondMembers]
  const before = computeRanks(f.graph.nodes, f.graph.edges)

  const combinations = [
    new Set<string>(),
    new Set([f.group.id]),
    new Set([second.id]),
    new Set([f.group.id, second.id]),
  ]

  for (const collapsed of combinations) {
    const projected = projectFamilyGroups(f.graph, allGroups, allMembers, collapsed)
    for (const node of projected.nodes) {
      if (node.type !== 'person') continue
      assert.equal(
        projected.ranks.get(node.id),
        before.get(node.id),
        `${node.id} must be rank-stable for collapsed set {${[...collapsed].join(',')}}`,
      )
    }
  }
})
