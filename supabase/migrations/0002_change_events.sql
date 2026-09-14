-- FamilyTree — Milestone 3: the shared change log, and two-way sync.
--
-- Apply after 0001_cloud_trees.sql.
--
--
-- THE ONE BOUNDARY THAT HAS TO BE RIGHT
-- ─────────────────────────────────────
-- For an accepted event, all four of these happen together or none do:
--
--   1. the caller is authorised for the tree
--   2. the event is recorded, keeping its client-minted id
--   3. a serverSeq is assigned by the database
--   4. the canonical rows are updated to match
--
-- They are one function, so they are one transaction. There is no state
-- in which an event was accepted but the family did not change, and none
-- in which the family changed but no event says why. Doing this as
-- several client requests would create both.
--
-- Each event additionally gets its own subtransaction, so one malformed
-- event in a batch is rejected on its own rather than rolling back the
-- work of the events around it — otherwise a single bad row would block
-- the queue behind it forever.
--
--
-- WHY THE CANONICAL UPDATE IS A DELTA, NOT AN UPSERT
-- ──────────────────────────────────────────────────
-- This is subtle and it matters. The client reconciler merges per FIELD:
-- for each event in total order it applies only the fields that event
-- actually changed, so two devices editing different fields of one person
-- both keep their work.
--
-- If the server instead wrote each event's `after` snapshot wholesale,
-- the canonical rows would be whole-record last-writer-wins, and a device
-- bootstrapping from them would get a different family from a device that
-- reconciled the same events. Same inputs, two answers.
--
-- So the server applies exactly what the reconciler applies: the fields
-- where `after` differs from `before`, in serverSeq order. That is the
-- same algorithm, not an approximation of it, which is what keeps the
-- canonical rows and every client's merged state in agreement.

-- ════════════════════════════════════════════════════════════════════
-- The log
-- ════════════════════════════════════════════════════════════════════

create table public.change_events (
  -- The total order. A sequence, assigned by the database on insert, and
  -- the only authoritative ordering that exists. Never derived from a
  -- client clock, a clientSeq, a uuid or a timestamp.
  server_seq bigint generated always as identity primary key,

  -- The client-minted event id, and the idempotency key. Unique at the
  -- database level rather than remembered in a cache, because the retry
  -- this protects against is exactly the one where the client never
  -- learned what happened the first time.
  id uuid not null unique,

  tree_id uuid not null references public.family_trees (id) on delete cascade,
  change_set_id uuid not null,

  -- The device-local actor, carried for attribution only. Text because a
  -- local actor is not an account and its id is not in any namespace this
  -- database controls.
  actor_id text,

  -- Who actually pushed it, taken from auth.uid(). This is the only
  -- identity here the database trusts.
  account_id uuid not null references public.profiles (id),

  entity text not null,
  entity_id uuid not null,
  op text not null,
  before jsonb,
  after jsonb,

  -- The author's clock. Fine for display, never used for ordering.
  created_at timestamptz not null,

  -- How far the author's device had synced when it wrote this. Lets the
  -- reconciler tell a genuinely concurrent edit from a sequential one
  -- instead of inferring it from values.
  based_on_server_seq bigint,

  -- The server clock, set here and nowhere else.
  recorded_at timestamptz not null default now()
);

-- The pull query: everything for one tree after a cursor, in order.
create index change_events_by_tree_seq on public.change_events (tree_id, server_seq);

alter table public.change_events enable row level security;

-- Readable by members of the tree. Not writable by anybody through
-- ordinary table access: there is deliberately no insert, update or
-- delete policy and no write grant, so server_seq, recorded_at and
-- account_id cannot be manufactured by a client. The only way in is the
-- function below.
create policy change_events_read on public.change_events
  for select to authenticated
  using (public.is_tree_member(tree_id));

grant select on public.change_events to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Applying one event to the canonical rows
-- ════════════════════════════════════════════════════════════════════

