-- FamilyTree — Milestone 2: cloud trees and row-level security.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the
-- SQL editor of a project. It is written to be run exactly once, in order,
-- and to be readable by somebody deciding whether to trust it with their
-- family's records.
--
--
-- WHAT THIS FILE IS FOR
-- ─────────────────────
-- The local application is authoritative for editing; this is where a
-- tree goes when somebody explicitly chooses to save it to their account.
-- There is no synchronisation here yet — no sequence, no change log, no
-- conflict resolution. Those arrive in a later milestone and this schema
-- is shaped so they can be added without moving anything.
--
--
-- IDS COME FROM THE CLIENT, AND THAT IS DELIBERATE
-- ────────────────────────────────────────────────
-- Every record in the application is already minted with
-- crypto.randomUUID(). Those ids are kept verbatim as primary keys here,
-- so adopting a tree rewrites nothing, a record created offline can be
-- uploaded later under the id it was born with, and a tree that is
-- downloaded again is recognisably the same tree.
--
--
-- THE DATABASE IS THE AUTHORITY
-- ─────────────────────────────
-- The client has a permission model (lib/policy/can.ts). It decides which
-- buttons to grey out and nothing else. Every rule that matters is below,
-- enforced by row-level security against auth.uid(), which a client
-- cannot set. No policy anywhere reads a value the client supplied.

-- ════════════════════════════════════════════════════════════════════
-- Types
-- ════════════════════════════════════════════════════════════════════

-- Mirrors FamilyRole in lib/policy/membershipTypes.ts. All four exist
-- here because the application's model has four; this milestone only ever
-- creates `owner`, and `admin` has no path to being granted yet.
create type public.family_role as enum ('owner', 'admin', 'editor', 'viewer');

-- Mirrors MembershipStatus. Revoking access is a status change rather
-- than a deletion, so it stays auditable — the same reasoning the local
-- model gives for having no deletedAt on a membership.
create type public.membership_status as enum ('active', 'invited', 'suspended', 'left');

-- Mirrors ParentRelationship and UnionStatus exactly.
create type public.parent_relationship as enum ('biological', 'adopted', 'step', 'foster');
create type public.union_status as enum (
  'married', 'partnered', 'engaged', 'divorced', 'separated', 'widowed'
);

-- Mirrors FamilyOriginPrecision.
create type public.family_origin_precision as enum (
  'exact', 'month', 'year', 'approximate', 'unknown'
);

-- ════════════════════════════════════════════════════════════════════
-- Accounts
-- ════════════════════════════════════════════════════════════════════

-- The account, and nothing else about the person.
--
-- No preferences, no avatar, no settings: none of those exist in the
-- application yet, and a column nobody writes is a column somebody later
-- has to work out the meaning of. The id IS the Supabase Auth user id, so
-- there is exactly one identity rather than a cloud id mapped to an auth
-- id.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- Trees and membership
-- ════════════════════════════════════════════════════════════════════

create table public.family_trees (
  id uuid primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Provenance only. Who may do what comes from tree_members, so that
  -- there is one answer to "what is this person allowed to do" rather
  -- than a column and a table that can disagree.
  created_by uuid not null references public.profiles (id)
);

