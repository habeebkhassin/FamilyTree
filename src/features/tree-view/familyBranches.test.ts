// Pure: no fake-indexeddb, no browser environment.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRelationshipEngine } from '../../lib/relationships/deriveRelationships'
import type { ParentLink, Person, Union } from '../../types'
import {
  collapsibleBranches,
  descendantsOf,
  focusRegion,
  qualifiesAsFamilyBranch,
} from './familyBranches'

/**
 * Which families the tree may fold into a card.
 *
 * The rule that matters is the restraint. "Every married person with
 * relatives becomes a family card" is not a family tree, and the tests
 * that keep it from becoming one are the ones about focus: the household
 * somebody is currently exploring must survive intact, including when
 * one of ITS members would qualify on their own.
 */

const TREE = 'tree-1'
const AT = '2026-01-01T00:00:00.000Z'

const person = (id: string): Person => ({
  id, familyTreeId: TREE, firstName: id, lastName: 'W', gender: 'unknown', createdAt: AT, updatedAt: AT,
})
const link = (id: string, parentId: string, childId: string): ParentLink => ({
  id, familyTreeId: TREE, parentId, childId, relationship: 'biological', createdAt: AT, updatedAt: AT,
})
const union = (id: string, a: string, b: string): Union => ({
  id, familyTreeId: TREE, partnerAId: a, partnerBId: b, status: 'married', createdAt: AT, updatedAt: AT,
})

/**
 *   ahmed ══ fatima
 *      ├───────────┬──────────┐
 *   hassan ══ sameera      ali ══ nadia     omar (single)
 *      │                     │
 *   habeeb  sana           yusuf
 *
 * hassan and ali both qualify: married, a parent, a sibling, children.
 * omar never does. sameera and nadia married in and have no parent or
 * sibling recorded here.
 */
const PEOPLE = ['ahmed', 'fatima', 'hassan', 'sameera', 'ali', 'nadia', 'omar', 'habeeb', 'sana', 'yusuf'].map(person)
const LINKS = [
  link('l1', 'ahmed', 'hassan'), link('l2', 'fatima', 'hassan'),
  link('l3', 'ahmed', 'ali'), link('l4', 'fatima', 'ali'),
  link('l5', 'ahmed', 'omar'), link('l6', 'fatima', 'omar'),
  link('l7', 'hassan', 'habeeb'), link('l8', 'sameera', 'habeeb'),
  link('l9', 'hassan', 'sana'), link('l10', 'sameera', 'sana'),
  link('l11', 'ali', 'yusuf'), link('l12', 'nadia', 'yusuf'),
]
const UNIONS = [
  union('u1', 'ahmed', 'fatima'),
  union('u2', 'hassan', 'sameera'),
  union('u3', 'ali', 'nadia'),
]

const engine = createRelationshipEngine(PEOPLE, LINKS, UNIONS)
const ALL = PEOPLE.map((p) => p.id)
const roots = (focal: string | null) =>
  collapsibleBranches(ALL, engine, focal).map((branch) => branch.rootPersonId).sort()

// ── qualifying ──────────────────────────────────────────────────────

test('a married person with a parent and a sibling is a family branch', () => {
  assert.equal(qualifiesAsFamilyBranch('hassan', engine), true)
  assert.equal(qualifiesAsFamilyBranch('ali', engine), true)
})

test('an unmarried person is not a branch, however many relatives they have', () => {
  // omar has both parents and two siblings, and no marriage.
  assert.equal(engine.getParents('omar').length, 2)
  assert.equal(engine.getSiblings('omar').length > 0, true)
  assert.equal(qualifiesAsFamilyBranch('omar', engine), false)
})

test('a married person with no parents is not a branch', () => {
  // ahmed is married with children, but he is the root of this tree.
  assert.equal(engine.getParents('ahmed').length, 0)
  assert.equal(qualifiesAsFamilyBranch('ahmed', engine), false)
})

test('a married person with no siblings is not a branch', () => {
  // sameera married in: no parent and no sibling recorded here.
  assert.equal(engine.getSiblings('sameera').length, 0)
  assert.equal(engine.getHalfSiblings('sameera').length, 0)
  assert.equal(qualifiesAsFamilyBranch('sameera', engine), false)
})

