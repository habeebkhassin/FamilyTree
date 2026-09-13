import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRelationshipEngine } from '../../lib/relationships/deriveRelationships'
import type { ParentLink, Person, Union } from '../../types'
import { suggestRelatives } from './suggestedRelatives'

const AT = '2026-01-01T00:00:00.000Z'

function person(id: string): Person {
  return {
    id,
    familyTreeId: 't',
    firstName: id,
    lastName: 'Test',
    gender: 'unknown',
    createdAt: AT,
    updatedAt: AT,
  }
}

function link(id: string, parentId: string, childId: string): ParentLink {
  return {
    id,
    familyTreeId: 't',
    parentId,
    childId,
    relationship: 'biological',
    createdAt: AT,
    updatedAt: AT,
  }
}

function union(id: string, a: string, b: string): Union {
  return {
    id,
    familyTreeId: 't',
    partnerAId: a,
    partnerBId: b,
    status: 'married',
    createdAt: AT,
    updatedAt: AT,
  }
}

/**
 *   grandad
 *      |
 *    mum — dad          (mum and dad are partners)
 *   /   |    \
 * me  sister  brother
 *  |
 * kid
 *
 * plus `stranger`, who is in the tree and related to nobody here.
 */
const PEOPLE = ['me', 'mum', 'dad', 'sister', 'brother', 'kid', 'grandad', 'stranger'].map(person)
const LINKS = [
  link('l1', 'mum', 'me'),
  link('l2', 'dad', 'me'),
  link('l3', 'mum', 'sister'),
  link('l4', 'dad', 'sister'),
  link('l5', 'mum', 'brother'),
  link('l6', 'dad', 'brother'),
  link('l7', 'me', 'kid'),
  link('l8', 'grandad', 'mum'),
]
const UNIONS = [union('u1', 'mum', 'dad'), union('u2', 'me', 'spouse-missing')]

const engine = createRelationshipEngine(PEOPLE, LINKS, UNIONS)
const candidates = PEOPLE.filter((p) => p.id !== 'me')

test('offers only a handful, never the whole family', () => {
  const suggested = suggestRelatives('me', engine, candidates, 5)
  assert.equal(suggested.length, 5)
  assert.ok(suggested.length < candidates.length, 'the family is larger than the suggestion list')
})

test('the closest people come first', () => {
  const ids = suggestRelatives('me', engine, candidates, 5).map((p) => p.id)
  // Parents before siblings; the anchor is never offered themselves.
  assert.ok(ids.indexOf('mum') < ids.indexOf('sister'), 'a parent outranks a sibling')
  assert.ok(ids.includes('kid'), 'a child is in the immediate circle')
  assert.ok(!ids.includes('me'), 'you are never your own relative')
})

test('reaches one step further only once the immediate circle runs out', () => {
  // Five immediate relatives, so a list of five never has to widen.
  const tight = suggestRelatives('me', engine, candidates, 5).map((p) => p.id)
  assert.ok(!tight.includes('grandad'), 'the closest people fill the list first')

  // Room to spare, so the branch around them is reached.
  const wider = suggestRelatives('me', engine, candidates, 8).map((p) => p.id)
  assert.ok(wider.includes('grandad'), 'a grandparent is reached by widening the search')
})

test('never fills the space with unrelated people', () => {
  const ids = suggestRelatives('me', engine, candidates, 8).map((p) => p.id)
  assert.ok(!ids.includes('stranger'), 'somebody related to nobody is not offered')
})

test('a person with no relatives at all gets no suggestions', () => {
  const suggested = suggestRelatives('stranger', engine, candidates, 5)
  assert.deepEqual(suggested, [], 'the search field is the only way in, rather than a random list')
})

test('only offerable people are returned', () => {
  const justMum = PEOPLE.filter((p) => p.id === 'mum')
  const ids = suggestRelatives('me', engine, justMum, 5).map((p) => p.id)
  assert.deepEqual(ids, ['mum'])
})

test('no duplicates, however many ways two people are related', () => {
  const ids = suggestRelatives('me', engine, candidates, 8).map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})
