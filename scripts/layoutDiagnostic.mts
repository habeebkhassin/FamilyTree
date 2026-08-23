/**
 * Layout diagnostic harness — Phase 5C-5.
 *
 * Runs the REAL layout over synthetic fixtures and measures what a reader
 * actually struggles with: how far a child sits from its parent, how many
 * edges cross, whether anything overlaps, and how wide the result is.
 *
 * Not a test. A measuring instrument, kept so claims about layout can be
 * reproduced rather than asserted.
 *
 *   npx tsx scripts/layoutDiagnostic.mts
 *
 *
 * WHAT PHASE 5C-5 ESTABLISHED
 * ───────────────────────────
 * The current row layout packs each generation independently from x = 0,
 * so a row has no horizontal registration with the row above it. The
 * parent-average signal exists but is used only to ORDER clusters, never
 * to place them. The plainest demonstration is fixture 2 below: one
 * parent, four children, nothing else competing, and still a 540px gap,
 * because a 160px-wide parent row and a 700px-wide child row both start
 * at zero.
 *
 * A uniform per-row offset was built and measured against these fixtures
 * and against a realistic 34-person family. It improves simple
 * parent-child registration — the observed Yusuf/Layla case went from
 * 584px to 103px — but regresses cousin-heavy rows and, decisively, the
 * My Family view on realistic data (mean gap 419px to 450px, edges over
 * 250px from 24 to 26). It was rejected for that reason, not for being
 * unsafe: it produced no overlaps and changed no ranks.
 *
 * The reason it cannot work is structural. One offset per row can only
 * fix registration BETWEEN generations; the remaining long edges come
 * from placement WITHIN a row, where several families compete for space
 * and each wants a different position. Compounding it, placement is
 * strictly top-down, so a parent is never positioned relative to its
 * children — for "one parent, four children" the correct answer is to
 * move the parent, which a single downward pass cannot do.
 *
 * A future layout phase should therefore use branch-aware, bidirectional
 * horizontal placement rather than a single row offset — satisfying
 * per-cluster targets, fixed ordering and minimum separations together,
 * letting children influence parents, and widening selectively when a
 * child row is wider than its parent row. Its quality bar should be
 * measured on realistic families in BOTH views: the synthetic fixtures
 * alone would have passed the rejected change.
 */
import { buildFamilyGraph } from '../src/features/tree-view/graphAdapter'
import { computeRanks } from '../src/features/tree-view/rank'
import { projectFamilyGroups } from '../src/features/tree-view/groupProjection'
import { layoutFamilyGraph, nodeWidth, PERSON_NODE_SIZE } from '../src/features/tree-view/layout'
import type { FamilyNode } from '../src/features/tree-view/types'
import type { FamilyGroup, FamilyGroupMember, ParentLink, Person, Union } from '../src/types'

const TREE = 't'
const AT = '2026-01-01T00:00:00.000Z'

const person = (id: string): Person => ({
  id, familyTreeId: TREE, firstName: id, lastName: 'X', gender: 'unknown', createdAt: AT, updatedAt: AT,
})
const link = (id: string, parentId: string, childId: string): ParentLink => ({
  id, familyTreeId: TREE, parentId, childId, relationship: 'biological', createdAt: AT, updatedAt: AT,
})
const union = (id: string, a: string, b: string): Union => ({
  id, familyTreeId: TREE, partnerAId: a, partnerBId: b, status: 'married', createdAt: AT, updatedAt: AT,
})
const group = (id: string): FamilyGroup => ({
  id, familyTreeId: TREE, name: id, establishedPrecision: 'unknown', createdAt: AT, updatedAt: AT,
})
const member = (id: string, g: string, p: string): FamilyGroupMember => ({
  id, familyTreeId: TREE, familyGroupId: g, personId: p, createdAt: AT, updatedAt: AT,
})

interface Fixture {
  name: string
  people: string[]
  links: [string, string][]
  unions: [string, string][]
  groups?: { id: string; members: string[]; collapsed: boolean }[]
}