create table public.tree_members (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  account_id uuid not null references public.profiles (id) on delete cascade,
  role public.family_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live membership per person per tree. Partial, so a suspended row
-- stays for the audit trail without blocking a later legitimate one —
-- the same reason the local schema keeps its governance indexes
-- non-unique and enforces uniqueness where "ignoring revoked" can be
-- expressed.
create unique index tree_members_one_active
  on public.tree_members (tree_id, account_id)
  where status = 'active';

-- The index every policy in this file depends on: membership is checked
-- on every row of every read, so it must be a lookup rather than a scan.
create index tree_members_by_account
  on public.tree_members (account_id, tree_id)
  where status = 'active';

-- ════════════════════════════════════════════════════════════════════
-- The family itself
-- ════════════════════════════════════════════════════════════════════

-- Dates are text, not date.
--
-- Person.birthDate is a string in the application and may be partial or
-- approximate — a real family archive contains "1923" and "before the
-- war". A date column would reject exactly the records most worth
-- keeping. Timestamps that the SYSTEM writes (created_at and friends) are
-- real timestamps, because those are always complete.
create table public.people (
  id uuid primary key,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  gender text not null,
  birth_date text,
  death_date text,
  is_placeholder boolean,
  notes text,
  profile_photo_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- Deletion is a tombstone everywhere in this application, so that the
  -- record can come back and the history stays replayable.
  deleted_at timestamptz
);

create index people_by_tree on public.people (tree_id);

create table public.parent_links (
  id uuid primary key,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  parent_id uuid not null references public.people (id) on delete cascade,
  child_id uuid not null references public.people (id) on delete cascade,
  relationship public.parent_relationship not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  -- A person is not their own parent. The relationship engine enforces
  -- the full acyclicity rule; this catches the one case a single row can
  -- express on its own.
  constraint parent_links_not_self check (parent_id <> child_id)
);

create index parent_links_by_tree on public.parent_links (tree_id);
create index parent_links_by_child on public.parent_links (child_id);
create index parent_links_by_parent on public.parent_links (parent_id);

-- One live link per parent/child pair, matching what lib/storage already
-- refuses to write twice. Partial so a tombstoned link does not
-- permanently occupy the pair.
create unique index parent_links_unique_live
  on public.parent_links (parent_id, child_id)
  where deleted_at is null;

-- No unique constraint on the partners.
--
-- Deliberate: Union's own documentation says a person may appear in
-- several unions over time, and nothing in the model forbids two records
-- for the same pair. Inventing a constraint here that the application
-- does not have would make a tree that works locally fail to upload.
create table public.unions (
  id uuid primary key,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  partner_a_id uuid not null references public.people (id) on delete cascade,
  partner_b_id uuid not null references public.people (id) on delete cascade,
  status public.union_status not null,
  start_date text,
  end_date text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  constraint unions_two_people check (partner_a_id <> partner_b_id)
);

create index unions_by_tree on public.unions (tree_id);
create index unions_by_partner_a on public.unions (partner_a_id);
create index unions_by_partner_b on public.unions (partner_b_id);

create table public.family_groups (
  id uuid primary key,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  name text not null,
  -- The single source of truth for "who founded this family", exactly as
  -- the local model has it. Set null rather than cascading: losing the
  -- founder must not delete the branch.
  origin_person_id uuid references public.people (id) on delete set null,
  established_precision public.family_origin_precision not null,
  established_date text,
  established_label text,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create index family_groups_by_tree on public.family_groups (tree_id);

create table public.family_group_members (
  id uuid primary key,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  family_group_id uuid not null references public.family_groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create index family_group_members_by_tree on public.family_group_members (tree_id);
create index family_group_members_by_group on public.family_group_members (family_group_id);

-- Mirrors the local `&[familyGroupId+personId]` unique index — a person
-- cannot be in the same branch twice.
create unique index family_group_members_unique_live
  on public.family_group_members (family_group_id, person_id)
  where deleted_at is null;

-- ════════════════════════════════════════════════════════════════════
-- Who may do what
-- ════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER, and it has to be.
--
-- tree_members has row-level security of its own, so a policy on `people`
-- that selected from it directly would have that select filtered by the
-- very policy being evaluated. Running the membership check as the
-- function's owner steps outside that, which is the standard way to
-- express "joined authorisation" in Postgres.
--
-- It is safe because it is narrow: it takes a tree id, it only ever looks
-- at rows for auth.uid(), and it returns a boolean. There is no argument
-- that can make it report on somebody else, and nothing it returns can
-- leak a row. search_path is pinned so a caller cannot shadow
-- `tree_members` with their own table.
create or replace function public.is_tree_member(target_tree uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tree_members tm
    where tm.tree_id = target_tree
      and tm.account_id = auth.uid()
      and tm.status = 'active'
  );
$$;

-- Editing requires a role that outranks viewer. Same shape, same
-- reasoning, and the rank order matches ROLE_RANK in the application so
-- the interface and the database never disagree about who may write.
create or replace function public.can_write_tree(target_tree uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tree_members tm
    where tm.tree_id = target_tree
      and tm.account_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'editor')
  );
$$;

-- ════════════════════════════════════════════════════════════════════
-- Row-level security
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.family_trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.people enable row level security;
alter table public.parent_links enable row level security;
alter table public.unions enable row level security;
alter table public.family_groups enable row level security;
alter table public.family_group_members enable row level security;

-- Postgres denies by default once RLS is on, so every capability below
-- is one that was explicitly decided. Anything not written here is
-- refused, which is the right way round.

-- ── profiles ────────────────────────────────────────────────────────
-- Your own profile, and nobody else's. Sharing will need to widen this
-- to "profiles of people I share a tree with"; it is narrow until then
-- rather than open in anticipation.
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy. Profiles are created by ensure_profile() below, so
-- that a row can never be created for an id the caller does not own.

-- ── family_trees ────────────────────────────────────────────────────
create policy family_trees_read on public.family_trees
  for select to authenticated
  using (public.is_tree_member(id));

create policy family_trees_update on public.family_trees
  for update to authenticated
  using (public.can_write_tree(id))
  with check (public.can_write_tree(id));

-- No insert policy, and no delete policy.
--
-- A tree is created only by adopt_family_tree(), because creating one is
-- inseparable from becoming its owner and those two must happen together
-- or not at all. Deleting a whole family is an owner-only action that
-- belongs with the rest of governance.

-- ── tree_members ────────────────────────────────────────────────────
-- Readable so the application can say who is in a tree. Not writable at
-- all, by anybody, ever, through this path.
--
-- THIS IS THE POINT OF THE WHOLE FILE. If a client could insert a row
-- here it could make itself the owner of any tree whose id it could
-- guess. There is deliberately no insert, update or delete policy on
-- this table; membership changes go through functions that check the
-- caller's existing rank.
create policy tree_members_read on public.tree_members
  for select to authenticated
  using (public.is_tree_member(tree_id));

-- ── the family ──────────────────────────────────────────────────────
-- Eight identical shapes, one per table. Read if you are a member; write
-- if your role outranks viewer. Written out rather than generated so
-- that each one can be read and checked on its own.

create policy people_read on public.people
  for select to authenticated using (public.is_tree_member(tree_id));
create policy people_insert on public.people
  for insert to authenticated with check (public.can_write_tree(tree_id));
create policy people_update on public.people
  for update to authenticated
  using (public.can_write_tree(tree_id)) with check (public.can_write_tree(tree_id));
create policy people_delete on public.people
  for delete to authenticated using (public.can_write_tree(tree_id));

create policy parent_links_read on public.parent_links
  for select to authenticated using (public.is_tree_member(tree_id));
create policy parent_links_insert on public.parent_links
  for insert to authenticated with check (public.can_write_tree(tree_id));
create policy parent_links_update on public.parent_links
  for update to authenticated
  using (public.can_write_tree(tree_id)) with check (public.can_write_tree(tree_id));
create policy parent_links_delete on public.parent_links
  for delete to authenticated using (public.can_write_tree(tree_id));

create policy unions_read on public.unions
  for select to authenticated using (public.is_tree_member(tree_id));
create policy unions_insert on public.unions
  for insert to authenticated with check (public.can_write_tree(tree_id));
create policy unions_update on public.unions
  for update to authenticated
  using (public.can_write_tree(tree_id)) with check (public.can_write_tree(tree_id));
create policy unions_delete on public.unions
  for delete to authenticated using (public.can_write_tree(tree_id));

create policy family_groups_read on public.family_groups
  for select to authenticated using (public.is_tree_member(tree_id));
create policy family_groups_insert on public.family_groups
  for insert to authenticated with check (public.can_write_tree(tree_id));
create policy family_groups_update on public.family_groups
  for update to authenticated
  using (public.can_write_tree(tree_id)) with check (public.can_write_tree(tree_id));
create policy family_groups_delete on public.family_groups
  for delete to authenticated using (public.can_write_tree(tree_id));

create policy family_group_members_read on public.family_group_members
  for select to authenticated using (public.is_tree_member(tree_id));
create policy family_group_members_insert on public.family_group_members
  for insert to authenticated with check (public.can_write_tree(tree_id));
create policy family_group_members_update on public.family_group_members
  for update to authenticated
  using (public.can_write_tree(tree_id)) with check (public.can_write_tree(tree_id));
create policy family_group_members_delete on public.family_group_members
  for delete to authenticated using (public.can_write_tree(tree_id));

-- ════════════════════════════════════════════════════════════════════
-- The two governance primitives this milestone needs
-- ════════════════════════════════════════════════════════════════════

-- Make sure this account has a profile row.
--
-- Lazy rather than a trigger on auth.users: a profile is needed the first
-- time somebody touches the cloud, and nothing before then. Safe to call
-- repeatedly.
create or replace function public.ensure_profile(p_email text default null, p_display_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_account is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  insert into public.profiles (id, email, display_name)
  values (v_account, p_email, p_display_name)
  on conflict (id) do update
    -- Only fill blanks. A name the person has since changed should not be
    -- overwritten by whatever the provider happened to send this time.
    set email = coalesce(public.profiles.email, excluded.email),
        display_name = coalesce(public.profiles.display_name, excluded.display_name)
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Save a local family tree to the signed-in account.
--
-- ONE TRANSACTION, ON PURPOSE. A function body is a transaction, so
-- either the tree, the owner membership and every person, link, union and
-- branch arrive together, or nothing does. There is no state in which a
-- tree exists in the cloud without an owner, and none in which half a
-- family is uploaded — which is what "safe against partial failure"
-- has to mean for something somebody is trusting with their family.
--
-- The account is taken from auth.uid() and never from the payload. A
-- caller cannot adopt a tree on somebody else's behalf, and cannot take
-- over a tree that another account has already saved.
create or replace function public.adopt_family_tree(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid := auth.uid();
  v_tree jsonb := payload -> 'familyTree';
  v_tree_id uuid;
begin
  if v_account is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if v_tree is null then
    raise exception 'That backup does not contain a family tree.' using errcode = '22023';
  end if;

  v_tree_id := (v_tree ->> 'id')::uuid;

  -- Somebody else has already saved this tree, or this account has.
  -- Either way it is not adopted again: a second copy under the same id
  -- is impossible, and silently merging into an existing one would be a
  -- synchronisation, which this milestone deliberately does not do.
  if exists (select 1 from public.family_trees t where t.id = v_tree_id) then
    raise exception 'That family tree is already saved to an account.' using errcode = '23505';
  end if;

  perform public.ensure_profile();

  insert into public.family_trees (id, name, description, created_at, updated_at, deleted_at, created_by)
  values (
    v_tree_id,
    v_tree ->> 'name',
    v_tree ->> 'description',
    coalesce((v_tree ->> 'createdAt')::timestamptz, now()),
    coalesce((v_tree ->> 'updatedAt')::timestamptz, now()),
    (v_tree ->> 'deletedAt')::timestamptz,
    v_account
  );

  insert into public.tree_members (tree_id, account_id, role, status)
  values (v_tree_id, v_account, 'owner', 'active');

  -- People first: everything else references them.
  insert into public.people (
    id, tree_id, first_name, last_name, gender, birth_date, death_date,
    is_placeholder, notes, profile_photo_id, created_at, updated_at, deleted_at
  )
  select
    (row ->> 'id')::uuid, v_tree_id,
    row ->> 'firstName', coalesce(row ->> 'lastName', ''), row ->> 'gender',
    row ->> 'birthDate', row ->> 'deathDate',
    (row ->> 'isPlaceholder')::boolean, row ->> 'notes',
    (row ->> 'profilePhotoId')::uuid,
    (row ->> 'createdAt')::timestamptz, (row ->> 'updatedAt')::timestamptz,
    (row ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'people', '[]'::jsonb)) as row;

  insert into public.parent_links (
    id, tree_id, parent_id, child_id, relationship, created_at, updated_at, deleted_at
  )
  select
    (row ->> 'id')::uuid, v_tree_id,
    (row ->> 'parentId')::uuid, (row ->> 'childId')::uuid,
    (row ->> 'relationship')::public.parent_relationship,
    (row ->> 'createdAt')::timestamptz, (row ->> 'updatedAt')::timestamptz,
    (row ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'parentLinks', '[]'::jsonb)) as row;

  insert into public.unions (
    id, tree_id, partner_a_id, partner_b_id, status, start_date, end_date,
    created_at, updated_at, deleted_at
  )
  select
    (row ->> 'id')::uuid, v_tree_id,
    (row ->> 'partnerAId')::uuid, (row ->> 'partnerBId')::uuid,
    (row ->> 'status')::public.union_status,
    row ->> 'startDate', row ->> 'endDate',
    (row ->> 'createdAt')::timestamptz, (row ->> 'updatedAt')::timestamptz,
    (row ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'unions', '[]'::jsonb)) as row;

  insert into public.family_groups (
    id, tree_id, name, origin_person_id, established_precision,
    established_date, established_label, notes, created_at, updated_at, deleted_at
  )
  select
    (row ->> 'id')::uuid, v_tree_id,
    row ->> 'name', (row ->> 'originPersonId')::uuid,
    (row ->> 'establishedPrecision')::public.family_origin_precision,
    row ->> 'establishedDate', row ->> 'establishedLabel', row ->> 'notes',
    (row ->> 'createdAt')::timestamptz, (row ->> 'updatedAt')::timestamptz,
    (row ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'familyGroups', '[]'::jsonb)) as row;

  insert into public.family_group_members (
    id, tree_id, family_group_id, person_id, created_at, updated_at, deleted_at
  )
  select
    (row ->> 'id')::uuid, v_tree_id,
    (row ->> 'familyGroupId')::uuid, (row ->> 'personId')::uuid,
    (row ->> 'createdAt')::timestamptz, (row ->> 'updatedAt')::timestamptz,
    (row ->> 'deletedAt')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'familyGroupMembers', '[]'::jsonb)) as row;

  return v_tree_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- Grants
-- ════════════════════════════════════════════════════════════════════
--
-- Table privileges are the outer gate and row-level security the inner
-- one; both have to admit a statement. `anon` is granted nothing at all,
-- so an unauthenticated request cannot reach any of this even before a
-- policy is consulted.

grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.family_trees to authenticated;
grant select on public.tree_members to authenticated;

grant select, insert, update, delete on public.people to authenticated;
grant select, insert, update, delete on public.parent_links to authenticated;
grant select, insert, update, delete on public.unions to authenticated;
grant select, insert, update, delete on public.family_groups to authenticated;
grant select, insert, update, delete on public.family_group_members to authenticated;

grant execute on function public.ensure_profile(text, text) to authenticated;
grant execute on function public.adopt_family_tree(jsonb) to authenticated;
grant execute on function public.is_tree_member(uuid) to authenticated;
grant execute on function public.can_write_tree(uuid) to authenticated;
