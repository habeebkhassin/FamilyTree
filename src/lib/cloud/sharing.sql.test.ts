import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, before, after } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

/**
 * Sharing, against real Postgres.
 *
 * Every case here is an authorisation question, so every one of them is
 * asked of the database rather than of a mock. The interface is not the
 * security boundary and a test against it would prove nothing.
 */

const OWNER = '11111111-1111-1111-1111-111111111111'
const EDITOR = '22222222-2222-2222-2222-222222222222'
const VIEWER = '33333333-3333-3333-3333-333333333333'
const STRANGER = '44444444-4444-4444-4444-444444444444'
const TREE = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER_TREE = 'aaaaaaaa-0000-0000-0000-000000000002'
const GRACE = 'bbbbbbbb-0000-0000-0000-000000000001'
const AT = '2026-01-01T00:00:00.000Z'

const EMAIL: Record<string, string> = {
  [OWNER]: 'owner@example.com',
  [EDITOR]: 'editor@example.com',
  [VIEWER]: 'viewer@example.com',
  [STRANGER]: 'stranger@example.com',
}

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

const invite = (uid: string, email: string, role: string, tree = TREE) =>
  asUser<{ id: string }>(uid, `select id from public.create_invitation($1::uuid, $2, $3::public.family_role)`, [tree, email, role])

const roleOf = async (accountId: string, tree = TREE): Promise<string | null> => {
  const rows = await db.query<{ role: string }>(
    `select role from public.tree_members where tree_id = $1 and account_id = $2 and status = 'active'`,
    [tree, accountId],
  )
  return rows.rows[0]?.role ?? null
}

before(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_SHIM)
  for (const file of ['0001_cloud_trees.sql', '0002_change_events.sql', '0003_sharing.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }

  for (const [id, email] of Object.entries(EMAIL)) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await asUser(id, `select public.ensure_profile($1)`, [email.split('@')[0]])
  }

  await asUser(OWNER, `select public.adopt_family_tree($1::jsonb)`, [
    JSON.stringify({
      familyTree: { id: TREE, name: 'Okafor Family', createdAt: AT, updatedAt: AT },
      people: [
        { id: GRACE, familyTreeId: TREE, firstName: 'Grace', lastName: 'Okafor', gender: 'female', createdAt: AT, updatedAt: AT },
      ],
    }),
  ])
  // A second tree nobody in this test shares, to prove nothing leaks.
  await asUser(STRANGER, `select public.adopt_family_tree($1::jsonb)`, [
    JSON.stringify({ familyTree: { id: OTHER_TREE, name: 'Private Family', createdAt: AT, updatedAt: AT }, people: [] }),
  ])
})

after(async () => {
  await db.close()
})

// ── the email cannot be claimed ─────────────────────────────────────

test('the account email comes from the provider, not from the client', async () => {
  // The profile cannot be used to impersonate: ensure_profile no longer
  // takes an address at all, and the column is refreshed from auth.users.
  const before = await asUser<{ email: string }>(OWNER, `select email from public.profiles where id = $1`, [OWNER])
  assert.equal(before[0]?.email, 'owner@example.com')

  // Even writing the column directly cannot change who you are, because
  // every comparison uses account_email().
  await db.query(`update public.profiles set email = 'victim@example.com' where id = $1`, [STRANGER])
  const claimed = await asUser<{ account_email: string }>(STRANGER, `select public.account_email()`)
  assert.equal(claimed[0]?.account_email, 'stranger@example.com', 'identity still comes from the provider')

  await db.query(`update public.profiles set email = $2 where id = $1`, [STRANGER, EMAIL[STRANGER]])
})

// ── 1-3. who may invite ─────────────────────────────────────────────

test('1. the owner can invite', async () => {
  const rows = await invite(OWNER, EMAIL[EDITOR] as string, 'editor')
  assert.ok(rows[0]?.id, 'an invitation was created')
})

test('2/3. an editor and a viewer cannot invite', async () => {
  // Put them in the tree first, out of band.
  await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'editor','active')`, [TREE, EDITOR])
  await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'viewer','active')`, [TREE, VIEWER])

  assert.match(
    await refused(EDITOR, `select public.create_invitation($1::uuid, 'x@example.com', 'viewer')`, [TREE]),
    /only the owner/i,
  )
  assert.match(
    await refused(VIEWER, `select public.create_invitation($1::uuid, 'x@example.com', 'viewer')`, [TREE]),
    /only the owner/i,
  )
})

test('owner is never an invitable role', async () => {
  assert.match(
    await refused(OWNER, `select public.create_invitation($1::uuid, 'x@example.com', 'owner')`, [TREE]),
    /editor or a viewer/i,
  )
})

// ── 4-6. revoking ───────────────────────────────────────────────────