const FIXTURES: Fixture[] = [
  { name: '1. parent -> child', people: ['p', 'c'], links: [['p', 'c']], unions: [] },
  {
    name: '2. parent -> many children',
    people: ['p', 'c1', 'c2', 'c3', 'c4'],
    links: [['p', 'c1'], ['p', 'c2'], ['p', 'c3'], ['p', 'c4']],
    unions: [],
  },
  {
    name: '3. two parents -> many children',
    people: ['a', 'b', 'c1', 'c2', 'c3'],
    links: [['a', 'c1'], ['b', 'c1'], ['a', 'c2'], ['b', 'c2'], ['a', 'c3'], ['b', 'c3']],
    unions: [['a', 'b']],
  },
  {
    name: '4. half-siblings (two unions)',
    people: ['dad', 'mum', 'other', 'k1', 'k2', 'h1'],
    links: [['dad', 'k1'], ['mum', 'k1'], ['dad', 'k2'], ['mum', 'k2'], ['dad', 'h1'], ['other', 'h1']],
    unions: [['dad', 'mum'], ['dad', 'other']],
  },
  {
    name: '5. asymmetric branches (deep paternal, shallow maternal)',
    people: ['gg', 'g1', 'g2', 'mgm', 'dad', 'mum', 'me'],
    links: [['gg', 'g1'], ['g1', 'dad'], ['g2', 'dad'], ['mgm', 'mum'], ['dad', 'me'], ['mum', 'me']],
    unions: [['g1', 'g2'], ['dad', 'mum']],
  },
  {
    name: '6. cousins across two aunt branches',
    people: ['g1', 'g2', 'dad', 'mum', 'aunt', 'uncle', 'me', 'sib', 'cz1', 'cz2'],
    links: [
      ['g1', 'dad'], ['g2', 'dad'], ['g1', 'aunt'], ['g2', 'aunt'],
      ['dad', 'me'], ['mum', 'me'], ['dad', 'sib'], ['mum', 'sib'],
      ['aunt', 'cz1'], ['uncle', 'cz1'], ['aunt', 'cz2'], ['uncle', 'cz2'],
    ],
    unions: [['g1', 'g2'], ['dad', 'mum'], ['aunt', 'uncle']],
  },
  {
    name: '7. crowded generation (12 cousins across 4 branches)',
    people: [
      'g1', 'g2',
      'b1', 'b1p', 'b2', 'b2p', 'b3', 'b3p', 'b4', 'b4p',
      ...Array.from({ length: 12 }, (_u, i) => `k${i + 1}`),
    ],
    links: [
      ...(['b1', 'b2', 'b3', 'b4'].flatMap((b) => [['g1', b], ['g2', b]]) as [string, string][]),
      ...(Array.from({ length: 12 }, (_u, i) => {
        const branch = `b${Math.floor(i / 3) + 1}`
        return [[branch, `k${i + 1}`], [`${branch}p`, `k${i + 1}`]] as [string, string][]
      }).flat()),
    ],
    unions: [['g1', 'g2'], ['b1', 'b1p'], ['b2', 'b2p'], ['b3', 'b3p'], ['b4', 'b4p']],
  },
  {
    name: '8. the observed long-edge case (niece under a distant parent)',
    // Mirrors the verification fixture: several sibling clusters compete
    // for one row, and one of them has an only child on the row below.
    people: ['gp1', 'gp2', 'dad', 'mum', 'aunt', 'auncle', 'me', 'spouse', 'yusuf', 'fatima', 'kabiru', 'other', 'layla', 'kidA', 'kidB'],
    links: [
      ['gp1', 'dad'], ['gp2', 'dad'], ['gp1', 'aunt'], ['gp2', 'aunt'],
      ['dad', 'me'], ['mum', 'me'], ['dad', 'yusuf'], ['mum', 'yusuf'], ['dad', 'fatima'], ['mum', 'fatima'],
      ['dad', 'kabiru'], ['other', 'kabiru'],
      ['yusuf', 'layla'],
      ['me', 'kidA'], ['spouse', 'kidA'], ['me', 'kidB'], ['spouse', 'kidB'],
    ],
    unions: [['gp1', 'gp2'], ['dad', 'mum'], ['dad', 'other'], ['aunt', 'auncle'], ['me', 'spouse']],
  },
]

const GROUPED: Fixture[] = [
  {
    ...FIXTURES[5] as Fixture,
    name: '9. cousins + ONE collapsed group',
    groups: [{ id: 'gA', members: ['g1', 'g2', 'aunt'], collapsed: true }],
  },
  {
    ...FIXTURES[5] as Fixture,
    name: '10. cousins + TWO collapsed groups',
    groups: [
      { id: 'gA', members: ['g1', 'g2'], collapsed: true },
      { id: 'gB', members: ['aunt', 'uncle', 'cz1'], collapsed: true },
    ],
  },
  {
    ...FIXTURES[5] as Fixture,
    name: '11. cousins + MIXED (one collapsed, one expanded)',
    groups: [
      { id: 'gA', members: ['g1', 'g2'], collapsed: true },
      { id: 'gB', members: ['aunt', 'uncle'], collapsed: false },
    ],
  },
]

