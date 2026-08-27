import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NullRemoteAdapter, type RemoteAdapter } from './remoteAdapter'
import type { ChangeEvent } from './changeTypes'

/**
 * The seam's contract — Phase A.
 *
 * There is no server, so there is nothing here about networks. What these
 * check is that the seam stays the shape the existing synchronisation
 * model needs, and that the no-server case is honest rather than
 * silently successful.
 */

const AT = '2026-01-01T00:00:00.000Z'
const event = (id: string): ChangeEvent => ({
  clientSeq: 1,
  id,
  changeSetId: 'cs-1',
  familyTreeId: 't1',
  actorId: 'actor-1',
  entity: 'person',
  entityId: 'p1',
  op: 'create',
  before: null,
  after: {
    id: 'p1', familyTreeId: 't1', firstName: 'Rose', lastName: 'Hale',
    gender: 'female', createdAt: AT, updatedAt: AT,
  },
  createdAt: AT,
  serverSeq: null,
  recordedAt: null,
})

test('1. the null adapter reports no trees rather than inventing one', async () => {
  const adapter: RemoteAdapter = new NullRemoteAdapter()
  assert.deepEqual(await adapter.listTrees(), [])
})

test('2. bootstrapping without a server yields nothing, and a null cursor', async () => {
  const adapter: RemoteAdapter = new NullRemoteAdapter()
  const result = await adapter.bootstrap('t1')

  assert.deepEqual(result.records, [])
  // Null, not zero. Zero would be a position the tree had reached; null is
  // the absence of one, which is what SyncState already means by it.
  assert.equal(result.cursor.lastServerSeq, null)
})

test('3. pulling without a server yields nothing and does not claim more', async () => {
  const adapter: RemoteAdapter = new NullRemoteAdapter()
  const result = await adapter.pull('t1', { lastServerSeq: null })

  assert.deepEqual(result.events, [])
  assert.equal(result.hasMore, false)
  assert.equal(result.cursor.lastServerSeq, null)
})

test('4. pushing without a server REJECTS, and never reports success', async () => {
  // The property that matters most here. An adapter that accepted events
  // into nowhere would let a caller clear its outbox and lose them.
  const adapter: RemoteAdapter = new NullRemoteAdapter()
  const events = [event('e1'), event('e2')]
  const result = await adapter.push('t1', events)

  assert.deepEqual(result.accepted, [], 'nothing is accepted')
  assert.equal(result.rejected.length, 2, 'every event is reported back')
  assert.deepEqual(result.rejected.map((r) => r.eventId).sort(), ['e1', 'e2'])
  for (const rejection of result.rejected) {
    assert.ok(rejection.reason.length > 0, 'and says why')
  }
})

test('5. pushing nothing is not an error', async () => {
  const adapter: RemoteAdapter = new NullRemoteAdapter()
  const result = await adapter.push('t1', [])
  assert.deepEqual(result.accepted, [])
  assert.deepEqual(result.rejected, [])
})

test('6. the seam knows nothing about any vendor, protocol or transport', () => {
  // The one rule this file exists to protect. If a future implementation
  // needs an SDK, it lives behind the interface, not in it.
  const source = readFileSync(fileURLToPath(new URL('./remoteAdapter.ts', import.meta.url)), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  for (const forbidden of [
    'supabase', 'firebase', 'google', 'oauth', 'fetch(', 'axios',
    'XMLHttpRequest', 'WebSocket', 'http://', 'https://', 'localStorage', 'indexedDB',
  ]) {
    assert.equal(
      code.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      'the seam must not mention ' + forbidden,
    )
  }
  // No imports at all beyond the event vocabulary it speaks in.
  const runtimeImports = [...source.matchAll(/^import (?!type )(.+?) from '(.+?)'/gm)]
  assert.equal(runtimeImports.length, 0, 'type-only imports; nothing is pulled in at runtime')
})

test('7. the seam speaks the vocabulary lib/sync already has', () => {
  const source = readFileSync(fileURLToPath(new URL('./remoteAdapter.ts', import.meta.url)), 'utf8')

  // Built on the existing model rather than a second one: events, the
  // server sequence the reconciler orders by, and the records a bootstrap
  // materialises.
  for (const term of ['ChangeEvent', 'serverSeq', 'SyncRecord', 'SyncEntity']) {
    assert.ok(source.includes(term), 'expected the seam to be defined in terms of ' + term)
  }
  // And not a competing one.
  for (const term of ['interface Conflict', 'resolveConflict', 'merge(']) {
    assert.equal(source.includes(term), false, 'conflict resolution belongs to reconciler.ts, not here')
  }
})

test('8. any implementation satisfying the interface is substitutable', async () => {
  // A second implementation, to prove the interface is an interface and
  // not a description of NullRemoteAdapter.
  class RecordingAdapter implements RemoteAdapter {
    pushed: ChangeEvent[] = []
    async listTrees() {
      return [{ familyTreeId: 't1', name: 'Hale Family' }]
    }
    async bootstrap() {
      return { records: [], cursor: { lastServerSeq: 7 } }
    }
    async pull() {
      return { events: [], cursor: { lastServerSeq: 7 }, hasMore: false }
    }
    async push(_familyTreeId: string, events: ChangeEvent[]) {
      this.pushed.push(...events)
      // What a real server does: hands back the sequence it assigned.
      return {
        accepted: events.map((e, i) => ({ ...e, serverSeq: 8 + i, recordedAt: AT })),
        rejected: [],
      }
    }
  }

  const adapter: RemoteAdapter = new RecordingAdapter()
  assert.equal((await adapter.listTrees()).length, 1)
  assert.equal((await adapter.bootstrap('t1')).cursor.lastServerSeq, 7)

  const result = await adapter.push('t1', [event('e1')])
  assert.equal(result.accepted[0]?.serverSeq, 8, 'the server assigns the sequence, not the client')
  assert.equal(result.accepted[0]?.id, 'e1', 'and the client id is what identifies the event')
})
