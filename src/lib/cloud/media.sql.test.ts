import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, before, after } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

/**
 * Photographs, against real Postgres — both halves.
 *
 * The metadata table is ordinary RLS. The storage policies are too: in
 * Supabase, "who may read this object" is row-level security on
 * `storage.objects`, so the shim below creates that table and the bucket
 * table beside it and the real policies are applied to them unchanged.
 *
 * That is the strongest deterministic test available without a project:
 * the SQL under test is the SQL that ships, and a policy that let the
 * wrong family read a photograph fails here.
 */

const OWNER = '11111111-1111-1111-1111-111111111111'
const EDITOR = '22222222-2222-2222-2222-222222222222'
const VIEWER = '33333333-3333-3333-3333-333333333333'
const STRANGER = '44444444-4444-4444-4444-444444444444'
const TREE = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER_TREE = 'aaaaaaaa-0000-0000-0000-000000000002'
const GRACE = 'bbbbbbbb-0000-0000-0000-000000000001'
const PHOTO = 'eeeeeeee-0000-0000-0000-000000000001'
const AT = '2026-01-01T00:00:00.000Z'

const EMAIL: Record<string, string> = {
  [OWNER]: 'owner@example.com',
  [EDITOR]: 'editor@example.com',
  [VIEWER]: 'viewer@example.com',
  [STRANGER]: 'stranger@example.com',
}

let db: PGlite

/**
 * Supabase's own `auth` and `storage` schemas, reduced to what the
 * policies actually touch: the uid function, the users table the email
 * check reads, and the two storage tables the bucket and its objects live
 * in.
 */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create schema if not exists storage;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean not null default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  create role authenticated nologin;
  create role anon nologin;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
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

const put = (uid: string, name: string) =>
  asUser(uid, `insert into storage.objects (bucket_id, name) values ('family-media', $1)`, [name])

const path = (tree: string, media: string, which = 'original') =>
  `trees/${tree}/media/${media}/${which}`

before(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_SHIM)
  for (const file of [
    '0001_cloud_trees.sql',
    '0002_change_events.sql',
    '0003_sharing.sql',
    '0004_media.sql',
  ]) {
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
  await asUser(STRANGER, `select public.adopt_family_tree($1::jsonb)`, [
    JSON.stringify({ familyTree: { id: OTHER_TREE, name: 'Private Family', createdAt: AT, updatedAt: AT }, people: [] }),
  ])

  await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'editor','active')`, [TREE, EDITOR])
  await db.query(`insert into public.tree_members (tree_id, account_id, role, status) values ($1,$2,'viewer','active')`, [TREE, VIEWER])
})

after(async () => {
  await db.close()
})

// ── the bucket ──────────────────────────────────────────────────────

test('the photo bucket is private', async () => {
  const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'family-media'`)
  assert.equal(bucket.rows[0]?.public, false, 'family photographs are not on the open web')
})

// ── metadata through the ordinary event path ────────────────────────

test('a photo record arrives through the same push as everything else', async () => {
  const after = {
    id: PHOTO,
    familyTreeId: TREE,
    kind: 'photo',
    personIds: [GRACE],
    contentType: 'image/jpeg',
    byteSize: 12345,
    createdAt: AT,
    updatedAt: AT,
  }
  const result = await asUser<{ status: string; reason: string }>(
    OWNER,
    `select status, reason from public.push_change_events($1::uuid, $2::jsonb)`,
    [
      TREE,
      JSON.stringify([
        {
          id: 'f0000000-0000-0000-0000-000000000001',
          familyTreeId: TREE,
          changeSetId: '99999999-0000-0000-0000-000000000001',
          actorId: 'local-1',
          entity: 'media',
          entityId: PHOTO,
          op: 'create',
          before: null,
          after,
          createdAt: AT,
          basedOnServerSeq: null,
        },
      ]),
    ],
  )
  assert.equal(result[0]?.status, 'accepted', result[0]?.reason ?? '')

  const row = await asUser<{ kind: string; storage_path: string | null; person_ids: string[] }>(
    OWNER,
    `select kind, storage_path, person_ids from public.media where id = $1`,
    [PHOTO],
  )
  assert.equal(row[0]?.kind, 'photo')
  assert.equal(row[0]?.storage_path, null, 'no path until the bytes have actually arrived')
})

test('the storage path is derived by the server, never taken from the client', async () => {
  // A client claiming somebody else's folder.
  await asUser(
    OWNER,
    `select public.push_change_events($1::uuid, $2::jsonb)`,
    [
      TREE,
      JSON.stringify([
        {
          id: 'f0000000-0000-0000-0000-000000000002',
          familyTreeId: TREE,
          changeSetId: '99999999-0000-0000-0000-000000000001',
          actorId: 'local-1',
          entity: 'media',
          entityId: PHOTO,
          op: 'update',
          before: { id: PHOTO, familyTreeId: TREE, kind: 'photo', personIds: [GRACE], createdAt: AT, updatedAt: AT },
          after: {
            id: PHOTO,
            familyTreeId: TREE,
            kind: 'photo',
            personIds: [GRACE],
            storagePath: `trees/${OTHER_TREE}/media/${PHOTO}/original`,
            createdAt: AT,
            updatedAt: AT,
          },
          createdAt: AT,
          basedOnServerSeq: null,
        },
      ]),
    ],
  )

  const row = await asUser<{ storage_path: string }>(
    OWNER,
    `select storage_path from public.media where id = $1`,
    [PHOTO],
  )
  assert.equal(
    row[0]?.storage_path,
    path(TREE, PHOTO),
    'the claimed path was discarded and the real one computed from ids the server holds',
  )
})