function centreX(node: FamilyNode): number {
  return node.position.x + nodeWidth(node) / 2
}

interface Metrics {
  edges: number
  maxParentChildGap: number
  meanParentChildGap: number
  gapsOver250: number
  gapsOver400: number
  crossings: number
  overlaps: number
  width: number
  rows: number
  widestRow: number
}

function measure(nodes: FamilyNode[], edges: { source: string; target: string; data?: unknown }[]): Metrics {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Parent-child gaps, measured against whatever the edge actually joins —
  // a parent, or the junction standing in for both.
  const gaps: number[] = []
  for (const edge of edges) {
    const kind = (edge.data as { kind?: string } | undefined)?.kind
    if (kind !== 'parentChild') continue
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (!from || !to) continue
    gaps.push(Math.abs(centreX(to) - centreX(from)))
  }

  // Segment-crossing count between edges on different (source,target) pairs.
  const segments = edges
    .map((edge) => {
      const from = byId.get(edge.source)
      const to = byId.get(edge.target)
      if (!from || !to) return null
      return { x1: centreX(from), y1: from.position.y, x2: centreX(to), y2: to.position.y }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (cy - ay) * (bx - ax) > (by - ay) * (cx - ax)
  let crossings = 0
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const p = segments[i] as NonNullable<(typeof segments)[number]>
      const q = segments[j] as NonNullable<(typeof segments)[number]>
      if (
        ccw(p.x1, p.y1, q.x1, q.y1, q.x2, q.y2) !== ccw(p.x2, p.y2, q.x1, q.y1, q.x2, q.y2) &&
        ccw(p.x1, p.y1, p.x2, p.y2, q.x1, q.y1) !== ccw(p.x1, p.y1, p.x2, p.y2, q.x2, q.y2)
      ) {
        crossings += 1
      }
    }
  }

  // Overlaps within a row.
  let overlaps = 0
  const rows = new Map<number, FamilyNode[]>()
  for (const node of nodes) {
    const list = rows.get(node.position.y) ?? []
    list.push(node)
    rows.set(node.position.y, list)
  }
  for (const list of rows.values()) {
    const sorted = [...list].sort((a, b) => a.position.x - b.position.x)
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1] as FamilyNode
      const cur = sorted[i] as FamilyNode
      if (prev.position.x + nodeWidth(prev) > cur.position.x + 0.001) overlaps += 1
    }
  }

  const lefts = nodes.map((n) => n.position.x)
  const rights = nodes.map((n) => n.position.x + nodeWidth(n))

  return {
    edges: edges.length,
    maxParentChildGap: gaps.length ? Math.round(Math.max(...gaps)) : 0,
    meanParentChildGap: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 0,
    gapsOver250: gaps.filter((g) => g > 250).length,
    gapsOver400: gaps.filter((g) => g > 400).length,
    crossings,
    overlaps,
    width: Math.round(Math.max(...rights) - Math.min(...lefts)),
    rows: rows.size,
    widestRow: Math.max(...[...rows.values()].map((r) => r.length)),
  }
}

async function run(fixture: Fixture) {
  const people = fixture.people.map(person)
  const parentLinks = fixture.links.map(([p, c], i) => link(`l${i}`, p, c))
  const unions = fixture.unions.map(([a, b], i) => union(`u${i}`, a, b))
  const graph = buildFamilyGraph(people, parentLinks, unions)
  const ranks = computeRanks(graph.nodes, graph.edges)

  const groups = (fixture.groups ?? []).map((g) => group(g.id))
  const members = (fixture.groups ?? []).flatMap((g) =>
    g.members.map((p, i) => member(`${g.id}-${i}`, g.id, p)),
  )
  const collapsed = new Set((fixture.groups ?? []).filter((g) => g.collapsed).map((g) => g.id))

  const projected = projectFamilyGroups(graph, groups, members, collapsed, ranks)
  const positioned = await layoutFamilyGraph(projected.nodes, projected.edges, projected.ranks)

  return { metrics: measure(positioned, projected.edges), positioned, ranks: projected.ranks }
}

const label = process.argv[2] ?? 'current'
const results: Record<string, Metrics> = {}
const rankSnapshot: Record<string, Record<string, number>> = {}

for (const fixture of [...FIXTURES, ...GROUPED]) {
  const { metrics, ranks } = await run(fixture)
  results[fixture.name] = metrics
  rankSnapshot[fixture.name] = Object.fromEntries([...ranks].sort())
}

console.log(JSON.stringify({ label, nodeWidth: PERSON_NODE_SIZE.width, results, rankSnapshot }, null, 2))
