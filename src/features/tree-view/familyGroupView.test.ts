// Pure: no fake-indexeddb, no browser environment.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFamilyGraph } from './graphAdapter'
import { computeRanks } from './rank'
import { projectFamilyGroups } from './groupProjection'
import { projectFamilyTreeView } from './viewProjection'
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
 * Two families joined by one marriage.
 *
 *   ahmed ══ fatima            ibrahim ══ naseema     (My Family | Hers)
 *      │                            │
 *    hassan ═══════════════════ sameera                the bridge
 *      │
 *    habeeb                                            next generation
 */
const PEOPLE = ['ahmed', 'fatima', 'hassan', 'ibrahim', 'naseema', 'sameera', 'habeeb'].map(person)
const LINKS = [
  link('l1', 'ahmed', 'hassan'),
  link('l2', 'fatima', 'hassan'),
  link('l3', 'ibrahim', 'sameera'),
  link('l4', 'naseema', 'sameera'),
  link('l5', 'hassan', 'habeeb'),
  link('l6', 'sameera', 'habeeb'),
]
const UNIONS = [
  union('u-mine', 'ahmed', 'fatima'),
  union('u-hers', 'ibrahim', 'naseema'),
  union('u-bridge', 'hassan', 'sameera'),
]
const MY = group('my')
const HERS = group('hers')
const MEMBERS: FamilyGroupMember[] = [
  member('m1', MY.id, 'ahmed'),
  member('m2', MY.id, 'fatima'),
  member('m3', MY.id, 'hassan'),
  member('m4', HERS.id, 'ibrahim'),
  member('m5', HERS.id, 'naseema'),
  member('m6', HERS.id, 'sameera'),
]

function build() {
  const graph = buildFamilyGraph(PEOPLE, LINKS, UNIONS)
  return { graph, ranks: computeRanks(graph.nodes, graph.edges) }
}

const memberIdsOf = (groupId: string) =>
  new Set(MEMBERS.filter((m) => m.familyGroupId === groupId).map((m) => m.personId))

// ── the other family's own tree ─────────────────────────────────────

test("opening a connected family shows that family's people", () => {
  const { graph, ranks } = build()
  const view = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id), connectingPersonId: 'sameera' },
  })

  const shown = view.nodes.filter((node) => node.type === 'person').map((node) => node.id).sort()
  // Her family, plus the husband who married in — without him the
  // marriage would have nobody on the far side of it.
  assert.deepEqual(shown, ['hassan', 'ibrahim', 'naseema', 'sameera'])
})

test('the rest of the tree is hidden, not deleted', () => {
  const { graph, ranks } = build()
  const view = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id) },
  })

  assert.ok(view.hiddenNodeIds.has('ahmed'), 'the other family is out of frame')
  assert.ok(view.hiddenNodeIds.has('fatima'))
  // The canonical graph is untouched: the frame moved, the family did not.
  assert.equal(graph.nodes.filter((node) => node.type === 'person').length, PEOPLE.length)
})

test('nobody is duplicated to appear in the other family', () => {
  const { graph, ranks } = build()
  const view = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id), connectingPersonId: 'sameera' },
  })

  const ids = view.nodes.map((node) => node.id)
  assert.equal(new Set(ids).size, ids.length, 'every node appears exactly once')
})

test('the view never re-ranks: generations survive the crossing', () => {
  const { graph, ranks } = build()
  const view = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id) },
  })
  // Identity, not equality — proof that nothing re-ranked.
  assert.equal(view.ranks, ranks)
  assert.equal(view.ranks.get('sameera'), ranks.get('sameera'))
})

test('the spouse who married in reads as context, the bridge does not', () => {
  const { graph, ranks } = build()
  const withoutBridge = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id) },
  })
  assert.equal(withoutBridge.emphasis.get('hassan'), 'secondary')

  const fromBridge = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id), connectingPersonId: 'hassan' },
  })
  assert.equal(fromBridge.emphasis.get('hassan'), undefined, 'the way you came in is not played down')
})

test('no edge is left pointing at somebody out of frame', () => {
  const { graph, ranks } = build()
  const view = projectFamilyTreeView(graph, ranks, {
    view: 'family-group',
    familyGroup: { memberIds: memberIdsOf(HERS.id) },
  })
  const shown = new Set(view.nodes.map((node) => node.id))
  for (const edge of view.edges) {
    assert.ok(shown.has(edge.source), `dangling source ${edge.source}`)
    assert.ok(shown.has(edge.target), `dangling target ${edge.target}`)
  }
})

// ── the merged view ─────────────────────────────────────────────────

test('the merged view holds both families, joined by the marriage', () => {
  const { graph, ranks } = build()
  const full = projectFamilyTreeView(graph, ranks, { view: 'full' })
  const merged = projectFamilyGroups(
    full,
    [MY, HERS],
    MEMBERS,
    new Set([MY.id, HERS.id]),
    ranks,
  )

  const groupNodes = merged.nodes.filter((node) => node.type === 'familyGroup')
  assert.deepEqual(groupNodes.map((node) => node.id).sort(), ['group:hers', 'group:my'])

  // Both sides keep their own identity and their own size.
  const sizes = new Map(
    groupNodes.map((node) => [node.id, (node.data as { memberCount: number }).memberCount]),
  )
  assert.equal(sizes.get('group:my'), 3)
  assert.equal(sizes.get('group:hers'), 3)
})

test('the descendants of the connecting marriage are still in the merged view', () => {
  const { graph, ranks } = build()
  const full = projectFamilyTreeView(graph, ranks, { view: 'full' })
  const merged = projectFamilyGroups(full, [MY, HERS], MEMBERS, new Set([MY.id, HERS.id]), ranks)

  // Habeeb belongs to no group, so he is nobody's to absorb — he stays
  // his own card, below the marriage he came from.
  assert.ok(merged.nodes.some((node) => node.id === 'habeeb'))
  assert.ok(
    (ranks.get('habeeb') ?? 0) > (ranks.get('hassan') ?? 0),
    'and in the generation below his parents',
  )
})

test('merging is a view: it creates no person, link or union', () => {
  const { graph, ranks } = build()
  const full = projectFamilyTreeView(graph, ranks, { view: 'full' })
  const before = {
    people: PEOPLE.length,
    links: LINKS.length,
    unions: UNIONS.length,
    members: MEMBERS.length,
  }

  projectFamilyGroups(full, [MY, HERS], MEMBERS, new Set([MY.id, HERS.id]), ranks)

  assert.deepEqual(
    { people: PEOPLE.length, links: LINKS.length, unions: UNIONS.length, members: MEMBERS.length },
    before,
    'the records are exactly what they were',
  )
  assert.equal(graph.nodes.length, buildFamilyGraph(PEOPLE, LINKS, UNIONS).nodes.length)
})

// ── the ordinary tree is untouched ──────────────────────────────────

test('the full view is unchanged by any of this', () => {
  const { graph, ranks } = build()
  const full = projectFamilyTreeView(graph, ranks, { view: 'full' })
  // Identity: the full view is still the free identity projection it was,
  // so nothing about adding a new view made the ordinary tree re-lay-out.
  assert.equal(full.nodes, graph.nodes)
  assert.equal(full.edges, graph.edges)
  assert.equal(full.ranks, ranks)
  assert.equal(full.hiddenNodeIds.size, 0)
})
