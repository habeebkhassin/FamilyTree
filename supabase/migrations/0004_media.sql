-- FamilyTree — Milestone 5: photographs.
--
-- Apply after 0003_sharing.sql.
--
--
-- TWO SYSTEMS, AND THEY ARE NOT ONE TRANSACTION
-- ─────────────────────────────────────────────
-- Postgres holds what a photograph IS — whose it is, when it was taken,
-- where its bytes live, whether it was deleted. Storage holds the bytes.
-- No amount of care makes a row and an object commit together, so the
-- client writes the bytes first and the path second: an interrupted
-- upload leaves an unreferenced object, which the next attempt overwrites
-- at the same derived path, rather than a path pointing at nothing.
--
-- The metadata travels as an ordinary ChangeEvent through the log built
-- in Milestone 3. There is no second synchronisation system here, and the
-- media row below is written by the same push function as every other
-- record.
--
--
-- THE BUCKET IS PRIVATE, AND THE PATH IS NOT THE SECURITY
-- ───────────────────────────────────────────────────────
-- A family's photographs are the most personal thing this application
-- holds. The bucket is not public, and access is not granted by knowing
-- an obscure path: every storage policy below joins the object's path
-- back to `tree_members` through the same is_tree_member the rest of the
-- schema uses. An object under another family's folder is refused even
-- to somebody who guessed it exactly.

-- ════════════════════════════════════════════════════════════════════
-- Metadata
-- ════════════════════════════════════════════════════════════════════

create table public.media (
  id uuid primary key,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  kind text not null,
  title text,
  body text,
  date text,
  -- Denormalised from the application's own model, which carries the
  -- people a photograph is of as a list on the record.
  person_ids uuid[] not null default '{}',
  -- Derived from the tree and media ids, never chosen by a client. Null
  -- until the bytes have actually arrived, which is what marks a photo as
  -- still only on somebody's device.
  storage_path text,
  thumbnail_path text,
  content_type text,
  byte_size bigint,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create index media_by_tree on public.media (tree_id);

alter table public.media enable row level security;

create policy media_read on public.media
  for select to authenticated using (public.is_tree_member(tree_id));
create policy media_insert on public.media
  for insert to authenticated with check (public.can_write_tree(tree_id));
create policy media_update on public.media
  for update to authenticated
  using (public.can_write_tree(tree_id)) with check (public.can_write_tree(tree_id));
create policy media_delete on public.media
  for delete to authenticated using (public.can_write_tree(tree_id));

grant select, insert, update, delete on public.media to authenticated;

-- ── the push function learns one more entity ────────────────────────
--
-- Replaced rather than added to, because apply_change_event is one
-- function with one case per entity and media is now one of them. Same
-- delta rule as everything else: only the fields the event changed.
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

  elsif p_entity = 'media' then
    /*
      The storage paths are recomputed here rather than taken from the
      event.

      Everything else on this record is the client's to describe — a
      title, who is in the photograph — but where the bytes live is not a
      description, it is a location, and a client that could choose it
      could name another family's folder. It is derived from the tree and
      media ids the server already has, so the row can only ever point at
      the one object that belongs to it.

      Null until the client says the bytes arrived, which is what the
      presence of storagePath in the event means.
    */
    insert into public.media (
      id, tree_id, kind, title, body, date, person_ids,
      storage_path, thumbnail_path, content_type, byte_size,
      created_at, updated_at, deleted_at
    )
    values (
      p_entity_id, p_tree_id,
      coalesce(p_after ->> 'kind', 'photo'),
      p_after ->> 'title', p_after ->> 'body', p_after ->> 'date',
      coalesce(
        (select array_agg(value::uuid) from jsonb_array_elements_text(p_after -> 'personIds')),
        '{}'::uuid[]
      ),
      case when p_after ? 'storagePath'
        then 'trees/' || p_tree_id || '/media/' || p_entity_id || '/original' end,
      case when p_after ? 'thumbnailPath'
        then 'trees/' || p_tree_id || '/media/' || p_entity_id || '/thumbnail' end,
      p_after ->> 'contentType',
      (p_after ->> 'byteSize')::bigint,
      coalesce((p_after ->> 'createdAt')::timestamptz, now()),
      coalesce((p_after ->> 'updatedAt')::timestamptz, now()),
      (p_after ->> 'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      kind           = case when d ? 'kind'        then excluded.kind        else media.kind end,
      title          = case when d ? 'title'       then excluded.title       else media.title end,
      body           = case when d ? 'body'        then excluded.body        else media.body end,
      date           = case when d ? 'date'        then excluded.date        else media.date end,
      person_ids     = case when d ? 'personIds'   then excluded.person_ids  else media.person_ids end,
      storage_path   = case when d ? 'storagePath'   then excluded.storage_path   else media.storage_path end,
      thumbnail_path = case when d ? 'thumbnailPath' then excluded.thumbnail_path else media.thumbnail_path end,
      content_type   = case when d ? 'contentType' then excluded.content_type else media.content_type end,
      byte_size      = case when d ? 'byteSize'    then excluded.byte_size    else media.byte_size end,
      updated_at     = case when d ? 'updatedAt'   then excluded.updated_at   else media.updated_at end,
      deleted_at     = case when d ? 'deletedAt'   then excluded.deleted_at   else media.deleted_at end;

  else
    raise exception 'Unknown entity %', p_entity using errcode = '22023';
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- The bucket, and who may touch what is in it
-- ════════════════════════════════════════════════════════════════════
--
-- `public = false`. A family's photographs are not on the open web, and
-- there is no permanent public URL for any of them: reading one means an
-- authenticated request or a short-lived signed link issued to somebody
-- the policies below already admit.
insert into storage.buckets (id, name, public)
values ('family-media', 'family-media', false)
on conflict (id) do update set public = false;

-- Which family an object belongs to, read from its own path.
--
-- Paths are `trees/{tree_id}/media/{media_id}/original`, so the tree is
-- the second segment. Returns null for anything shaped differently, and a
-- null tree id is a member of nothing — so a malformed or traversing path
-- fails closed rather than matching something.
create or replace function public.media_path_tree(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  parts text[] := string_to_array(object_name, '/');
begin
  if array_length(parts, 1) is distinct from 5 then return null; end if;
  if parts[1] <> 'trees' or parts[3] <> 'media' then return null; end if;
  if parts[5] not in ('original', 'thumbnail') then return null; end if;
  -- A segment that is not a uuid raises rather than matching; caught and
  -- reported as "no tree", which is refused everywhere.
  return parts[2]::uuid;
exception when others then
  return null;
end;
$$;

alter table storage.objects enable row level security;

-- Read: any active member of the family the object belongs to. A viewer
-- included — being able to see the family means being able to see its
-- photographs.
create policy family_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'family-media'
    and public.is_tree_member(public.media_path_tree(name))
  );

-- Write, replace and remove: the roles that may change content, which is
-- the same rule the family records themselves use. A viewer is refused
-- here exactly as they are refused an edit to a birth date.
--
-- The check is on the path's OWN tree, so an editor of one family cannot
-- write into another's folder even though they are an editor somewhere.
create policy family_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-media'
    and public.can_write_tree(public.media_path_tree(name))
  );

create policy family_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'family-media'
    and public.can_write_tree(public.media_path_tree(name))
  )
  with check (
    bucket_id = 'family-media'
    and public.can_write_tree(public.media_path_tree(name))
  );

create policy family_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'family-media'
    and public.can_write_tree(public.media_path_tree(name))
  );

grant execute on function public.media_path_tree(text) to authenticated;
