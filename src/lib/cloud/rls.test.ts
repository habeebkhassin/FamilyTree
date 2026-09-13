import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, before, after } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

/**
 * The row-level security policies, run against real Postgres.
 *
 * PGlite is PostgreSQL compiled to WebAssembly, so this is not a model of
 * the policies or a mock of them — it is the migration in
 * supabase/migrations applied to a real database, queried as real users.
 * A policy that lets the wrong person read a family fails here.
 *
 *
 * HOW A USER IS IMPERSONATED
 * ──────────────────────────
 * Exactly as Supabase does it. `auth.uid()` reads the `sub` claim of the
 * request's JWT out of a session setting, and the request runs as the
 * `authenticated` role. Both are reproduced below: each query is wrapped
 * in a transaction that sets the claim and switches role.
 *
 * The switch matters more than it looks. A superuser bypasses row-level
 * security entirely, so a test that forgot `set local role` would pass
 * no matter what the policies said.
 */

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'
const TREE = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER_TREE = 'aaaaaaaa-0000-0000-0000-000000000002'

let db: PGlite

/**
 * Supabase provides `auth.users` and `auth.uid()`; a bare Postgres does
 * not. This is the smallest faithful stand-in — the same function body
 * Supabase ships, over a real table the migration's foreign keys can
 * point at.
 */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin;
  create role anon nologin;
`

/** One query, as one signed-in account. */
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

/** Asserts a statement is refused — by a policy, a grant, or a raise. */
async function refused(uid: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await asUser(uid, sql, params)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  assert.fail(`expected this to be refused, but it succeeded: ${sql}`)
}

/** Anything the test needs to arrange as the database owner. */
const asAdmin = (sql: string, params: unknown[] = []) => db.query(sql, params)

before(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_SHIM)
  await db.exec(readFileSync('supabase/migrations/0001_cloud_trees.sql', 'utf8'))

  // Three accounts exist with the provider; none has touched the cloud.
  await asAdmin(`insert into auth.users (id, email) values ($1,'a@example.com'),($2,'b@example.com'),($3,'c@example.com')`, [A, B, C])
})

after(async () => {
  await db.close()
})

// ── nobody signed in ────────────────────────────────────────────────

test('an unauthenticated caller sees nothing and can do nothing', async () => {
  const rows = await asUser(null, 'select * from public.family_trees')
  assert.deepEqual(rows, [], 'no tree is visible without an account')

  const message = await refused(null, `select public.ensure_profile()`)
  assert.match(message, /not signed in/i)
})

// ── becoming an account, and adopting a tree ────────────────────────

test('a profile is created lazily, and only for the caller', async () => {
  await asUser(A, `select public.ensure_profile('a@example.com', 'Ayesha')`)
  const mine = await asUser<{ id: string; display_name: string }>(A, 'select id, display_name from public.profiles')
  assert.equal(mine.length, 1)
  assert.equal(mine[0]?.id, A)
  assert.equal(mine[0]?.display_name, 'Ayesha')

  // B has its own profile and cannot see A's.
  await asUser(B, `select public.ensure_profile('b@example.com', 'Bilal')`)
  const seenByB = await asUser<{ id: string }>(B, 'select id from public.profiles')
  assert.deepEqual(seenByB.map((row) => row.id), [B], 'a profile is private to its owner')
})

test('adopting a tree creates it, its owner membership and its people together', async () => {
  const payload = {
    familyTree: { id: TREE, name: 'Okafor Family', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    people: [
      { id: 'bbbbbbbb-0000-0000-0000-000000000001', firstName: 'Grace', lastName: 'Okafor', gender: 'female', birthDate: '1958', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000002', firstName: 'Sam', lastName: 'Okafor', gender: 'male', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    parentLinks: [
      { id: 'cccccccc-0000-0000-0000-000000000001', parentId: 'bbbbbbbb-0000-0000-0000-000000000001', childId: 'bbbbbbbb-0000-0000-0000-000000000002', relationship: 'biological', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    unions: [],
    familyGroups: [],
    familyGroupMembers: [],
  }

  const returned = await asUser<{ adopt_family_tree: string }>(
    A,
    `select public.adopt_family_tree($1::jsonb)`,
    [JSON.stringify(payload)],
  )
  assert.equal(returned[0]?.adopt_family_tree, TREE, 'the local id is kept, not replaced')

  const trees = await asUser<{ id: string; name: string }>(A, 'select id, name from public.family_trees')
  assert.deepEqual(trees, [{ id: TREE, name: 'Okafor Family' }])

  const membership = await asUser<{ role: string; status: string }>(
    A,
    'select role, status from public.tree_members where tree_id = $1',
    [TREE],
  )
  assert.deepEqual(membership, [{ role: 'owner', status: 'active' }])

  const people = await asUser<{ count: string }>(A, 'select count(*)::text as count from public.people where tree_id = $1', [TREE])
  assert.equal(people[0]?.count, '2', 'the family arrived with the tree')

  // A partial date survives verbatim; a date column would have rejected it.
  const grace = await asUser<{ birth_date: string }>(A, `select birth_date from public.people where first_name = 'Grace'`)
  assert.equal(grace[0]?.birth_date, '1958')
})

test('a tree cannot be adopted twice, or claimed by somebody else', async () => {
  const payload = JSON.stringify({ familyTree: { id: TREE, name: 'Stolen' }, people: [] })

  const again = await refused(A, `select public.adopt_family_tree($1::jsonb)`, [payload])
  assert.match(again, /already saved/i)

  const byB = await refused(B, `select public.adopt_family_tree($1::jsonb)`, [payload])
  assert.match(byB, /already saved/i, 'another account cannot take over a tree id it does not own')

  // And B still holds nothing.
  const bTrees = await asUser(B, 'select id from public.family_trees')
  assert.deepEqual(bTrees, [], 'the failed attempt left B with no tree')
})

// ── the boundary between two accounts ───────────────────────────────

test('a non-member reads nothing of another account tree', async () => {
  for (const table of ['family_trees', 'people', 'parent_links', 'unions', 'family_groups', 'family_group_members', 'tree_members']) {
    const rows = await asUser(B, `select * from public.${table}`)
    assert.deepEqual(rows, [], `${table} leaked to a non-member`)
  }
})

test('a non-member cannot write into another account tree', async () => {
  const message = await refused(
    B,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'Intruder', '', 'unknown', now(), now())`,
    [TREE],
  )
  assert.match(message, /row-level security/i)

  const count = await asUser<{ count: string }>(A, 'select count(*)::text as count from public.people where tree_id = $1', [TREE])
  assert.equal(count[0]?.count, '2', 'nothing was written')
})

