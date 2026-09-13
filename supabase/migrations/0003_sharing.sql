-- FamilyTree — Milestone 4: sharing, membership and invitations.
--
-- Apply after 0002_change_events.sql.
--
--
-- THE SECURITY FAULT THIS MIGRATION FIXES FIRST
-- ─────────────────────────────────────────────
-- `profiles.email` is written by the client. ensure_profile() takes it as
-- a parameter, so any signed-in account can set its own profile email to
-- anything at all. That was harmless while nothing read it.
--
-- Sharing reads an email to decide who an invitation belongs to, and the
-- moment it does, a client-controlled email becomes a way to accept
-- somebody else's invitation. So this file takes the address from
-- auth.users — which Supabase writes from the verified Google identity
-- and no client can touch — and never from the profile or the payload.
--
-- ensure_profile is redefined below to stop accepting an email at all.
--
--
-- AND THE INVARIANT EVERYTHING ELSE RESTS ON
-- ──────────────────────────────────────────
-- Exactly one active owner per tree, enforced by a unique index rather
-- than by careful code. Ownership transfer demotes and promotes inside
-- one transaction, so no other session ever sees zero owners or two.

-- ════════════════════════════════════════════════════════════════════
-- The authoritative account email
-- ════════════════════════════════════════════════════════════════════

-- Who the provider says this is.
--
-- SECURITY DEFINER because auth.users is not readable by `authenticated`,
-- and narrow for the same reason the membership helpers are: it takes no
-- argument, looks only at auth.uid(), and returns one address — the
-- caller's own. There is no input that could make it report on anybody
-- else.
--
-- Normalised here, once, so that every comparison in this file is against
-- the same form and a stray capital letter can never decide who gets
-- access to a family.
create or replace function public.account_email()
returns text
language sql
stable
security definer
set search_path = auth, pg_temp
as $$
  select lower(trim(u.email))
  from auth.users u
  where u.id = auth.uid();
$$;

-- Redefined: the email is no longer accepted from the caller.
--
-- The display name still is, because it is cosmetic and the person is
-- entitled to choose it. The address is identity, and identity comes from
-- the provider.
create or replace function public.ensure_profile(p_display_name text default null)
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
  values (v_account, public.account_email(), p_display_name)
  on conflict (id) do update
    -- The address is refreshed from the provider every time; the name is
    -- only ever filled in if blank, so a person's own choice stands.
    set email = public.account_email(),
        display_name = coalesce(public.profiles.display_name, excluded.display_name)
  returning * into v_profile;

  return v_profile;
end;
$$;

-- The two-argument form is gone. Leaving it would leave the hole open.
drop function if exists public.ensure_profile(text, text);

-- Existing rows were populated from the client. Correct them from the
-- provider, so no profile carries an address its owner merely claimed.
update public.profiles p
set email = lower(trim(u.email))
from auth.users u
where u.id = p.id;

-- ════════════════════════════════════════════════════════════════════
-- Exactly one owner
-- ════════════════════════════════════════════════════════════════════

create unique index tree_members_single_owner
  on public.tree_members (tree_id)
  where role = 'owner' and status = 'active';

-- ════════════════════════════════════════════════════════════════════
-- Invitations
-- ════════════════════════════════════════════════════════════════════

create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'declined');

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees (id) on delete cascade,

  -- Normalised on the way in, and compared against account_email() on the
  -- way out. Membership is never inferred from an address alone: it is
  -- what an invitation is ADDRESSED to, and accepting still requires
  -- being signed in as the account the provider gave that address to.
  email text not null,

  -- Owner is deliberately not invitable. There is one owner and it
  -- changes by transfer, not by invitation.
  role public.family_role not null,
  invited_by uuid not null references public.profiles (id),
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null,

  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  declined_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invitations_invitable_role check (role in ('editor', 'viewer')),
  constraint invitations_email_normalised check (email = lower(trim(email)))
);

-- One live offer per person per tree. Partial, so a revoked or declined
-- invitation stays for the record without blocking a fresh one.
create unique index invitations_one_pending
  on public.invitations (tree_id, email)
  where status = 'pending';

create index invitations_by_email on public.invitations (email) where status = 'pending';
create index invitations_by_tree on public.invitations (tree_id);

alter table public.invitations enable row level security;

-- ════════════════════════════════════════════════════════════════════
-- Who administers a tree
-- ════════════════════════════════════════════════════════════════════

create or replace function public.is_tree_owner(target_tree uuid)
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
      and tm.role = 'owner'
  );
$$;

-- ── invitation visibility ───────────────────────────────────────────
--
-- Two ways to see an invitation and no others: you own the tree it is
-- for, or it is addressed to you. That is what stops this table becoming
-- a directory — without it, a signed-in stranger could read every pending
-- invitation and learn the family names and email addresses of people who
-- have nothing to do with them.
--
-- There is no insert, update or delete policy and no write grant.
-- Invitations are created, revoked, accepted and declined only through
-- the functions below.
create policy invitations_read on public.invitations
  for select to authenticated
  using (
    public.is_tree_owner(tree_id)
    or email = public.account_email()
  );

