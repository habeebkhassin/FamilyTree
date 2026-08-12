// Pure, like the reconciler and the policy engine: no fake-indexeddb, no
// browser environment. If this file ever needs one, something has leaked.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  popFocusHistory,
  pruneFocusHistory,
  pushFocusHistory,
  resolveFocalPerson,
} from './focalPerson'
import type { PersonClaim, PersonClaimStatus } from './policy/membershipTypes'

const TREE = 'tree-1'
const AT = '2026-06-01T00:00:00.000Z'

let counter = 0
function claim(actorId: string, personId: string, status: PersonClaimStatus): PersonClaim {
  return {
    id: `claim-${++counter}`,
    familyTreeId: TREE,
    personId,
    actorId,
    subjectKind: 'localActor',
    status,
    createdAt: AT,
    updatedAt: AT,
  }
}

const live = (...ids: string[]) => new Set(ids)

// ── Resolution priority ──────────────────────────────────────────────

test('1. an explicit session choice wins over everything else', () => {
  const result = resolveFocalPerson({
    explicitPersonId: 'p1',
    storedPersonId: 'p2',
    claims: [claim('actor-a', 'p3', 'verified')],
    actorId: 'actor-a',
    livePersonIds: live('p1', 'p2', 'p3'),
  })
  assert.deepEqual(result, { personId: 'p1', source: 'explicit', stalePersonId: null })
})

test('2. a stored preference wins over a claim', () => {
  const result = resolveFocalPerson({
    storedPersonId: 'p2',
    claims: [claim('actor-a', 'p3', 'verified')],
    actorId: 'actor-a',
    livePersonIds: live('p2', 'p3'),
  })
  assert.equal(result.personId, 'p2')
  assert.equal(result.source, 'stored')
})

test('3. a verified claim is preferred over a self-asserted one', () => {
  const result = resolveFocalPerson({
    claims: [claim('actor-a', 'p9', 'selfAsserted'), claim('actor-a', 'p4', 'verified')],
    actorId: 'actor-a',
    livePersonIds: live('p4', 'p9'),
  })
  assert.equal(result.personId, 'p4')
  assert.equal(result.source, 'verifiedClaim')
})

test('4. a self-asserted claim is used when nothing better exists', () => {
  const result = resolveFocalPerson({
    claims: [claim('actor-a', 'p5', 'selfAsserted')],
    actorId: 'actor-a',
    livePersonIds: live('p5'),
  })
  assert.equal(result.personId, 'p5')
  assert.equal(result.source, 'selfAssertedClaim', 'and it is labelled as unverified')
})

test('5. a rejected claim grants no viewpoint', () => {
  const result = resolveFocalPerson({
    claims: [claim('actor-a', 'p6', 'rejected')],
    actorId: 'actor-a',
    livePersonIds: live('p6'),
  })
  assert.equal(result.personId, null)
  assert.equal(result.source, 'none')
})

test('6. claims belonging to another subject are ignored', () => {
  const result = resolveFocalPerson({
    claims: [claim('actor-b', 'p7', 'verified')],
    actorId: 'actor-a',
    livePersonIds: live('p7'),
  })
  assert.equal(result.source, 'none')
})

test('7. with no identity at all, claims cannot be used', () => {
  const result = resolveFocalPerson({
    claims: [claim('actor-a', 'p8', 'verified')],
    actorId: null,
    livePersonIds: live('p8'),
  })
  assert.equal(result.personId, null)
})

// ── The ungoverned case: every tree that exists today ────────────────

test('8. a tree with no claims and no identity still supports an explicit choice', () => {
  const result = resolveFocalPerson({
    explicitPersonId: 'p1',
    livePersonIds: live('p1', 'p2'),
  })
  assert.deepEqual(result, { personId: 'p1', source: 'explicit', stalePersonId: null })
})

test('9. an untouched tree resolves to nobody, so the caller can ask', () => {
  const result = resolveFocalPerson({ livePersonIds: live('p1', 'p2') })
  assert.deepEqual(result, { personId: null, source: 'none', stalePersonId: null })
})

test('10. an empty tree resolves to nobody without throwing', () => {
  assert.equal(resolveFocalPerson({ livePersonIds: live() }).personId, null)
})

// ── Stale and invalid candidates ─────────────────────────────────────

test('11. a stored id naming someone who no longer exists is reported as stale', () => {
  const result = resolveFocalPerson({
    storedPersonId: 'deleted-person',
    livePersonIds: live('p1'),
  })
  assert.equal(result.personId, null)
  assert.equal(result.source, 'none')
  assert.equal(result.stalePersonId, 'deleted-person', 'so the caller can clear the preference')
})