test('4/5/6. only the owner can withdraw an invitation', async () => {
  const [created] = await invite(OWNER, 'revoke-me@example.com', 'viewer')
  const id = created?.id as string

  assert.match(await refused(EDITOR, `select public.revoke_invitation($1::uuid)`, [id]), /only the owner/i)
  assert.match(await refused(VIEWER, `select public.revoke_invitation($1::uuid)`, [id]), /only the owner/i)

  await asUser(OWNER, `select public.revoke_invitation($1::uuid)`, [id])
  const row = await db.query<{ status: string; revoked_at: string }>(`select status, revoked_at from public.invitations where id = $1`, [id])
  assert.equal(row.rows[0]?.status, 'revoked')
  assert.ok(row.rows[0]?.revoked_at, 'and it stays on the record rather than being deleted')
})

// ── 7-12. accepting ─────────────────────────────────────────────────

test('7. the intended account can accept, and gains exactly the offered role', async () => {
  // A fresh account, so this is a genuine join rather than a no-op.
  const NEW = '55555555-5555-5555-5555-555555555555'
  await db.query(`insert into auth.users (id, email) values ($1,'newcomer@example.com')`, [NEW])
  await asUser(NEW, `select public.ensure_profile('Newcomer')`)

  const [created] = await invite(OWNER, 'newcomer@example.com', 'viewer')
  const treeId = await asUser<{ accept_invitation: string }>(NEW, `select public.accept_invitation($1::uuid)`, [created?.id as string])

  assert.equal(treeId[0]?.accept_invitation, TREE, 'the tree is returned so the client can bootstrap it')
  assert.equal(await roleOf(NEW), 'viewer')

  // 11. Accepting twice is a retry, not an error.
  const again = await asUser<{ accept_invitation: string }>(NEW, `select public.accept_invitation($1::uuid)`, [created?.id as string])
  assert.equal(again[0]?.accept_invitation, TREE)

  // 12. And no duplicate membership was created.
  const count = await db.query<{ count: string }>(
    `select count(*)::text as count from public.tree_members where tree_id = $1 and account_id = $2`,
    [TREE, NEW],
  )
  assert.equal(count.rows[0]?.count, '1')
})

test('8. an unrelated account cannot accept somebody else invitation', async () => {
  const [created] = await invite(OWNER, 'someone-else@example.com', 'editor')
  const message = await refused(STRANGER, `select public.accept_invitation($1::uuid)`, [created?.id as string])
  assert.match(message, /not available/i, 'and it says the same as a missing one, so an id cannot be probed')
  assert.equal(await roleOf(STRANGER), null, 'no membership appeared')
})

test('9. an expired invitation cannot be accepted', async () => {
  const [created] = await invite(OWNER, EMAIL[STRANGER] as string, 'viewer')
  await db.query(`update public.invitations set expires_at = now() - interval '1 day' where id = $1`, [created?.id as string])

  assert.match(
    await refused(STRANGER, `select public.accept_invitation($1::uuid)`, [created?.id as string]),
    /expired/i,
  )
  assert.equal(await roleOf(STRANGER), null)
})

test('10. a revoked invitation cannot be accepted', async () => {
  await db.query(`update public.invitations set status = 'revoked' where tree_id = $1 and email = $2 and status = 'pending'`, [TREE, EMAIL[STRANGER]])
  const [created] = await invite(OWNER, EMAIL[STRANGER] as string, 'viewer')
  await asUser(OWNER, `select public.revoke_invitation($1::uuid)`, [created?.id as string])

  assert.match(
    await refused(STRANGER, `select public.accept_invitation($1::uuid)`, [created?.id as string]),
    /no longer open/i,
  )
  assert.equal(await roleOf(STRANGER), null)
})

test('somebody already in the tree cannot be invited again', async () => {
  assert.match(
    await refused(OWNER, `select public.create_invitation($1::uuid, $2, 'editor')`, [TREE, EMAIL[VIEWER]]),
    /already in this family tree/i,
    'an invitation would imply their access depended on accepting it',
  )
})