grant select on public.invitations to authenticated;

-- ── profiles of people you share a tree with ────────────────────────
--
-- A member list that could not show names or addresses would be useless,
-- so this widens the M2 policy by exactly as much as the product needs:
-- the profiles of people who share an active membership with you. Not
-- everybody, and not anybody you merely invited.
create policy profiles_read_shared on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.tree_members mine
      join public.tree_members theirs on theirs.tree_id = mine.tree_id
      where mine.account_id = auth.uid()
        and mine.status = 'active'
        and theirs.account_id = public.profiles.id
        and theirs.status = 'active'
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- Governance operations
-- ════════════════════════════════════════════════════════════════════
--
-- One function per operation, each enforcing its own invariants. There is
-- deliberately no general "update membership" function: a single entry
-- point taking a role and a target is a single place to get wrong, and
-- every caller of it would have to be trusted with every invariant.
--
-- All of them take the caller from auth.uid(), all check permission
-- server-side, and all pin search_path.

-- ── invite ──────────────────────────────────────────────────────────
create or replace function public.create_invitation(
  p_tree_id uuid,
  p_email text,
  p_role public.family_role,
  p_valid_days int default 14
)
returns public.invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_invitation public.invitations;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not public.is_tree_owner(p_tree_id) then
    raise exception 'Only the owner can invite people to this family tree.' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'People can be invited as an editor or a viewer.' using errcode = '22023';
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;
  if v_email = public.account_email() then
    raise exception 'You are already in this family tree.' using errcode = '22023';
  end if;

  -- Somebody already here does not need an invitation, and issuing one
  -- would imply their access depends on accepting it.
  if exists (
    select 1
    from public.tree_members tm
    join public.profiles pr on pr.id = tm.account_id
    where tm.tree_id = p_tree_id and tm.status = 'active' and pr.email = v_email
  ) then
    raise exception 'That person is already in this family tree.' using errcode = '22023';
  end if;

  insert into public.invitations (tree_id, email, role, invited_by, expires_at)
  values (p_tree_id, v_email, p_role, auth.uid(), now() + make_interval(days => greatest(coalesce(p_valid_days, 14), 1)))
  on conflict (tree_id, email) where status = 'pending'
  do update set
    role = excluded.role,
    expires_at = excluded.expires_at,
    invited_by = excluded.invited_by,
    updated_at = now()
  returning * into v_invitation;

  return v_invitation;
end;
$$;

-- ── revoke ──────────────────────────────────────────────────────────
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns public.invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id;
  if v_invitation.id is null then
    raise exception 'That invitation no longer exists.' using errcode = '22023';
  end if;
  if not public.is_tree_owner(v_invitation.tree_id) then
    raise exception 'Only the owner can withdraw an invitation.' using errcode = '42501';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'That invitation is no longer pending.' using errcode = '22023';
  end if;

  -- Withdrawn, not deleted. The record that it was offered and taken back
  -- is worth keeping, and a deleted row cannot be audited.
  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = p_invitation_id
  returning * into v_invitation;

  return v_invitation;
end;
$$;