test('a married person with nobody under them is not a branch', () => {
  /*
    A card standing for an empty family would hide nothing and put a
    family where there is only a couple.
  */
  const childless = createRelationshipEngine(
    [person('a'), person('b'), person('c'), person('d')],
    [link('x1', 'a', 'c'), link('x2', 'a', 'd')],
    [union('x3', 'c', 'b')],
  )
  assert.equal(childless.getPartners('c').length, 1)
  assert.equal(childless.getParents('c').length, 1)
  assert.equal(childless.getHalfSiblings('c').length, 1, 'one shared parent, so a half-sibling')
  assert.equal(childless.getChildren('c').length, 0)
  assert.equal(qualifiesAsFamilyBranch('c', childless), false)
})

// ── focus ───────────────────────────────────────────────────────────

test('the focused person is never folded away', () => {
  assert.ok(!roots('hassan').includes('hassan'))
})

test('the focused household stays whole', () => {
  const region = focusRegion('hassan', engine)
  for (const id of ['hassan', 'sameera', 'ahmed', 'fatima', 'ali', 'omar', 'habeeb', 'sana']) {
    assert.ok(region.has(id), `${id} should be in the focus region`)
  }
  // And nobody in it is hidden by somebody else's card.
  const hidden = new Set(
    collapsibleBranches(ALL, engine, 'hassan').flatMap((b) => [...b.hiddenPersonIds]),
  )
  for (const id of region) assert.ok(!hidden.has(id), `${id} was folded away`)
})

test('a branch that would swallow the focused person is left alone', () => {
  /*
    The subtle one. With yusuf focused, his father ali qualifies on every
    count — and folding ali would hide yusuf, who is the whole reason the
    tree is framed where it is.
  */
  assert.equal(qualifiesAsFamilyBranch('ali', engine), true)
  assert.ok(!roots('yusuf').includes('ali'))
})

test('branches outside the focus are still folded', () => {
  // Focused on yusuf, hassan's family is somewhere else entirely.
  assert.deepEqual(roots('yusuf'), ['hassan'])
})

test('with nobody focused, every qualifying branch may fold', () => {
  assert.deepEqual(roots(null), ['ali', 'hassan'])
})

test('a branch inside another branch does not become a second card', () => {
  //   a ══ b
  //     ├── c ══ d        (qualifies)
  //     └── e
  //          c's child f ══ g, with sibling — would qualify inside c
  const deep = createRelationshipEngine(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(person),
    [
      link('d1', 'a', 'c'), link('d2', 'a', 'e'),
      link('d3', 'c', 'f'), link('d4', 'c', 'h'),
      link('d5', 'f', 'i'),
    ],
    [union('d6', 'a', 'b'), union('d7', 'c', 'd'), union('d8', 'f', 'g')],
  )
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
  assert.equal(qualifiesAsFamilyBranch('c', deep), true)
  assert.equal(qualifiesAsFamilyBranch('f', deep), true, 'f qualifies on its own')
  assert.deepEqual(
    collapsibleBranches(ids, deep, null).map((b) => b.rootPersonId),
    ['c'],
    'but it is inside c, so only the outermost folds',
  )
})

// ── what a card stands for ──────────────────────────────────────────

test('a card stands for the descendants, and never for the person', () => {
  const [branch] = collapsibleBranches(ALL, engine, 'yusuf')
  assert.ok(branch)
  assert.equal(branch.rootPersonId, 'hassan')
  assert.deepEqual([...branch.hiddenPersonIds].sort(), ['habeeb', 'sana'])
  assert.ok(!branch.hiddenPersonIds.has('hassan'), 'the person keeps their own card')
  assert.ok(!branch.hiddenPersonIds.has('sameera'), 'and so does their spouse')
})

test('descendants are followed all the way down', () => {
  assert.deepEqual([...descendantsOf('ahmed', engine)].sort(), [
    'ali', 'habeeb', 'hassan', 'omar', 'sana', 'yusuf',
  ])
  assert.equal(descendantsOf('habeeb', engine).size, 0)
})

test('no focal person means nothing is protected', () => {
  assert.equal(focusRegion(null, engine).size, 0)
  assert.equal(focusRegion(undefined, engine).size, 0)
})