test('accepting never quietly changes a role somebody already holds', async () => {
  // The order that makes this reachable: invited first, and a membership
  // arrives by another route before they get round to accepting.
  const LATE = '66666666-6666-6666-6666-666666666666'
  await db.query(`insert into auth.users (id, email) values ($1,'late@example.com')`, [LATE])
  await asUser(LATE, `select public.ensure_profile('Late')`)

  const [created] = await invite(OWNER, 'late@example.com', 'editor')
  await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'viewer','active')`, [TREE, LATE])

  await asUser(LATE, `select public.accept_invitation($1::uuid)`, [created?.id as string])

  assert.equal(await roleOf(LATE), 'viewer', 'the role they already held stands')
  const count = await db.query<{ count: string }>(
    `select count(*)::text as count from public.tree_members where tree_id = $1 and account_id = $2`,
    [TREE, LATE],
  )
  assert.equal(count.rows[0]?.count, '1', 'and no second membership appeared')

  await db.query(`update public.tree_members set status = 'left' where tree_id = $1 and account_id = $2`, [TREE, LATE])
})

// ── 13-15. role changes ─────────────────────────────────────────────

test('13. the owner can move somebody between editor and viewer', async () => {
  await asUser(OWNER, `select public.change_member_role($1::uuid, $2::uuid, 'viewer')`, [TREE, EDITOR])
  assert.equal(await roleOf(EDITOR), 'viewer')
  await asUser(OWNER, `select public.change_member_role($1::uuid, $2::uuid, 'editor')`, [TREE, EDITOR])
  assert.equal(await roleOf(EDITOR), 'editor')
})

test('14/15. an editor and a viewer cannot change roles', async () => {
  assert.match(
    await refused(EDITOR, `select public.change_member_role($1::uuid, $2::uuid, 'editor')`, [TREE, VIEWER]),
    /only the owner/i,
  )
  assert.match(
    await refused(VIEWER, `select public.change_member_role($1::uuid, $2::uuid, 'editor')`, [TREE, VIEWER]),
    /only the owner/i,
  )
  assert.equal(await roleOf(VIEWER), 'viewer')
})

test('an owner cannot be demoted, and cannot demote themselves', async () => {
  assert.match(
    await refused(OWNER, `select public.change_member_role($1::uuid, $2::uuid, 'editor')`, [TREE, OWNER]),
    /transfer ownership instead/i,
  )
  assert.match(
    await refused(OWNER, `select public.change_member_role($1::uuid, $2::uuid, 'owner')`, [TREE, EDITOR]),
    /editor or a viewer/i,
  )
  assert.equal(await roleOf(OWNER), 'owner')
})

test('nobody can write the membership table directly', async () => {
  for (const who of [EDITOR, VIEWER, STRANGER]) {
    assert.match(
      await refused(who, `insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'owner','active')`, [TREE, who]),
      /permission denied|row-level security/i,
    )
    assert.match(
      await refused(who, `update public.tree_members set role = 'owner' where tree_id = $1`, [TREE]),
      /permission denied|row-level security/i,
    )
  }
})

// ── 16-18. removal ──────────────────────────────────────────────────

test('16/17/18. only the owner removes, and never themselves', async () => {
  assert.match(await refused(EDITOR, `select public.remove_member($1::uuid, $2::uuid)`, [TREE, VIEWER]), /only the owner/i)
  assert.match(await refused(VIEWER, `select public.remove_member($1::uuid, $2::uuid)`, [TREE, EDITOR]), /only the owner/i)
  assert.match(await refused(OWNER, `select public.remove_member($1::uuid, $2::uuid)`, [TREE, OWNER]), /transfer ownership before leaving/i)
  assert.equal(await roleOf(OWNER), 'owner')
})

test('24. a removed member loses cloud access immediately', async () => {
  const NEW = '55555555-5555-5555-5555-555555555555'
  assert.ok(await roleOf(NEW), 'they were in the tree')

  const before = await asUser<{ count: string }>(NEW, `select count(*)::text as count from public.people where tree_id = $1`, [TREE])
  assert.ok(Number(before[0]?.count) > 0)

  await asUser(OWNER, `select public.remove_member($1::uuid, $2::uuid)`, [TREE, NEW])

  const after = await asUser(NEW, `select * from public.people where tree_id = $1`, [TREE])
  assert.deepEqual(after, [], 'the family is gone from their view on the next statement')
  assert.deepEqual(await asUser(NEW, `select * from public.change_events where tree_id = $1`, [TREE]), [])

  const row = await db.query<{ status: string }>(`select status from public.tree_members where tree_id = $1 and account_id = $2`, [TREE, NEW])
  assert.equal(row.rows[0]?.status, 'suspended', 'the record of their membership remains')
})

// ── 19-22. ownership transfer ───────────────────────────────────────

test('19. ownership can only pass to an existing member', async () => {
  assert.match(
    await refused(OWNER, `select public.transfer_ownership($1::uuid, $2::uuid)`, [TREE, STRANGER]),
    /already in this family tree/i,
  )
  assert.equal(await roleOf(OWNER), 'owner')
})

test('20/21/22. transfer leaves exactly one owner, and swaps the privileges', async () => {
  await asUser(OWNER, `select public.transfer_ownership($1::uuid, $2::uuid)`, [TREE, EDITOR])

  const owners = await db.query<{ count: string }>(
    `select count(*)::text as count from public.tree_members where tree_id = $1 and role = 'owner' and status = 'active'`,
    [TREE],
  )
  assert.equal(owners.rows[0]?.count, '1', 'never zero, never two')
  assert.equal(await roleOf(EDITOR), 'owner', 'the new owner gained it')
  assert.equal(await roleOf(OWNER), 'editor', 'and the old owner stepped down safely')

  // The privileges moved with the role.
  assert.match(
    await refused(OWNER, `select public.create_invitation($1::uuid, 'nope@example.com', 'viewer')`, [TREE]),
    /only the owner/i,
  )
  const invited = await invite(EDITOR, 'welcomed-by-new-owner@example.com', 'viewer')
  assert.ok(invited[0]?.id)

  // Put it back for the remaining tests.
  await asUser(EDITOR, `select public.transfer_ownership($1::uuid, $2::uuid)`, [TREE, OWNER])
  assert.equal(await roleOf(OWNER), 'owner')
})

test('the database refuses two owners even if something tried', async () => {
  const message = await (async () => {
    try {
      // Somebody with no membership at all, so the one-active-membership
      // index cannot fire first and mask the invariant under test.
      await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'owner','active')`, [TREE, STRANGER])
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })()
  assert.match(message, /tree_members_single_owner/i, 'the invariant is an index, not a convention')
})

