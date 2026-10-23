-- Setlist — Supabase schema
-- Run once in the Supabase SQL editor (or `psql -f`). Idempotent where practical.
--
-- Write model: clients never write tables directly. Every change goes through
-- public.apply_mutation(), which checks membership, serialises writes per band,
-- de-duplicates retried mutations and detects per-field conflicts.
-- Read model: RLS-protected SELECT plus public.pull_changes() over a per-band
-- monotonically ordered change_log.

-- ───────────────────────── Tables ─────────────────────────

create table if not exists public.bands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.band_members (
  band_id uuid not null references public.bands(id) on delete cascade,
  user_id uuid not null,
  display_name text not null default '',
  instrument text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (band_id, user_id)
);
create index if not exists band_members_user_idx on public.band_members(user_id);

create table if not exists public.band_invites (
  code text primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses int not null default 10 check (max_uses > 0),
  uses int not null default 0,
  revoked boolean not null default false
);

create table if not exists public.join_attempts (
  id bigserial primary key,
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists join_attempts_user_idx on public.join_attempts(user_id, at);

-- Columns shared by every synced table:
--   version         bumped by the server on each applied mutation
--   field_versions  { field: version that last changed it } — used for conflict detection
--   deleted_at      soft delete (tombstone), propagated through change_log

create table if not exists public.songs (
  id uuid primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  title text not null default '',
  artist text not null default '',
  key text not null default '',
  bpm int,
  time_sig text not null default '4/4',
  duration_sec int,
  lyrics_chordpro text not null default '',
  arrangement text not null default '',
  tags text[] not null default '{}',
  links jsonb not null default '[]',
  version bigint not null default 1,
  field_versions jsonb not null default '{}',
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists songs_band_idx on public.songs(band_id);
-- 'h': chart written with H = B natural, B = B flat (Latvian/German style). Added after v1, hence ALTER.
alter table public.songs add column if not exists chord_notation text not null default 'standard'
  check (chord_notation in ('standard', 'h'));

create table if not exists public.song_notes (
  id uuid primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  user_id uuid not null,
  note text not null default '',
  version bigint not null default 1,
  field_versions jsonb not null default '{}',
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (song_id, user_id)
);

create table if not exists public.song_files (
  id uuid primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  kind text not null default 'gp' check (kind in ('gp', 'musicxml', 'tex', 'pdf', 'audio', 'other')),
  name text not null default '',
  part text not null default '',
  storage_path text,
  tex text not null default '',
  size_bytes bigint,
  version bigint not null default 1,
  field_versions jsonb not null default '{}',
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.setlists (
  id uuid primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  name text not null default '',
  gig_date date,
  start_time text not null default '',
  venue text not null default '',
  notes text not null default '',
  version bigint not null default 1,
  field_versions jsonb not null default '{}',
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.setlist_items (
  id uuid primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  setlist_id uuid not null references public.setlists(id) on delete cascade,
  position text not null,
  type text not null default 'song' check (type in ('song', 'break', 'section')),
  song_id uuid references public.songs(id) on delete set null,
  label text not null default '',
  duration_sec int,
  key_override text not null default '',
  version bigint not null default 1,
  field_versions jsonb not null default '{}',
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists setlist_items_setlist_idx on public.setlist_items(setlist_id);

create table if not exists public.change_log (
  seq bigserial primary key,
  band_id uuid not null,
  table_name text not null,
  record_id uuid not null,
  owner_id uuid,           -- set for private rows (song_notes): only the owner may see the entry
  at timestamptz not null default now()
);
create index if not exists change_log_band_seq_idx on public.change_log(band_id, seq);

create table if not exists public.processed_mutations (
  id uuid primary key,
  user_id uuid not null,
  band_id uuid not null,
  result jsonb not null,
  at timestamptz not null default now()
);

create table if not exists public.conflicts (
  id bigserial primary key,
  mutation_id uuid not null,
  band_id uuid not null,
  table_name text not null,
  record_id uuid not null,
  field text not null,
  server_value jsonb,
  client_value jsonb,
  author_id uuid not null,
  at timestamptz not null default now()
);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.is_band_member(p_band uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.band_members m where m.band_id = p_band and m.user_id = (select auth.uid()));
$$;

create or replace function public.is_band_admin(p_band uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.band_members m
                 where m.band_id = p_band and m.user_id = (select auth.uid()) and m.role = 'admin');
$$;

-- Band id from a storage object path "<band_id>/<file_id>/<name>"; null if not a uuid.
create or replace function public.storage_path_band(p_name text)
returns uuid language plpgsql immutable set search_path = ''
as $$
declare
  first text := split_part(p_name, '/', 1);
begin
  if first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first::uuid;
  end if;
  return null;
end;
$$;

create or replace function public.new_invite_code()
returns text language sql volatile set search_path = ''
as $$
  -- two v4 uuids → 244 random bits, hex
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- change_log trigger
create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.change_log(band_id, table_name, record_id, owner_id)
  values (new.band_id, tg_table_name, new.id,
          case when tg_table_name = 'song_notes' then (to_jsonb(new)->>'user_id')::uuid else null end);
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['songs', 'song_notes', 'song_files', 'setlists', 'setlist_items'] loop
    execute format('drop trigger if exists %I_log on public.%I', t, t);
    execute format('create trigger %I_log after insert or update on public.%I for each row execute function public.log_change()', t, t);
  end loop;
end $$;

-- ───────────────────────── Band RPCs ─────────────────────────

create or replace function public.create_band(p_name text, p_display_name text, p_instrument text default '')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  b public.bands;
  code text := public.new_invite_code();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  insert into public.bands(name, created_by) values (trim(p_name), uid) returning * into b;
  insert into public.band_members(band_id, user_id, display_name, instrument, role)
  values (b.id, uid, coalesce(p_display_name, ''), coalesce(p_instrument, ''), 'admin');
  insert into public.band_invites(code, band_id, created_by) values (code, b.id, uid);
  return jsonb_build_object('band_id', b.id, 'invite_code', code);
end;
$$;

create or replace function public.join_band(p_code text, p_display_name text, p_instrument text default '')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.band_invites;
  failures int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select count(*) into failures from public.join_attempts
   where user_id = uid and not ok and at > now() - interval '1 hour';
  if failures >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in an hour.');
  end if;

  select * into inv from public.band_invites where code = trim(lower(p_code)) for update;
  if inv.code is null or inv.revoked or inv.expires_at < now() or inv.uses >= inv.max_uses then
    insert into public.join_attempts(user_id, ok) values (uid, false);
    return jsonb_build_object('ok', false, 'error', 'Invite code is invalid or has expired.');
  end if;

  insert into public.join_attempts(user_id, ok) values (uid, true);
  if not exists (select 1 from public.band_members where band_id = inv.band_id and user_id = uid) then
    insert into public.band_members(band_id, user_id, display_name, instrument, role)
    values (inv.band_id, uid, coalesce(p_display_name, ''), coalesce(p_instrument, ''), 'member');
    update public.band_invites set uses = uses + 1 where code = inv.code;
  end if;
  return jsonb_build_object('ok', true, 'band_id', inv.band_id);
end;
$$;

create or replace function public.create_invite(p_band uuid, p_days int default 14, p_max_uses int default 10)
returns text language plpgsql security definer set search_path = ''
as $$
declare code text := public.new_invite_code();
begin
  if not public.is_band_admin(p_band) then raise exception 'admin only' using errcode = '42501'; end if;
  insert into public.band_invites(code, band_id, created_by, expires_at, max_uses)
  values (code, p_band, auth.uid(), now() + make_interval(days => greatest(1, least(p_days, 90))),
          greatest(1, least(p_max_uses, 50)));
  return code;
end;
$$;

create or replace function public.revoke_invite(p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare b uuid;
begin
  select band_id into b from public.band_invites where code = p_code;
  if b is null or not public.is_band_admin(b) then raise exception 'admin only' using errcode = '42501'; end if;
  update public.band_invites set revoked = true where code = p_code;
end;
$$;

create or replace function public.update_my_profile(p_band uuid, p_display_name text, p_instrument text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.band_members set display_name = coalesce(p_display_name, display_name),
                                 instrument = coalesce(p_instrument, instrument)
   where band_id = p_band and user_id = auth.uid();
end;
$$;

create or replace function public.set_member_role(p_band uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_band_admin(p_band) then raise exception 'admin only' using errcode = '42501'; end if;
  if p_role not in ('admin', 'member') then raise exception 'bad role'; end if;
  if p_role = 'member' and p_user = auth.uid()
     and (select count(*) from public.band_members where band_id = p_band and role = 'admin') <= 1 then
    raise exception 'a band needs at least one admin';
  end if;
  update public.band_members set role = p_role where band_id = p_band and user_id = p_user;
end;
$$;

create or replace function public.remove_member(p_band uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not (public.is_band_admin(p_band) or p_user = auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if exists (select 1 from public.band_members where band_id = p_band and user_id = p_user and role = 'admin')
     and (select count(*) from public.band_members where band_id = p_band and role = 'admin') <= 1 then
    raise exception 'a band needs at least one admin';
  end if;
  delete from public.band_members where band_id = p_band and user_id = p_user;
end;
$$;

-- ───────────────────────── Mutations ─────────────────────────

-- Fields a client may set, per table. Everything else (id, band_id, version, …) is server-owned.
create or replace function public.mutable_fields(p_table text)
returns text[] language sql immutable set search_path = ''
as $$
  select case p_table
    when 'songs' then array['title','artist','key','bpm','time_sig','duration_sec','lyrics_chordpro','arrangement','tags','links','chord_notation','deleted_at']
    when 'song_notes' then array['song_id','note','deleted_at']
    when 'song_files' then array['song_id','kind','name','part','storage_path','tex','size_bytes','deleted_at']
    when 'setlists' then array['name','gig_date','start_time','venue','notes','deleted_at']
    when 'setlist_items' then array['setlist_id','position','type','song_id','label','duration_sec','key_override','deleted_at']
    else null end;
$$;

-- Last-writer-wins fields: applied even when concurrently changed (ordering and deletes).
create or replace function public.lww_fields()
returns text[] language sql immutable set search_path = ''
as $$ select array['position', 'deleted_at'] $$;

-- p_fields: { field: new value }        p_base: { field: field version the client last saw }
-- Result: { status, version, applied[], conflicts[], row }
--   status = applied | partial | conflict | noop  (a retried mutation returns its stored result)
create or replace function public.apply_mutation(
  p_mutation_id uuid, p_table text, p_band uuid, p_record uuid, p_fields jsonb, p_base jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  allowed text[] := public.mutable_fields(p_table);
  prior jsonb;
  cur jsonb;
  merged jsonb;
  fv jsonb;
  new_version bigint;
  k text;
  v jsonb;
  server_fv bigint;
  applied text[] := '{}';
  conflicts jsonb := '[]';
  result jsonb;
  cols text;
  status text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if allowed is null then raise exception 'unknown table %', p_table using errcode = '22023'; end if;
  if not public.is_band_member(p_band) then raise exception 'not a band member' using errcode = '42501'; end if;
  if jsonb_typeof(p_fields) <> 'object' then raise exception 'fields must be an object' using errcode = '22023'; end if;

  -- Serialise writes per band: change_log.seq is then committed in order for that band.
  perform pg_advisory_xact_lock(hashtextextended(p_band::text, 0));

  select pm.result into prior from public.processed_mutations pm where pm.id = p_mutation_id;
  if prior is not null then return prior; end if;

  for k in select jsonb_object_keys(p_fields) loop
    if not k = any(allowed) then raise exception 'field % is not writable', k using errcode = '22023'; end if;
  end loop;

  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', p_table) into cur using p_record;

  if cur is null then
    -- insert
    merged := p_fields;
    if merged ? 'deleted_at' and merged->'deleted_at' <> 'null' then merged := merged || jsonb_build_object('deleted_at', now()); end if;
    fv := '{}';
    for k in select jsonb_object_keys(p_fields) loop
      fv := fv || jsonb_build_object(k, 1);
      applied := applied || k;
    end loop;
    merged := merged || jsonb_build_object(
      'id', p_record, 'band_id', p_band, 'version', 1, 'field_versions', fv,
      'created_by', uid, 'updated_by', uid, 'updated_at', now());
    if p_table = 'song_notes' then merged := merged || jsonb_build_object('user_id', uid); end if;
    if p_table = 'setlist_items' and not exists (
         select 1 from public.setlists s where s.id = (merged->>'setlist_id')::uuid and s.band_id = p_band) then
      raise exception 'setlist not in band' using errcode = '42501';
    end if;
    select string_agg(format('%I', key), ',') into cols from jsonb_object_keys(merged) key;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
                   p_table, cols) using merged;
    new_version := 1;
    status := 'applied';
  else
    if (cur->>'band_id')::uuid <> p_band then raise exception 'record not in band' using errcode = '42501'; end if;
    if p_table = 'song_notes' and (cur->>'user_id')::uuid <> uid then
      raise exception 'private note belongs to another member' using errcode = '42501';
    end if;
    new_version := (cur->>'version')::bigint + 1;
    fv := cur->'field_versions';
    merged := cur;
    for k, v in select * from jsonb_each(p_fields) loop
      server_fv := coalesce((fv->>k)::bigint, 0);
      if cur->k = v then
        continue;  -- already equal: nothing to do, not a conflict
      elsif server_fv <= coalesce((p_base->>k)::bigint, 0) or k = any(public.lww_fields()) then
        if k = 'deleted_at' and v <> 'null' then v := to_jsonb(now()); end if;
        merged := merged || jsonb_build_object(k, v);
        fv := fv || jsonb_build_object(k, new_version);
        applied := applied || k;
      else
        conflicts := conflicts || jsonb_build_object('field', k, 'server_value', cur->k, 'client_value', v);
        insert into public.conflicts(mutation_id, band_id, table_name, record_id, field, server_value, client_value, author_id)
        values (p_mutation_id, p_band, p_table, p_record, k, cur->k, v, uid);
      end if;
    end loop;

    if cardinality(applied) = 0 then
      new_version := (cur->>'version')::bigint;
      status := case when jsonb_array_length(conflicts) > 0 then 'conflict' else 'noop' end;
    else
      merged := merged || jsonb_build_object('version', new_version, 'field_versions', fv,
                                             'updated_by', uid, 'updated_at', now());
      select string_agg(format('%1$I = r.%1$I', c), ',') into cols
        from unnest(applied || array['version','field_versions','updated_by','updated_at']) c;
      execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2',
                     p_table, cols) using merged, p_record;
      status := case when jsonb_array_length(conflicts) > 0 then 'partial' else 'applied' end;
    end if;
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1', p_table) into cur using p_record;
  result := jsonb_build_object('status', status, 'version', new_version, 'applied', to_jsonb(applied),
                               'conflicts', conflicts, 'row', cur);
  insert into public.processed_mutations(id, user_id, band_id, result) values (p_mutation_id, uid, p_band, result);
  return result;
end;
$$;

-- Ordered change feed. Returns the latest state of each record changed after p_after,
-- in seq order. The client stores the last seq only after committing a page locally.
create or replace function public.pull_changes(p_band uuid, p_after bigint, p_limit int default 500)
returns table(seq bigint, table_name text, data jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c record;
  r jsonb;
begin
  if not public.is_band_member(p_band) then raise exception 'not a band member' using errcode = '42501'; end if;
  for c in
    select max(l.seq) as s, l.table_name as t, l.record_id as id
      from public.change_log l
     where l.band_id = p_band and l.seq > p_after and (l.owner_id is null or l.owner_id = uid)
     group by l.table_name, l.record_id
     order by max(l.seq)
     limit greatest(1, least(p_limit, 1000))
  loop
    execute format('select to_jsonb(t) from public.%I t where id = $1', c.t) into r using c.id;
    if r is not null then
      seq := c.s; table_name := c.t; data := r;
      return next;
    end if;
  end loop;
end;
$$;

-- ───────────────────────── RLS & grants ─────────────────────────

alter table public.bands enable row level security;
alter table public.band_members enable row level security;
alter table public.band_invites enable row level security;
alter table public.join_attempts enable row level security;
alter table public.songs enable row level security;
alter table public.song_notes enable row level security;
alter table public.song_files enable row level security;
alter table public.setlists enable row level security;
alter table public.setlist_items enable row level security;
alter table public.change_log enable row level security;
alter table public.processed_mutations enable row level security;
alter table public.conflicts enable row level security;

drop policy if exists bands_read on public.bands;
create policy bands_read on public.bands for select to authenticated using (public.is_band_member(id));
drop policy if exists members_read on public.band_members;
create policy members_read on public.band_members for select to authenticated using (public.is_band_member(band_id));
drop policy if exists invites_read on public.band_invites;
create policy invites_read on public.band_invites for select to authenticated using (public.is_band_admin(band_id));
drop policy if exists songs_read on public.songs;
create policy songs_read on public.songs for select to authenticated using (public.is_band_member(band_id));
drop policy if exists notes_read on public.song_notes;
create policy notes_read on public.song_notes for select to authenticated
  using (user_id = (select auth.uid()) and public.is_band_member(band_id));
drop policy if exists files_read on public.song_files;
create policy files_read on public.song_files for select to authenticated using (public.is_band_member(band_id));
drop policy if exists setlists_read on public.setlists;
create policy setlists_read on public.setlists for select to authenticated using (public.is_band_member(band_id));
drop policy if exists items_read on public.setlist_items;
create policy items_read on public.setlist_items for select to authenticated using (public.is_band_member(band_id));
drop policy if exists changes_read on public.change_log;
create policy changes_read on public.change_log for select to authenticated
  using (public.is_band_member(band_id) and (owner_id is null or owner_id = (select auth.uid())));
drop policy if exists conflicts_read on public.conflicts;
create policy conflicts_read on public.conflicts for select to authenticated using (author_id = (select auth.uid()));
-- join_attempts, processed_mutations: no policies → not readable by clients.
-- No INSERT/UPDATE/DELETE policies anywhere: all writes go through the RPCs above.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.bands, public.band_members, public.band_invites, public.songs, public.song_notes,
  public.song_files, public.setlists, public.setlist_items, public.change_log, public.conflicts to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_band_member(uuid), public.is_band_admin(uuid), public.storage_path_band(text),
  public.create_band(text, text, text), public.join_band(text, text, text), public.create_invite(uuid, int, int),
  public.revoke_invite(text), public.update_my_profile(uuid, text, text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.apply_mutation(uuid, text, uuid, uuid, jsonb, jsonb),
  public.pull_changes(uuid, bigint, int) to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
-- Realtime only nudges clients to pull; it is not relied on for delivery.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'change_log') then
    alter publication supabase_realtime add table public.change_log;
  end if;
end $$;

-- ───────────────────────── Storage ─────────────────────────
-- Files live at song-files/<band_id>/<file_id>/<filename>; only band members may touch them.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('song-files', 'song-files', false)
      on conflict (id) do nothing;

    drop policy if exists song_files_select on storage.objects;
    create policy song_files_select on storage.objects for select to authenticated
      using (bucket_id = 'song-files' and public.is_band_member(public.storage_path_band(name)));
    drop policy if exists song_files_insert on storage.objects;
    create policy song_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'song-files' and public.is_band_member(public.storage_path_band(name)));
    drop policy if exists song_files_update on storage.objects;
    create policy song_files_update on storage.objects for update to authenticated
      using (bucket_id = 'song-files' and public.is_band_member(public.storage_path_band(name)))
      with check (bucket_id = 'song-files' and public.is_band_member(public.storage_path_band(name)));
    drop policy if exists song_files_delete on storage.objects;
    create policy song_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'song-files' and public.is_band_member(public.storage_path_band(name)));
  end if;
end $$;