-- ── what am I invited to ────────────────────────────────────────────
--
-- SECURITY DEFINER because the point is to show somebody a family they
-- cannot yet read: the tree name comes from a row their membership does
-- not cover. Narrow accordingly — it takes no argument and returns only
-- rows addressed to the caller's own verified address.
create or replace function public.my_invitations()
returns table (
  id uuid,
  tree_id uuid,
  tree_name text,
  role public.family_role,
  invited_by_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.tree_id, t.name, i.role, coalesce(pr.display_name, pr.email), i.expires_at
  from public.invitations i
  join public.family_trees t on t.id = i.tree_id
  left join public.profiles pr on pr.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email = public.account_email()
  order by i.created_at desc;
$$;

-- ── accept ──────────────────────────────────────────────────────────
--
-- One transaction: the membership appears and the invitation is marked in
-- the same breath, so there is no state where somebody has access without
-- a record of how they got it.
create or replace function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid := auth.uid();
  v_invitation public.invitations;
  v_existing public.tree_members;
begin
  if v_account is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select * into v_invitation from public.invitations where id = p_invitation_id for update;

  -- Every refusal below says the same thing, on purpose. A caller who
  -- guesses an invitation id must not be able to tell "that is not yours"
  -- from "that does not exist" — either answer would confirm the id.
  if v_invitation.id is null
     or v_invitation.email is distinct from public.account_email() then
    raise exception 'That invitation is not available.' using errcode = '42501';
  end if;

  if v_invitation.status = 'accepted' and v_invitation.accepted_by = v_account then
    -- Accepting twice is not an error; it is a retry.
    return v_invitation.tree_id;
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'That invitation is no longer open.' using errcode = '22023';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception 'That invitation has expired.' using errcode = '22023';
  end if;

  perform public.ensure_profile();

  select * into v_existing
  from public.tree_members
  where tree_id = v_invitation.tree_id and account_id = v_account and status = 'active';

  if v_existing.id is null then
    insert into public.tree_members (tree_id, account_id, role, status)
    values (v_invitation.tree_id, v_account, v_invitation.role, 'active');
  end if;
  -- An existing membership is left exactly as it is. Accepting an
  -- invitation must never quietly change a role somebody already holds —
  -- least of all downgrade an owner.

  update public.invitations
  set status = 'accepted', accepted_by = v_account, accepted_at = now(), updated_at = now()
  where id = p_invitation_id;

  return v_invitation.tree_id;
end;
$$;

-- ── decline ─────────────────────────────────────────────────────────
create or replace function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id;
  if v_invitation.id is null
     or v_invitation.email is distinct from public.account_email() then
    raise exception 'That invitation is not available.' using errcode = '42501';
  end if;
  if v_invitation.status <> 'pending' then
    return;
  end if;

  update public.invitations
  set status = 'declined', declined_at = now(), updated_at = now()
  where id = p_invitation_id;
end;
$$;

-- ── change a role ───────────────────────────────────────────────────
create or replace function public.change_member_role(
  p_tree_id uuid,
  p_account_id uuid,
  p_role public.family_role
)
returns public.tree_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.tree_members;
begin
  if not public.is_tree_owner(p_tree_id) then
    raise exception 'Only the owner can change what someone may do.' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    -- Ownership is not a role you are given; it is transferred.
    raise exception 'A member can be an editor or a viewer.' using errcode = '22023';
  end if;
  if p_account_id = auth.uid() then
    raise exception 'Transfer ownership instead of changing your own role.' using errcode = '22023';
  end if;

  update public.tree_members
  set role = p_role, updated_at = now()
  where tree_id = p_tree_id and account_id = p_account_id and status = 'active'
  returning * into v_member;

  if v_member.id is null then
    raise exception 'That person is not in this family tree.' using errcode = '22023';
  end if;
  return v_member;
end;
$$;

-- ── remove ──────────────────────────────────────────────────────────
create or replace function public.remove_member(p_tree_id uuid, p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.tree_members;
begin
  if not public.is_tree_owner(p_tree_id) then
    raise exception 'Only the owner can remove someone.' using errcode = '42501';
  end if;
  if p_account_id = auth.uid() then
    raise exception 'Transfer ownership before leaving this family tree.' using errcode = '22023';
  end if;

  -- Suspended, not deleted: access ends immediately because every policy
  -- tests for an ACTIVE membership, and the row remains as a record that
  -- they were here. Nothing on their own device is touched — this removes
  -- cloud access, not somebody's copy of their family history.
  update public.tree_members
  set status = 'suspended', updated_at = now()
  where tree_id = p_tree_id and account_id = p_account_id and status = 'active'
  returning * into v_member;

  if v_member.id is null then
    raise exception 'That person is not in this family tree.' using errcode = '22023';
  end if;
end;
$$;

-- ── transfer ownership ──────────────────────────────────────────────
--
-- Demote then promote, in one transaction. Between the two statements
-- the tree has no owner, which is why they must not be two requests: no
-- other session can observe that state, and if anything fails both are
-- undone. The unique index makes the two-owner state impossible outright.
create or replace function public.transfer_ownership(p_tree_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.tree_members;
begin
  if not public.is_tree_owner(p_tree_id) then
    raise exception 'Only the owner can hand this family tree on.' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'You already own this family tree.' using errcode = '22023';
  end if;

  select * into v_target
  from public.tree_members
  where tree_id = p_tree_id and account_id = p_new_owner and status = 'active';

  if v_target.id is null then
    -- Ownership goes to somebody already in the family, never to an
    -- address that has not accepted an invitation.
    raise exception 'Ownership can only pass to someone already in this family tree.' using errcode = '22023';
  end if;

  update public.tree_members
  set role = 'editor', updated_at = now()
  where tree_id = p_tree_id and account_id = auth.uid() and status = 'active';

  update public.tree_members
  set role = 'owner', updated_at = now()
  where id = v_target.id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- Grants
-- ════════════════════════════════════════════════════════════════════

grant execute on function public.account_email() to authenticated;
grant execute on function public.ensure_profile(text) to authenticated;
grant execute on function public.is_tree_owner(uuid) to authenticated;
grant execute on function public.create_invitation(uuid, text, public.family_role, int) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.my_invitations() to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
grant execute on function public.change_member_role(uuid, uuid, public.family_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