test('nobody can make themselves a member, which is the whole point', async () => {
  // The table has no insert policy at all, and no insert grant.
  const message = await refused(
    B,
    `insert into public.tree_members (tree_id, account_id, role, status) values ($1, $2, 'owner', 'active')`,
    [TREE, B],
  )
  assert.match(message, /permission denied|row-level security/i)

  // Nor promote themselves by updating an existing row.
  const update = await refused(B, `update public.tree_members set role = 'owner' where tree_id = $1`, [TREE])
  assert.match(update, /permission denied|row-level security/i)
})

// ── roles ───────────────────────────────────────────────────────────

test('an editor can write and a viewer cannot', async () => {
  await asUser(C, `select public.ensure_profile('c@example.com', 'Chidi')`)

  // Granted out of band: this milestone has no sharing flow, and the
  // point here is the policy, not the path that creates the row.
  await asAdmin(`insert into public.tree_members (tree_id, account_id, role, status) values ($1, $2, 'editor', 'active')`, [TREE, B])
  await asAdmin(`insert into public.tree_members (tree_id, account_id, role, status) values ($1, $2, 'viewer', 'active')`, [TREE, C])

  // Editor: reads and writes.
  const editorSees = await asUser<{ count: string }>(B, 'select count(*)::text as count from public.people where tree_id = $1', [TREE])
  assert.equal(editorSees[0]?.count, '2')

  await asUser(
    B,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values ('bbbbbbbb-0000-0000-0000-000000000003', $1, 'Tom', 'Okafor', 'male', now(), now())`,
    [TREE],
  )

  // Viewer: reads everything, writes nothing.
  const viewerSees = await asUser<{ count: string }>(C, 'select count(*)::text as count from public.people where tree_id = $1', [TREE])
  assert.equal(viewerSees[0]?.count, '3', 'a viewer sees the whole family')

  const insert = await refused(
    C,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'Nope', '', 'unknown', now(), now())`,
    [TREE],
  )
  assert.match(insert, /row-level security/i)

  const update = await asUser(C, `update public.people set first_name = 'Changed' where tree_id = $1`, [TREE])
  assert.deepEqual(update, [], 'a viewer update matches no rows rather than changing any')

  const stillGrace = await asUser<{ count: string }>(A, `select count(*)::text as count from public.people where first_name = 'Grace'`)
  assert.equal(stillGrace[0]?.count, '1', 'the viewer changed nothing')

  const del = await asUser(C, `delete from public.people where tree_id = $1`, [TREE])
  assert.deepEqual(del, [], 'and deleted nothing')
})

test('a suspended member loses access immediately', async () => {
  await asAdmin(`update public.tree_members set status = 'suspended' where tree_id = $1 and account_id = $2`, [TREE, B])

  const rows = await asUser(B, 'select id from public.people where tree_id = $1', [TREE])
  assert.deepEqual(rows, [], 'access ends with the status change, not with a token')

  const write = await refused(
    B,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'After', '', 'unknown', now(), now())`,
    [TREE],
  )
  assert.match(write, /row-level security/i)
})

// ── integrity the local model already enforces ──────────────────────

test('the database refuses what the application refuses', async () => {
  const personA = 'bbbbbbbb-0000-0000-0000-000000000001'
  const personB = 'bbbbbbbb-0000-0000-0000-000000000002'

  const self = await refused(
    A,
    `insert into public.parent_links (id, tree_id, parent_id, child_id, relationship, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, $2, 'biological', now(), now())`,
    [TREE, personA],
  )
  assert.match(self, /parent_links_not_self/i, 'a person is not their own parent')

  const duplicate = await refused(
    A,
    `insert into public.parent_links (id, tree_id, parent_id, child_id, relationship, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, $3, 'biological', now(), now())`,
    [TREE, personA, personB],
  )
  assert.match(duplicate, /parent_links_unique_live/i, 'one live link per parent and child')

  const foreign = await refused(
    A,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'Nowhere', '', 'unknown', now(), now())`,
    [OTHER_TREE],
  )
  assert.match(foreign, /row-level security/i, 'a tree that does not exist is a tree you are not a member of')
})

test('two unions between the same pair are allowed, as the model intends', async () => {
  const personA = 'bbbbbbbb-0000-0000-0000-000000000001'
  const personB = 'bbbbbbbb-0000-0000-0000-000000000002'
  for (const status of ['married', 'divorced']) {
    await asUser(
      A,
      `insert into public.unions (id, tree_id, partner_a_id, partner_b_id, status, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, $3, $4::public.union_status, now(), now())`,
      [TREE, personA, personB, status],
    )
  }
  const count = await asUser<{ count: string }>(A, 'select count(*)::text as count from public.unions where tree_id = $1', [TREE])
  assert.equal(count[0]?.count, '2', 'a remarriage is two records, not a constraint violation')
})