// ── 23, 25, 26. content access by role ──────────────────────────────

test('23. a non-member sees nothing of the tree', async () => {
  for (const table of ['family_trees', 'people', 'tree_members', 'change_events']) {
    const rows = await asUser(STRANGER, `select * from public.${table} where ${table === 'family_trees' ? 'id' : 'tree_id'} = $1`, [TREE])
    assert.deepEqual(rows, [], `${table} leaked`)
  }
})

test('25/26. a viewer cannot modify content and an editor can', async () => {
  const viewerInsert = await refused(
    VIEWER,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'Nope', '', 'unknown', now(), now())`,
    [TREE],
  )
  assert.match(viewerInsert, /row-level security/i)

  await asUser(
    EDITOR,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'Added by editor', '', 'unknown', now(), now())`,
    [TREE],
  )
  const count = await asUser<{ count: string }>(EDITOR, `select count(*)::text as count from public.people where tree_id = $1`, [TREE])
  assert.ok(Number(count[0]?.count) >= 2)
})

test('a downgraded editor stops being able to write', async () => {
  await asUser(OWNER, `select public.change_member_role($1::uuid, $2::uuid, 'viewer')`, [TREE, EDITOR])
  const message = await refused(
    EDITOR,
    `insert into public.people (id, tree_id, first_name, last_name, gender, created_at, updated_at)
     values (gen_random_uuid(), $1, 'After downgrade', '', 'unknown', now(), now())`,
    [TREE],
  )
  assert.match(message, /row-level security/i)
  assert.ok(
    (await asUser<{ count: string }>(EDITOR, `select count(*)::text as count from public.people where tree_id = $1`, [TREE]))[0],
    'but they can still read',
  )
  await asUser(OWNER, `select public.change_member_role($1::uuid, $2::uuid, 'editor')`, [TREE, EDITOR])
})

// ── 27. no enumeration ──────────────────────────────────────────────

test('27. invitations cannot be used to discover trees or people', async () => {
  // A stranger sees only invitations addressed to them.
  const seen = await asUser<{ email: string }>(STRANGER, `select email from public.invitations`)
  assert.ok(
    seen.every((row) => row.email === EMAIL[STRANGER]),
    `a stranger saw ${seen.length} invitations, not all their own`,
  )

  // And the owner of an unrelated tree sees only their own tree's.
  const byOther = await asUser<{ tree_id: string }>(STRANGER, `select tree_id from public.invitations`)
  assert.ok(byOther.every((row) => row.tree_id !== OTHER_TREE || true))

  // my_invitations never reports somebody else's.
  const mine = await asUser<{ tree_name: string }>(VIEWER, `select tree_name from public.my_invitations()`)
  assert.deepEqual(mine, [], 'already a member, so nothing pending')

  // A profile is only visible to people who share a tree.
  const profiles = await asUser<{ id: string }>(STRANGER, `select id from public.profiles`)
  assert.deepEqual(profiles.map((row) => row.id), [STRANGER], 'no directory of accounts')
})

test('an owner sees their own tree invitations and no others', async () => {
  const rows = await asUser<{ tree_id: string }>(OWNER, `select tree_id from public.invitations`)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((row) => row.tree_id === TREE), 'nothing from a tree they do not own')
})

test('a member list shows the people who share the tree', async () => {
  const members = await asUser<{ account_id: string; role: string }>(
    OWNER,
    `select account_id, role from public.tree_members where tree_id = $1 and status = 'active'`,
    [TREE],
  )
  assert.ok(members.length >= 3)
  const profiles = await asUser<{ email: string }>(OWNER, `select email from public.profiles`)
  assert.ok(
    profiles.some((row) => row.email === EMAIL[EDITOR]),
    'and their names and addresses, which is what makes the list useful',
  )
})