test('12. an empty tree is never treated as evidence that a stored person was deleted', () => {
  // The bug this pins: while the graph loads, `people` is empty, which is
  // indistinguishable from "everyone was deleted". Reporting staleness
  // there once wiped the saved viewpoint on every single reload. The
  // resolver is honest about it — an empty tree DOES make the id stale —
  // so the caller must not ask until the data has arrived. Guarding that
  // is the caller's job, and this records why.
  const duringLoad = resolveFocalPerson({ storedPersonId: 'p1', livePersonIds: live() })
  assert.equal(duringLoad.stalePersonId, 'p1')

  const afterLoad = resolveFocalPerson({ storedPersonId: 'p1', livePersonIds: live('p1') })
  assert.equal(afterLoad.stalePersonId, null)
  assert.equal(afterLoad.personId, 'p1', 'and the viewpoint comes back intact')
})

test('13. a stale stored id falls through to a claim, and is still reported', () => {
  const result = resolveFocalPerson({
    storedPersonId: 'deleted-person',
    claims: [claim('actor-a', 'p3', 'verified')],
    actorId: 'actor-a',
    livePersonIds: live('p3'),
  })
  assert.equal(result.personId, 'p3')
  assert.equal(result.source, 'verifiedClaim')
  assert.equal(result.stalePersonId, 'deleted-person', 'clearing it is still worth doing')
})

test('14. a deleted person cannot remain the viewpoint by any route', () => {
  const gone = live('someone-else')
  for (const input of [
    { explicitPersonId: 'deleted' },
    { storedPersonId: 'deleted' },
    { claims: [claim('a', 'deleted', 'verified')], actorId: 'a' },
    { claims: [claim('a', 'deleted', 'selfAsserted')], actorId: 'a' },
  ]) {
    assert.equal(resolveFocalPerson({ ...input, livePersonIds: gone }).personId, null)
  }
})

test('15. an explicit choice that has gone falls back rather than sticking', () => {
  const result = resolveFocalPerson({
    explicitPersonId: 'deleted',
    storedPersonId: 'p2',
    livePersonIds: live('p2'),
  })
  assert.equal(result.personId, 'p2')
  assert.equal(result.source, 'stored')
})

test('16. several claims of one status resolve deterministically', () => {
  const claims = [claim('a', 'p-zeta', 'verified'), claim('a', 'p-alpha', 'verified')]
  const forwards = resolveFocalPerson({ claims, actorId: 'a', livePersonIds: live('p-alpha', 'p-zeta') })
  const backwards = resolveFocalPerson({
    claims: [...claims].reverse(), actorId: 'a', livePersonIds: live('p-alpha', 'p-zeta'),
  })
  assert.deepEqual(forwards, backwards)
  assert.equal(forwards.personId, 'p-alpha')
})

// ── Focus history ────────────────────────────────────────────────────

test('17. focusing records the trail in the order it was walked', () => {
  let history: string[] = []
  for (const personId of ['you', 'aisha', 'ibrahim']) history = pushFocusHistory(history, personId)
  assert.deepEqual(history, ['you', 'aisha', 'ibrahim'])
})

test('18. re-focusing the current person is not a move', () => {
  const history = pushFocusHistory(pushFocusHistory([], 'you'), 'you')
  assert.deepEqual(history, ['you'], 'the trail does not grow')
})

test('19. returning to an earlier person is a new step, not a rewind', () => {
  let history = pushFocusHistory(pushFocusHistory([], 'you'), 'aisha')
  history = pushFocusHistory(history, 'you')
  assert.deepEqual(history, ['you', 'aisha', 'you'], 'the path taken is what is recorded')
})

test('20. the trail is capped, keeping the most recent steps', () => {
  let history: string[] = []
  for (let index = 0; index < 12; index += 1) history = pushFocusHistory(history, `p${index}`, 5)
  assert.equal(history.length, 5)
  assert.deepEqual(history, ['p7', 'p8', 'p9', 'p10', 'p11'])
})

test('21. stepping back returns the previous focus', () => {
  const history = ['you', 'aisha', 'ibrahim']
  const back = popFocusHistory(history)
  assert.deepEqual(back, { history: ['you', 'aisha'], personId: 'aisha' })

  const again = popFocusHistory(back.history)
  assert.deepEqual(again, { history: ['you'], personId: 'you' })
})

test('22. stepping back from the start of the trail clears it', () => {
  assert.deepEqual(popFocusHistory(['you']), { history: [], personId: null })
  assert.deepEqual(popFocusHistory([]), { history: [], personId: null })
})

test('23. deleted people are pruned from the trail without breaking it', () => {
  const history = ['you', 'deleted', 'ibrahim']
  assert.deepEqual(pruneFocusHistory(history, live('you', 'ibrahim')), ['you', 'ibrahim'])
})

test('24. pruning collapses the repeats it creates', () => {
  // Removing the middle step would otherwise leave "you › you".
  assert.deepEqual(pruneFocusHistory(['you', 'gone', 'you'], live('you')), ['you'])
})

test('25. pruning everything leaves an empty trail rather than a broken one', () => {
  assert.deepEqual(pruneFocusHistory(['a', 'b'], live()), [])
})

test('26. none of the history helpers mutate what they are given', () => {
  const original = Object.freeze(['you', 'aisha'])
  pushFocusHistory(original, 'ibrahim')
  popFocusHistory(original)
  pruneFocusHistory(original, live('you'))
  assert.deepEqual(original, ['you', 'aisha'])
})
