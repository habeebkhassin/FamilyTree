import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collapseSharedDescent } from './descentEdges'
import type { FamilyEdge } from './types'

function descent(
  id: string,
  source: string,
  target: string,
  extra: Partial<FamilyEdge> = {},
): FamilyEdge {
  return {
    id,
    source,
    target,
    data: {
      kind: 'parentChild',
      parentLinkId: id,
      parentId: source,
      childId: target,
      relationship: 'biological',
    },
    ...extra,
  } as FamilyEdge
}

test('two ParentLinks through one union marker draw a single line', () => {
  const drawn = collapseSharedDescent([
    descent('l-a', 'junction:u1', 'child'),
    descent('l-b', 'junction:u1', 'child'),
  ])

  assert.equal(drawn.length, 1)
  assert.equal(drawn[0]?.id, 'l-a')
  assert.deepEqual(drawn[0]?.data?.mergedParentLinkIds, ['l-a', 'l-b'])
})

test('both links survive when the two facts are drawn differently', () => {
  const adopted = descent('l-b', 'junction:u1', 'child', { label: 'Adopted' })
  ;(adopted.data as Record<string, unknown>).relationship = 'adopted'

  const drawn = collapseSharedDescent([descent('l-a', 'junction:u1', 'child'), adopted])

  assert.equal(drawn.length, 2, 'an adopted link must not be swallowed by a biological one')
})

test('different children keep their own lines', () => {
  const drawn = collapseSharedDescent([
    descent('l-a', 'junction:u1', 'one'),
    descent('l-b', 'junction:u1', 'two'),
  ])
  assert.equal(drawn.length, 2)
})

test('two parents with no union between them stay two branches', () => {
  const drawn = collapseSharedDescent([
    descent('l-a', 'mother', 'child'),
    descent('l-b', 'father', 'child'),
  ])
  assert.equal(drawn.length, 2)
})

test('union segments pass through untouched', () => {
  const segment = {
    id: 'u1#a',
    source: 'a',
    target: 'junction:u1',
    data: { kind: 'unionSegment' },
  } as FamilyEdge

  assert.equal(collapseSharedDescent([segment, segment]).length, 2, 'only descent is collapsed')
})

test('the input edges are not mutated', () => {
  const first = descent('l-a', 'junction:u1', 'child')
  const second = descent('l-b', 'junction:u1', 'child')
  collapseSharedDescent([first, second])

  assert.equal(
    (first.data as Record<string, unknown>).mergedParentLinkIds,
    undefined,
    'the caller keeps the graph it handed in',
  )
})
