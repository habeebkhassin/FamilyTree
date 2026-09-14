import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, before, after } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

/**
 * The server half of synchronisation, against real Postgres.
 *
 * The boundary under test is the one that has to be right: for an
 * accepted event, the authorisation check, the event row, the serverSeq
 * and the canonical mutation all happen together or not at all. Every
 * test below is really asking one of two questions — did those four stay
 * in step, and does the server apply exactly what the client reconciler
 * applies.
 */

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const TREE = 'aaaaaaaa-0000-0000-0000-000000000001'
const GRACE = 'bbbbbbbb-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000002'
const AT = '2026-01-01T00:00:00.000Z'

let db: PGlite

const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin;
  create role anon nologin;
`

async function asUser<T>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin')
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    await db.exec('set local role authenticated')
    const result = await db.query<T>(sql, params)
    await db.exec('commit')
    return result.rows
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

async function refused(uid: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await asUser(uid, sql, params)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  assert.fail(`expected a refusal: ${sql}`)
}

interface PushRow {
  event_id: string
  status: string
  server_seq: string | null
  recorded_at: string | null
  reason: string | null
}

/** One event, shaped exactly as the application writes them. */
function event(
  id: string,
  entity: string,
  entityId: string,
  op: string,
  before: unknown,
  after: unknown,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    familyTreeId: TREE,
    changeSetId: '99999999-0000-0000-0000-000000000001',
    actorId: 'local-actor-1',
    entity,
    entityId,
    op,
    before,
    after,
    createdAt: AT,
    basedOnServerSeq: null,
    ...extra,
  }
}

const person = (over: Record<string, unknown> = {}) => ({
  id: GRACE,
  familyTreeId: TREE,
  firstName: 'Grace',
  lastName: 'Okafor',
  gender: 'female',
  createdAt: AT,
  updatedAt: AT,
  ...over,
})

const push = (uid: string, events: unknown[]) =>
  asUser<PushRow>(uid, `select * from public.push_change_events($1::uuid, $2::jsonb)`, [
    TREE,
    JSON.stringify(events),
  ])

before(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_SHIM)
  for (const file of ['0001_cloud_trees.sql', '0002_change_events.sql', '0003_sharing.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }

  await db.query(`insert into auth.users (id, email) values ($1,'a@example.com'),($2,'b@example.com')`, [A, B])
  await asUser(A, `select public.ensure_profile('Ayesha')`)
  await asUser(B, `select public.ensure_profile('Bilal')`)
  await asUser(A, `select public.adopt_family_tree($1::jsonb)`, [
    JSON.stringify({
      familyTree: { id: TREE, name: 'Okafor Family', createdAt: AT, updatedAt: AT },
      people: [person(), { ...person(), id: SAM, firstName: 'Sam', gender: 'male' }],
    }),
  ])
})

after(async () => {
  await db.close()
})

// ── serverSeq is the server's ───────────────────────────────────────

test('the server assigns a strictly increasing sequence', async () => {
  const first = await push(A, [
    event('e0000000-0000-0000-0000-000000000001', 'person', GRACE, 'update', person(), person({ notes: 'one' })),
  ])
  const second = await push(A, [
    event('e0000000-0000-0000-0000-000000000002', 'person', GRACE, 'update', person({ notes: 'one' }), person({ notes: 'two' })),
  ])

  assert.equal(first[0]?.status, 'accepted')
  assert.equal(second[0]?.status, 'accepted')
  assert.ok(
    Number(second[0]?.server_seq) > Number(first[0]?.server_seq),
    'later events get higher sequences',
  )
  assert.ok(first[0]?.recorded_at, 'the server stamps its own clock')
})

test('a client cannot manufacture a sequence, a time, or another account', async () => {
  // No insert grant and no insert policy: the only way in is the function.
  const direct = await refused(
    A,
    `insert into public.change_events (id, tree_id, change_set_id, account_id, entity, entity_id, op, created_at)
     values (gen_random_uuid(), $1, gen_random_uuid(), $2, 'person', $3, 'update', now())`,
    [TREE, A, GRACE],
  )
  assert.match(direct, /permission denied|row-level security/i)

  // Values supplied in the payload are ignored; the server uses its own.
  const pushed = await push(A, [
    event('e0000000-0000-0000-0000-000000000003', 'person', GRACE, 'update', person({ notes: 'two' }), person({ notes: 'three' }), {
      serverSeq: 9999,
      recordedAt: '1999-01-01T00:00:00.000Z',
    }),
  ])
  assert.notEqual(Number(pushed[0]?.server_seq), 9999, 'a client-supplied sequence is not honoured')

  const stored = await asUser<{ account_id: string }>(
    A,
    `select account_id from public.change_events where id = $1`,
    ['e0000000-0000-0000-0000-000000000003'],
  )
  assert.equal(stored[0]?.account_id, A, 'the pusher is taken from the token, not the payload')
})

test('a create event is accepted and materialises the record', async () => {
  /*
    Every test here once pushed updates, and that gap hid a real fault: a
    create carries `before: null`, which in jsonb is the JSON null value
    rather than SQL NULL, and the delta function raised on it. Creates are
    the first thing any real client sends.
  */
  const NEW_PERSON = 'bbbbbbbb-0000-0000-0000-00000000000a'
  const created = {
    id: NEW_PERSON,
    familyTreeId: TREE,
    firstName: 'Ada',
    lastName: 'Okafor',
    gender: 'female',
    createdAt: AT,
    updatedAt: AT,
  }

  const result = await push(A, [
    event('e0000000-0000-0000-0000-0000000000c1', 'person', NEW_PERSON, 'create', null, created),
  ])
  assert.equal(result[0]?.status, 'accepted', result[0]?.reason ?? '')

  const row = await asUser<{ first_name: string }>(
    A,
    `select first_name from public.people where id = $1`,
    [NEW_PERSON],
  )
  assert.equal(row[0]?.first_name, 'Ada', 'the whole record arrived, not an empty one')
})

// ── idempotency ─────────────────────────────────────────────────────

test('re-pushing an event returns the original result and changes nothing', async () => {
  const e = event('e0000000-0000-0000-0000-000000000010', 'person', SAM, 'update',
    { ...person(), id: SAM, firstName: 'Sam', gender: 'male' },
    { ...person(), id: SAM, firstName: 'Samuel', gender: 'male' })

  const first = await push(A, [e])
  assert.equal(first[0]?.status, 'accepted')

  // The timeout case: the client never heard, so it sends it again.
  const retry = await push(A, [e])
  assert.equal(retry[0]?.status, 'already_processed')
  assert.equal(retry[0]?.server_seq, first[0]?.server_seq, 'the original sequence comes back')

  const count = await asUser<{ count: string }>(
    A,
    `select count(*)::text as count from public.change_events where id = $1`,
    [e.id],
  )
  assert.equal(count[0]?.count, '1', 'no duplicate event was created')
})

test('an already-processed event does not re-apply its stale snapshot', async () => {
  const stale = event('e0000000-0000-0000-0000-000000000010', 'person', SAM, 'update',
    { ...person(), id: SAM, firstName: 'Sam' },
    { ...person(), id: SAM, firstName: 'Samuel' })

  // Somebody renames Sam again, after that event was accepted.
  await push(A, [
    event('e0000000-0000-0000-0000-000000000011', 'person', SAM, 'update',
      { ...person(), id: SAM, firstName: 'Samuel' },
      { ...person(), id: SAM, firstName: 'Sammy' }),
  ])

  // Now the old event is retried. Re-applying it would undo the rename.
  await push(A, [stale])

  const name = await asUser<{ first_name: string }>(A, `select first_name from public.people where id = $1`, [SAM])
  assert.equal(name[0]?.first_name, 'Sammy', 'the superseded value was not resurrected')
})

// ── the delta, which is what keeps server and client in agreement ───

test('only the fields an event changed are written', async () => {
  // Two devices edit different fields of Grace from the same base.
  const base = person({ notes: 'three' })

  await push(A, [
    event('e0000000-0000-0000-0000-000000000020', 'person', GRACE, 'update', base, { ...base, notes: 'from device A' }),
  ])
  await push(B === B ? A : A, [
    event('e0000000-0000-0000-0000-000000000021', 'person', GRACE, 'update', base, { ...base, birthDate: '1958-04-11' }),
  ])

  const row = await asUser<{ notes: string; birth_date: string }>(
    A,
    `select notes, birth_date from public.people where id = $1`,
    [GRACE],
  )
  assert.equal(row[0]?.notes, 'from device A', 'the first edit survived the second')
  assert.equal(row[0]?.birth_date, '1958-04-11', 'and the second landed too')
})

test('the same field is decided by sequence, the later one winning', async () => {
  const base = person({ notes: 'from device A', birthDate: '1958-04-11' })
  await push(A, [
    event('e0000000-0000-0000-0000-000000000030', 'person', GRACE, 'update', base, { ...base, notes: 'earlier' }),
    event('e0000000-0000-0000-0000-000000000031', 'person', GRACE, 'update', base, { ...base, notes: 'later' }),
  ])
  const row = await asUser<{ notes: string }>(A, `select notes from public.people where id = $1`, [GRACE])
  assert.equal(row[0]?.notes, 'later', 'the higher serverSeq wins, as the reconciler defines')
})

test('a delete is a tombstone, and a restore clears it', async () => {
  const live = person({ notes: 'later', birthDate: '1958-04-11' })
  await push(A, [
    event('e0000000-0000-0000-0000-000000000040', 'person', GRACE, 'delete', live, { ...live, deletedAt: AT }),
  ])
  let row = await asUser<{ deleted_at: string | null }>(A, `select deleted_at from public.people where id = $1`, [GRACE])
  assert.ok(row[0]?.deleted_at, 'the row is still there, carrying a tombstone')

  await push(A, [
    event('e0000000-0000-0000-0000-000000000041', 'person', GRACE, 'restore', { ...live, deletedAt: AT }, live),
  ])
  row = await asUser<{ deleted_at: string | null }>(A, `select deleted_at from public.people where id = $1`, [GRACE])
  assert.equal(row[0]?.deleted_at, null, 'and the tombstone is reversible')
})

// ── the transaction boundary ────────────────────────────────────────

test('a rejected event records nothing and does not take the batch with it', async () => {
  const before = await asUser<{ count: string }>(A, `select count(*)::text as count from public.change_events`)

  const results = await push(A, [
    event('e0000000-0000-0000-0000-000000000050', 'person', GRACE, 'update', person(), person({ notes: 'good one' })),
    // Belongs to a different tree.
    { ...event('e0000000-0000-0000-0000-000000000051', 'person', GRACE, 'update', person(), person()), familyTreeId: '00000000-0000-0000-0000-0000000000ff' },
    event('e0000000-0000-0000-0000-000000000052', 'person', SAM, 'update',
      { ...person(), id: SAM, firstName: 'Sammy' }, { ...person(), id: SAM, firstName: 'Sam' }),
  ])

  assert.deepEqual(results.map((row) => row.status), ['accepted', 'rejected', 'accepted'])
  assert.match(results[1]?.reason ?? '', /different family tree/i)
  assert.equal(results[1]?.server_seq, null, 'a rejected event gets no sequence')

  const rejectedStored = await asUser<{ count: string }>(
    A,
    `select count(*)::text as count from public.change_events where id = $1`,
    ['e0000000-0000-0000-0000-000000000051'],
  )
  assert.equal(rejectedStored[0]?.count, '0', 'the rejected event was not recorded')

  const after = await asUser<{ count: string }>(A, `select count(*)::text as count from public.change_events`)
  assert.equal(
    Number(after[0]?.count) - Number(before[0]?.count),
    2,
    'the two good events survived the bad one between them',
  )
})

test('an event that cannot be applied is not recorded either', async () => {
  const orphan = 'cccccccc-0000-0000-0000-00000000ffff'
  const results = await push(A, [
    // A link to somebody who does not exist: the foreign key refuses.
    event('e0000000-0000-0000-0000-000000000060', 'parentLink', 'dddddddd-0000-0000-0000-000000000001', 'create', null, {
      id: 'dddddddd-0000-0000-0000-000000000001',
      familyTreeId: TREE,
      parentId: orphan,
      childId: SAM,
      relationship: 'biological',
      createdAt: AT,
      updatedAt: AT,
    }),
  ])

  assert.equal(results[0]?.status, 'rejected')

  const stored = await asUser<{ count: string }>(
    A,
    `select count(*)::text as count from public.change_events where id = $1`,
    ['e0000000-0000-0000-0000-000000000060'],
  )
  assert.equal(
    stored[0]?.count,
    '0',
    'the event row rolled back with the canonical write it could not do — never one without the other',
  )
})

// ── authorisation ───────────────────────────────────────────────────

test('a non-member cannot push, and sees no events', async () => {
  const message = await refused(
    B,
    `select * from public.push_change_events($1::uuid, $2::jsonb)`,
    [TREE, JSON.stringify([event('e0000000-0000-0000-0000-000000000070', 'person', GRACE, 'update', person(), person({ notes: 'x' }))])],
  )
  assert.match(message, /permission/i)

  const seen = await asUser(B, `select * from public.change_events`)
  assert.deepEqual(seen, [], 'and the log is invisible to them')
})

test('a viewer may pull but not push', async () => {
  await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'viewer','active')`, [TREE, B])

  const visible = await asUser<{ count: string }>(B, `select count(*)::text as count from public.change_events where tree_id = $1`, [TREE])
  assert.ok(Number(visible[0]?.count) > 0, 'a viewer can follow the tree')

  const message = await refused(
    B,
    `select * from public.push_change_events($1::uuid, $2::jsonb)`,
    [TREE, JSON.stringify([event('e0000000-0000-0000-0000-000000000080', 'person', GRACE, 'update', person(), person({ notes: 'y' }))])],
  )
  assert.match(message, /permission/i)
})