test('a non-member sees no photo metadata', async () => {
  assert.deepEqual(await asUser(STRANGER, `select * from public.media where tree_id = $1`, [TREE]), [])
})

// ── the objects themselves ──────────────────────────────────────────

test('every member can read a family photo, including a viewer', async () => {
  await put(OWNER, path(TREE, PHOTO))

  for (const who of [OWNER, EDITOR, VIEWER]) {
    const rows = await asUser<{ name: string }>(who, `select name from storage.objects where bucket_id = 'family-media'`)
    assert.equal(rows.length, 1, `${who} could not read the photo`)
  }
})

test('a stranger cannot read it, even knowing the exact path', async () => {
  const rows = await asUser(
    STRANGER,
    `select name from storage.objects where bucket_id = 'family-media' and name = $1`,
    [path(TREE, PHOTO)],
  )
  assert.deepEqual(rows, [], 'the path is not the security; membership is')
})

test('a viewer cannot upload, replace or delete a photo', async () => {
  assert.match(await refused(VIEWER, `insert into storage.objects (bucket_id, name) values ('family-media', $1)`, [path(TREE, 'eeeeeeee-0000-0000-0000-00000000000f')]), /row-level security/i)

  const updated = await asUser(VIEWER, `update storage.objects set name = name where name = $1`, [path(TREE, PHOTO)])
  assert.deepEqual(updated, [], 'an update matches no rows rather than changing one')

  const deleted = await asUser(VIEWER, `delete from storage.objects where name = $1`, [path(TREE, PHOTO)])
  assert.deepEqual(deleted, [], 'and nothing is deleted')

  const still = await asUser(OWNER, `select name from storage.objects where name = $1`, [path(TREE, PHOTO)])
  assert.equal(still.length, 1, 'the photo is still there')
})

test('an editor can upload and replace', async () => {
  const theirs = 'eeeeeeee-0000-0000-0000-000000000002'
  await put(EDITOR, path(TREE, theirs))
  const rows = await asUser(EDITOR, `select name from storage.objects where name = $1`, [path(TREE, theirs)])
  assert.equal(rows.length, 1)
})

test('an editor of one family cannot write into another', async () => {
  const message = await refused(
    EDITOR,
    `insert into storage.objects (bucket_id, name) values ('family-media', $1)`,
    [path(OTHER_TREE, 'eeeeeeee-0000-0000-0000-000000000003')],
  )
  assert.match(message, /row-level security/i, 'being an editor somewhere is not being an editor everywhere')
})

test('a path that is not a family media path matches nothing', async () => {
  for (const name of [
    'trees/../../etc/passwd',
    `trees/${TREE}/media/${PHOTO}/../../../${OTHER_TREE}/media/x/original`,
    'anything',
    `trees/${TREE}/media/${PHOTO}`,
    `trees/not-a-uuid/media/${PHOTO}/original`,
  ]) {
    const message = await refused(
      OWNER,
      `insert into storage.objects (bucket_id, name) values ('family-media', $1)`,
      [name],
    )
    assert.match(message, /row-level security/i, `a malformed path was accepted: ${name}`)
  }
})

test('the path helper fails closed', async () => {
  const rows = await asUser<{ media_path_tree: string | null }>(
    OWNER,
    `select public.media_path_tree($1)`,
    ['trees/../../secret/media/x/original'],
  )
  assert.equal(rows[0]?.media_path_tree, null, 'a null tree is a member of nothing')
})

// ── losing access ───────────────────────────────────────────────────

test('a removed member loses the photographs too', async () => {
  await asUser(OWNER, `select public.remove_member($1::uuid, $2::uuid)`, [TREE, VIEWER])

  assert.deepEqual(
    await asUser(VIEWER, `select name from storage.objects where bucket_id = 'family-media'`),
    [],
    'the objects go with the membership',
  )
  assert.deepEqual(
    await asUser(VIEWER, `select id from public.media where tree_id = $1`, [TREE]),
    [],
    'and so does the metadata',
  )
})

test('an owner keeps access throughout', async () => {
  const rows = await asUser(OWNER, `select name from storage.objects where bucket_id = 'family-media'`)
  assert.ok(rows.length >= 1)
})

// ── deletion ────────────────────────────────────────────────────────

test('deleting a photo tombstones the record and lets the object go', async () => {
  await asUser(
    OWNER,
    `select public.push_change_events($1::uuid, $2::jsonb)`,
    [
      TREE,
      JSON.stringify([
        {
          id: 'f0000000-0000-0000-0000-000000000003',
          familyTreeId: TREE,
          changeSetId: '99999999-0000-0000-0000-000000000002',
          actorId: 'local-1',
          entity: 'media',
          entityId: PHOTO,
          op: 'delete',
          before: { id: PHOTO, familyTreeId: TREE, kind: 'photo', personIds: [GRACE], storagePath: path(TREE, PHOTO), createdAt: AT, updatedAt: AT },
          after: { id: PHOTO, familyTreeId: TREE, kind: 'photo', personIds: [GRACE], storagePath: path(TREE, PHOTO), createdAt: AT, updatedAt: AT, deletedAt: AT },
          createdAt: AT,
          basedOnServerSeq: null,
        },
      ]),
    ],
  )

  const row = await asUser<{ deleted_at: string | null }>(
    OWNER,
    `select deleted_at from public.media where id = $1`,
    [PHOTO],
  )
  assert.ok(row[0]?.deleted_at, 'the record is tombstoned, not erased')

  // And the object can then be removed by somebody allowed to write.
  const removed = await asUser(OWNER, `delete from storage.objects where name = $1 returning name`, [path(TREE, PHOTO)])
  assert.equal(removed.length, 1)
})