-- The fields this event actually changed.
--
-- `after` is a complete snapshot, so the change is whatever differs from
-- `before`. A create has no `before`, and then everything in `after` is a
-- change.
--
-- THE KEYS ARE THE UNION OF BOTH SIDES, not just `after`. A field that is
-- present in `before` and absent from `after` has been CLEARED, and that
-- is every bit as much a change as one that gained a value — restoring a
-- deleted person works by dropping `deletedAt`, so walking only `after`
-- would leave the tombstone in place and the restore would silently do
-- nothing.
--
-- This mirrors `changedFields` in the client reconciler exactly, which is
-- the property that keeps the canonical rows and every client's merged
-- state in agreement. If one of the two ever changes, so must the other.
create or replace function public.event_delta(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
as $$
  with sides as (
    /*
      A CREATE carries `before: null`, and in jsonb that is the JSON null
      VALUE, not SQL NULL — so `coalesce` does not replace it and
      `jsonb_object_keys` is handed a scalar and raises.

      That is not hypothetical: it rejected every create event pushed from
      a real client, and went unnoticed because the tests written with
      this function only ever pushed updates. Anything that is not a JSON
      object is now treated as "no fields", which is what both SQL null
      and JSON null actually mean here.
    */
    select
      case when jsonb_typeof(p_before) = 'object' then p_before else '{}'::jsonb end as before,
      case when jsonb_typeof(p_after) = 'object' then p_after else '{}'::jsonb end as after
  )
  select coalesce(
    (
      select jsonb_object_agg(k, coalesce(sides.after -> k, 'null'::jsonb))
      from sides,
      lateral (
        select jsonb_object_keys(sides.after) as k
        union
        select jsonb_object_keys(sides.before) as k
      ) keys
      where (sides.before -> k) is distinct from (sides.after -> k)
    ),
    '{}'::jsonb
  );
$$;

-- Apply one event's delta to the row it describes.
--
-- Written out per entity and per column rather than generated, because
-- this is the step that decides what a family's records actually say and
-- it should be readable by somebody checking it. A column not named in
-- the delta keeps the value it has, which is the whole point.
--
-- If the row is absent the complete `after` snapshot is inserted, so an
-- update that arrives before its create still materialises a whole
-- record instead of being dropped.
create or replace function public.apply_change_event(
  p_tree_id uuid,
  p_entity text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := public.event_delta(p_before, p_after);
begin
  if p_after is null then
    raise exception 'An event with no after-snapshot cannot be applied.' using errcode = '22023';
  end if;

  if p_entity = 'familyTree' then
    insert into public.family_trees (id, name, description, created_at, updated_at, deleted_at, created_by)
    values (
      p_entity_id, p_after ->> 'name', p_after ->> 'description',
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz, auth.uid()
    )
    on conflict (id) do update set
      name        = case when d ? 'name'        then excluded.name        else family_trees.name end,
      description = case when d ? 'description' then excluded.description else family_trees.description end,
      updated_at  = case when d ? 'updatedAt'   then excluded.updated_at  else family_trees.updated_at end,
      deleted_at  = case when d ? 'deletedAt'   then excluded.deleted_at  else family_trees.deleted_at end;

  elsif p_entity = 'person' then
    insert into public.people (
      id, tree_id, first_name, last_name, gender, birth_date, death_date,
      is_placeholder, notes, profile_photo_id, created_at, updated_at, deleted_at
    )
    values (
      p_entity_id, p_tree_id,
      p_after ->> 'firstName', coalesce(p_after ->> 'lastName', ''), p_after ->> 'gender',
      p_after ->> 'birthDate', p_after ->> 'deathDate',
      (p_after ->> 'isPlaceholder')::boolean, p_after ->> 'notes',
      (p_after ->> 'profilePhotoId')::uuid,
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      first_name       = case when d ? 'firstName'      then excluded.first_name       else people.first_name end,
      last_name        = case when d ? 'lastName'       then excluded.last_name        else people.last_name end,
      gender           = case when d ? 'gender'         then excluded.gender           else people.gender end,
      birth_date       = case when d ? 'birthDate'      then excluded.birth_date       else people.birth_date end,
      death_date       = case when d ? 'deathDate'      then excluded.death_date       else people.death_date end,
      is_placeholder   = case when d ? 'isPlaceholder'  then excluded.is_placeholder   else people.is_placeholder end,
      notes            = case when d ? 'notes'          then excluded.notes            else people.notes end,
      profile_photo_id = case when d ? 'profilePhotoId' then excluded.profile_photo_id else people.profile_photo_id end,
      updated_at       = case when d ? 'updatedAt'      then excluded.updated_at       else people.updated_at end,
      deleted_at       = case when d ? 'deletedAt'      then excluded.deleted_at       else people.deleted_at end;

  elsif p_entity = 'parentLink' then
    insert into public.parent_links (
      id, tree_id, parent_id, child_id, relationship, created_at, updated_at, deleted_at
    )
    values (
      p_entity_id, p_tree_id,
      (p_after ->> 'parentId')::uuid, (p_after ->> 'childId')::uuid,
      (p_after ->> 'relationship')::public.parent_relationship,
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      relationship = case when d ? 'relationship' then excluded.relationship else parent_links.relationship end,
      updated_at   = case when d ? 'updatedAt'    then excluded.updated_at   else parent_links.updated_at end,
      deleted_at   = case when d ? 'deletedAt'    then excluded.deleted_at   else parent_links.deleted_at end;

  elsif p_entity = 'union' then
    insert into public.unions (
      id, tree_id, partner_a_id, partner_b_id, status, start_date, end_date,
      created_at, updated_at, deleted_at
    )
    values (
      p_entity_id, p_tree_id,
      (p_after ->> 'partnerAId')::uuid, (p_after ->> 'partnerBId')::uuid,
      (p_after ->> 'status')::public.union_status,
      p_after ->> 'startDate', p_after ->> 'endDate',
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      status     = case when d ? 'status'    then excluded.status     else unions.status end,
      start_date = case when d ? 'startDate' then excluded.start_date else unions.start_date end,
      end_date   = case when d ? 'endDate'   then excluded.end_date   else unions.end_date end,
      updated_at = case when d ? 'updatedAt' then excluded.updated_at else unions.updated_at end,
      deleted_at = case when d ? 'deletedAt' then excluded.deleted_at else unions.deleted_at end;

  elsif p_entity = 'familyGroup' then
    insert into public.family_groups (
      id, tree_id, name, origin_person_id, established_precision,
      established_date, established_label, notes, created_at, updated_at, deleted_at
    )
    values (
      p_entity_id, p_tree_id,
      p_after ->> 'name', (p_after ->> 'originPersonId')::uuid,
      coalesce((p_after ->> 'establishedPrecision')::public.family_origin_precision, 'unknown'),
      p_after ->> 'establishedDate', p_after ->> 'establishedLabel', p_after ->> 'notes',
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      name                  = case when d ? 'name'                 then excluded.name                  else family_groups.name end,
      origin_person_id      = case when d ? 'originPersonId'       then excluded.origin_person_id      else family_groups.origin_person_id end,
      established_precision = case when d ? 'establishedPrecision' then excluded.established_precision else family_groups.established_precision end,
      established_date      = case when d ? 'establishedDate'      then excluded.established_date      else family_groups.established_date end,
      established_label     = case when d ? 'establishedLabel'     then excluded.established_label     else family_groups.established_label end,
      notes                 = case when d ? 'notes'                then excluded.notes                 else family_groups.notes end,
      updated_at            = case when d ? 'updatedAt'            then excluded.updated_at            else family_groups.updated_at end,
      deleted_at            = case when d ? 'deletedAt'            then excluded.deleted_at            else family_groups.deleted_at end;

  elsif p_entity = 'familyGroupMember' then
    insert into public.family_group_members (
      id, tree_id, family_group_id, person_id, created_at, updated_at, deleted_at
    )
    values (
      p_entity_id, p_tree_id,
      (p_after ->> 'familyGroupId')::uuid, (p_after ->> 'personId')::uuid,
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      updated_at = case when d ? 'updatedAt' then excluded.updated_at else family_group_members.updated_at end,
      deleted_at = case when d ? 'deletedAt' then excluded.deleted_at else family_group_members.deleted_at end;

  else
    raise exception 'Unknown entity %', p_entity using errcode = '22023';
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- Push
-- ════════════════════════════════════════════════════════════════════

-- Accept a batch of events for one tree.
--
-- Returns a row per event saying exactly what happened to it, because an
-- empty successful response must never be read as "all accepted". Three
-- outcomes are distinguished:
--
--   accepted           recorded now, canonical rows updated
--   already_processed  this id was accepted before; the original
--                      serverSeq is returned and NOTHING is re-applied
--   rejected           refused, with the reason
--
-- Not re-applying an already-processed event is not an optimisation. The
-- canonical rows may have moved on since it was accepted, and writing its
-- old snapshot again would resurrect superseded values — which is exactly
-- the "subtle duplicate update" this whole design is trying to avoid.
create or replace function public.push_change_events(p_tree_id uuid, p_events jsonb)
returns table (
  event_id uuid,
  status text,
  server_seq bigint,
  recorded_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid := auth.uid();
  e jsonb;
  v_event_id uuid;
  v_seq bigint;
  v_recorded timestamptz;
begin
  if v_account is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Checked once, before anything is written. A caller who has lost
  -- membership, or who never had permission to write, gets nothing
  -- accepted — and finds out plainly rather than through a pile of
  -- per-event rejections.
  if not public.can_write_tree(p_tree_id) then
    raise exception 'You do not have permission to change this family tree.' using errcode = '42501';
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    v_event_id := null;
    v_seq := null;
    v_recorded := null;

    -- Its own subtransaction, so one bad event does not undo the batch.
    begin
      v_event_id := (e ->> 'id')::uuid;

      if (e ->> 'familyTreeId')::uuid is distinct from p_tree_id then
        raise exception 'That event belongs to a different family tree.' using errcode = '22023';
      end if;

      insert into public.change_events (
        id, tree_id, change_set_id, actor_id, account_id,
        entity, entity_id, op, before, after, created_at, based_on_server_seq
      )
      values (
        v_event_id, p_tree_id, (e ->> 'changeSetId')::uuid, e ->> 'actorId', v_account,
        e ->> 'entity', (e ->> 'entityId')::uuid, e ->> 'op',
        e -> 'before', e -> 'after',
        coalesce((e ->> 'createdAt')::timestamptz, now()),
        (e ->> 'basedOnServerSeq')::bigint
      )
      on conflict (id) do nothing
      returning change_events.server_seq, change_events.recorded_at into v_seq, v_recorded;

      if v_seq is null then
        -- Seen before. Hand back what it was given the first time and
        -- leave the canonical rows alone.
        select ce.server_seq, ce.recorded_at into v_seq, v_recorded
        from public.change_events ce where ce.id = v_event_id;

        event_id := v_event_id;
        status := 'already_processed';
        server_seq := v_seq;
        recorded_at := v_recorded;
        reason := null;
        return next;
      else
        perform public.apply_change_event(
          p_tree_id, e ->> 'entity', (e ->> 'entityId')::uuid, e -> 'before', e -> 'after'
        );

        event_id := v_event_id;
        status := 'accepted';
        server_seq := v_seq;
        recorded_at := v_recorded;
        reason := null;
        return next;
      end if;

    exception when others then
      event_id := v_event_id;
      status := 'rejected';
      server_seq := null;
      recorded_at := null;
      reason := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- Pull
-- ════════════════════════════════════════════════════════════════════
--
-- Plain selects under row-level security, so no function is needed: a
-- non-member's query simply returns nothing. The client asks for
-- server_seq greater than its cursor, ordered ascending, with a limit —
-- and pulls again while the server says there is more.
--
-- The one thing worth a helper is the tree's current head, which is what
-- bootstrap records as the position its rows are current as of.

-- Everything after a cursor, in sequence order.
--
-- SECURITY INVOKER, deliberately — the opposite choice from the
-- membership helpers. This runs as the caller, so the read policy on
-- change_events applies to it exactly as it would to a plain select, and
-- a non-member gets an empty result rather than somebody else's history.
-- It exists only to keep the cursor comparison and the limit on the
-- server, where they belong.
create or replace function public.pull_change_events(
  p_tree_id uuid,
  p_after bigint,
  p_limit int default 200
)
returns setof public.change_events
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select *
  from public.change_events
  where tree_id = p_tree_id
    and server_seq > coalesce(p_after, 0)
  order by server_seq asc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

create or replace function public.tree_head_seq(p_tree_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_tree_member(p_tree_id) then null
    else (select max(server_seq) from public.change_events where tree_id = p_tree_id)
  end;
$$;

grant execute on function public.push_change_events(uuid, jsonb) to authenticated;
grant execute on function public.pull_change_events(uuid, bigint, int) to authenticated;
grant execute on function public.tree_head_seq(uuid) to authenticated;
grant execute on function public.event_delta(jsonb, jsonb) to authenticated;
-- apply_change_event is deliberately NOT granted. It is an internal step
-- of push_change_events; exposing it would let a client change canonical
-- rows without an event to say why, which is the exact inconsistency the
-- single transaction above exists to prevent.