test('losing membership ends both directions at once', async () => {
  await db.query(`update public.tree_members set role = 'editor' where tree_id = $1 and account_id = $2`, [TREE, B])
  const allowed = await push(B, [
    event('e0000000-0000-0000-0000-000000000090', 'person', GRACE, 'update', person(), person({ notes: 'editor was here' })),
  ])
  assert.equal(allowed[0]?.status, 'accepted')

  await db.query(`update public.tree_members set status = 'suspended' where tree_id = $1 and account_id = $2`, [TREE, B])

  const blocked = await refused(
    B,
    `select * from public.push_change_events($1::uuid, $2::jsonb)`,
    [TREE, JSON.stringify([event('e0000000-0000-0000-0000-000000000091', 'person', GRACE, 'update', person(), person({ notes: 'after' }))])],
  )
  assert.match(blocked, /permission/i)

  const seen = await asUser(B, `select * from public.change_events where tree_id = $1`, [TREE])
  assert.deepEqual(seen, [], 'the log goes too')
})

// ── pull ────────────────────────────────────────────────────────────

test('pull returns events after a cursor, strictly in sequence order', async () => {
  const all = await asUser<{ server_seq: string }>(
    A,
    `select server_seq from public.change_events where tree_id = $1 order by server_seq asc`,
    [TREE],
  )
  const seqs = all.map((row) => Number(row.server_seq))
  assert.deepEqual([...seqs].sort((x, y) => x - y), seqs, 'already ascending')

  const midpoint = seqs[Math.floor(seqs.length / 2)] as number
  const after = await asUser<{ server_seq: string }>(
    A,
    `select server_seq from public.change_events
     where tree_id = $1 and server_seq > $2 order by server_seq asc limit 100`,
    [TREE, midpoint],
  )
  assert.ok(after.every((row) => Number(row.server_seq) > midpoint), 'nothing at or before the cursor')

  const head = await asUser<{ tree_head_seq: string }>(A, `select public.tree_head_seq($1::uuid)`, [TREE])
  assert.equal(Number(head[0]?.tree_head_seq), Math.max(...seqs), 'the head is the highest accepted sequence')
})

test('an empty pull means genuinely nothing newer', async () => {
  const head = await asUser<{ tree_head_seq: string }>(A, `select public.tree_head_seq($1::uuid)`, [TREE])
  const after = await asUser(
    A,
    `select server_seq from public.change_events where tree_id = $1 and server_seq > $2`,
    [TREE, Number(head[0]?.tree_head_seq)],
  )
  assert.deepEqual(after, [], 'and it is empty because there is nothing, not because of an error')
})

test('the pull function is bounded, ordered, and respects the read policy', async () => {
  const page = await asUser<{ server_seq: string }>(
    A,
    `select server_seq from public.pull_change_events($1::uuid, 0, 3)`,
    [TREE],
  )
  assert.equal(page.length, 3, 'the limit is honoured')
  const seqs = page.map((row) => Number(row.server_seq))
  assert.deepEqual([...seqs].sort((x, y) => x - y), seqs, 'and the page is in sequence order')

  const next = await asUser<{ server_seq: string }>(
    A,
    `select server_seq from public.pull_change_events($1::uuid, $2, 3)`,
    [TREE, seqs[2] as number],
  )
  assert.ok(
    next.every((row) => Number(row.server_seq) > (seqs[2] as number)),
    'the next page starts strictly after the cursor',
  )

  // B was suspended earlier, so the policy should hide everything.
  const asStranger = await asUser(B, `select * from public.pull_change_events($1::uuid, 0, 100)`, [TREE])
  assert.deepEqual(asStranger, [], 'a non-member pulls nothing, rather than being refused loudly')
})

test('a non-member gets no head sequence for a tree they cannot see', async () => {
  const head = await asUser<{ tree_head_seq: string | null }>(B, `select public.tree_head_seq($1::uuid)`, [TREE])
  assert.equal(head[0]?.tree_head_seq, null)
})
