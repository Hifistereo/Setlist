-- SQL tests for RLS, band RPCs, apply_mutation and pull_changes.
-- Run with: npm run test:sql

\set A '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set B '\'bbbbbbbb-0000-0000-0000-000000000002\''
\set C '\'cccccccc-0000-0000-0000-000000000003\''
\set E '\'eeeeeeee-0000-0000-0000-000000000005\''

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;
create or replace function pg_temp.raises(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;

-- ── Band creation & invites ──
select pg_temp.as_user(:A);
insert into ctx select 'band', r->>'band_id' from (select public.create_band('Henrix Band', 'Anna', 'vocals') r) x;
insert into ctx select 'code', code from public.band_invites;
select pg_temp.assert((select role from public.band_members where user_id = :A) = 'admin', 'creator is admin');
select pg_temp.assert(length((select v from ctx where k = 'code')) >= 60, 'invite code is long and random');

select pg_temp.as_user(:B);
select pg_temp.assert((public.join_band('nope', 'Bob', 'bass')->>'ok')::boolean = false, 'wrong code rejected');
select pg_temp.assert((public.join_band((select v from ctx where k = 'code'), 'Bob', 'bass')->>'ok')::boolean, 'valid code accepted');
select pg_temp.assert((select count(*) from public.band_members) = 2, 'member sees both members');
select pg_temp.assert((select count(*) from public.band_invites) = 0, 'member cannot read invites');

-- rate limit: 10 failures block even a valid code
select pg_temp.as_user(:E);
select public.join_band('wrong-' || g, 'Eve', '') from generate_series(1, 10) g;
select pg_temp.assert((public.join_band((select v from ctx where k = 'code'), 'Eve', '')->>'ok')::boolean = false, 'rate limit enforced');
select pg_temp.assert((select count(*) from public.band_members) = 0, 'rate-limited user not joined');

-- expired invite
reset role;
update public.band_invites set expires_at = now() - interval '1 day';
select pg_temp.as_user(:C);
select pg_temp.assert((public.join_band((select v from ctx where k = 'code'), 'Carl', '')->>'ok')::boolean = false, 'expired code rejected');
reset role;
update public.band_invites set expires_at = now() + interval '1 day';

-- non-member can't create invites
select pg_temp.as_user(:B);
select pg_temp.assert(pg_temp.raises(format('select public.create_invite(%L)', (select v from ctx where k = 'band'))), 'member cannot create invite');

-- ── Mutations ──
select pg_temp.as_user(:A);
insert into ctx values ('song', 'dddddddd-0000-0000-0000-00000000000a');
insert into ctx select 'r1', public.apply_mutation('11111111-0000-0000-0000-000000000001', 'songs',
  (select v from ctx where k = 'band')::uuid, (select v from ctx where k = 'song')::uuid,
  '{"title":"Superstition","artist":"Stevie Wonder","bpm":100,"tags":["funk"]}')::text;
select pg_temp.assert((select v::jsonb->>'status' from ctx where k = 'r1') = 'applied', 'insert applied');
select pg_temp.assert((select title from public.songs) = 'Superstition', 'song stored');
select pg_temp.assert((select created_by from public.songs) = :A, 'created_by set by server');
select pg_temp.assert((select chord_notation from public.songs) = 'standard', 'chord_notation defaults to standard');
select pg_temp.assert(pg_temp.raises(format($q$select public.apply_mutation(gen_random_uuid(), 'songs', %L, %L, '{"chord_notation":"x"}')$q$,
  (select v from ctx where k = 'band'), (select v from ctx where k = 'song'))), 'chord_notation constrained');

-- idempotent retry
select pg_temp.assert(public.apply_mutation('11111111-0000-0000-0000-000000000001', 'songs',
  (select v from ctx where k = 'band')::uuid, (select v from ctx where k = 'song')::uuid,
  '{"title":"DIFFERENT"}')::text = (select v from ctx where k = 'r1'), 'retry returns stored result');
select pg_temp.assert((select title from public.songs) = 'Superstition', 'retry did not re-apply');

-- server-owned fields are not writable
select pg_temp.assert(pg_temp.raises(format($q$select public.apply_mutation(gen_random_uuid(), 'songs', %L, %L, '{"version":99}')$q$,
  (select v from ctx where k = 'band'), (select v from ctx where k = 'song'))), 'version not writable');

-- direct writes denied
select pg_temp.assert(pg_temp.raises(format($q$insert into public.songs(id, band_id) values (gen_random_uuid(), %L)$q$,
  (select v from ctx where k = 'band'))), 'direct insert denied');
select pg_temp.assert(pg_temp.raises($q$update public.songs set title = 'x'$q$), 'direct update denied');

-- concurrent edits: A and B both saw title@v1
select public.apply_mutation(gen_random_uuid(), 'songs', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'song')::uuid, '{"title":"Superstition (A)"}', '{"title":1}');
select pg_temp.as_user(:B);
insert into ctx select 'r2', public.apply_mutation('22222222-0000-0000-0000-000000000002', 'songs',
  (select v from ctx where k = 'band')::uuid, (select v from ctx where k = 'song')::uuid,
  '{"title":"Superstition (B)","key":"Ebm"}', '{"title":1,"key":0}')::text;
select pg_temp.assert((select v::jsonb->>'status' from ctx where k = 'r2') = 'partial', 'partial apply');
select pg_temp.assert((select v::jsonb->'conflicts'->0->>'client_value' from ctx where k = 'r2') = 'Superstition (B)', 'client value preserved');
select pg_temp.assert((select title from public.songs) = 'Superstition (A)', 'server title kept');
select pg_temp.assert((select key from public.songs) = 'Ebm', 'non-conflicting field applied');
reset role;
select pg_temp.assert((select count(*) from public.conflicts where author_id = :B) = 1, 'conflict recorded durably');
select pg_temp.as_user(:B);
select pg_temp.assert((select count(*) from public.conflicts) = 1, 'author can read own conflict');
select pg_temp.as_user(:A);
select pg_temp.assert((select count(*) from public.conflicts) = 0, 'others cannot read conflict');

-- ── Non-member ──
select pg_temp.as_user(:C);
select pg_temp.assert((select count(*) from public.songs) = 0, 'non-member sees no songs');
select pg_temp.assert(pg_temp.raises(format($q$select public.apply_mutation(gen_random_uuid(), 'songs', %L, gen_random_uuid(), '{"title":"x"}')$q$,
  (select v from ctx where k = 'band'))), 'non-member cannot mutate');
select pg_temp.assert(pg_temp.raises(format('select * from public.pull_changes(%L, 0)', (select v from ctx where k = 'band'))), 'non-member cannot pull');

-- ── Setlists, ordering ──
select pg_temp.as_user(:A);
insert into ctx values ('setlist', 'eeeeeeee-0000-0000-0000-00000000000b');
select public.apply_mutation(gen_random_uuid(), 'setlists', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'setlist')::uuid, '{"name":"Club gig","gig_date":"2026-11-01"}');
insert into ctx values ('item', 'ffffffff-0000-0000-0000-00000000000c');
select public.apply_mutation(gen_random_uuid(), 'setlist_items', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'item')::uuid,
  jsonb_build_object('setlist_id', (select v from ctx where k = 'setlist'), 'position', 'a0', 'type', 'song',
                     'song_id', (select v from ctx where k = 'song')));
-- concurrent moves: last writer wins (position is LWW)
select public.apply_mutation(gen_random_uuid(), 'setlist_items', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'item')::uuid, '{"position":"a5"}', '{"position":1}');
select pg_temp.as_user(:B);
select pg_temp.assert(public.apply_mutation(gen_random_uuid(), 'setlist_items', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'item')::uuid, '{"position":"a3"}', '{"position":1}')->>'status' = 'applied', 'position LWW');
select pg_temp.assert((select position from public.setlist_items) = 'a3', 'latest move wins');

-- items can't point at another band's setlist
select pg_temp.as_user(:C);
insert into ctx select 'band2', public.create_band('Other', 'Carl')->>'band_id';
select pg_temp.assert(pg_temp.raises(format($q$select public.apply_mutation(gen_random_uuid(), 'setlist_items', %L, gen_random_uuid(),
  jsonb_build_object('setlist_id', %L, 'position', 'a0'))$q$, (select v from ctx where k = 'band2'), (select v from ctx where k = 'setlist'))),
  'cross-band setlist item rejected');

-- ── Private notes ──
select pg_temp.as_user(:A);
insert into ctx values ('note', '99999999-0000-0000-0000-00000000000d');
select public.apply_mutation(gen_random_uuid(), 'song_notes', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'note')::uuid, jsonb_build_object('song_id', (select v from ctx where k = 'song'), 'note', 'capo 1, watch the stop'));
select pg_temp.assert((select count(*) from public.song_notes) = 1, 'owner reads own note');
select pg_temp.as_user(:B);
select pg_temp.assert((select count(*) from public.song_notes) = 0, 'other member cannot read note');
select pg_temp.assert(pg_temp.raises(format($q$select public.apply_mutation(gen_random_uuid(), 'song_notes', %L, %L, '{"note":"hacked"}')$q$,
  (select v from ctx where k = 'band'), (select v from ctx where k = 'note'))), 'other member cannot edit note');
select pg_temp.assert(not exists (select 1 from public.pull_changes((select v from ctx where k = 'band')::uuid, 0) where table_name = 'song_notes'),
  'note not in other member feed');
select pg_temp.assert(not exists (select 1 from public.change_log where table_name = 'song_notes'), 'note change hidden from others');

-- ── Pull feed ──
select pg_temp.as_user(:A);
select pg_temp.assert((select count(*) from public.pull_changes((select v from ctx where k = 'band')::uuid, 0)) = 4, 'feed: song, setlist, item, note');
select pg_temp.assert((select array_agg(table_name order by seq) from public.pull_changes((select v from ctx where k = 'band')::uuid, 0))
  = array['songs', 'setlists', 'setlist_items', 'song_notes'], 'feed ordered by latest seq');
insert into ctx select 'cursor', max(seq)::text from public.pull_changes((select v from ctx where k = 'band')::uuid, 0);
select pg_temp.assert(not exists (select 1 from public.pull_changes((select v from ctx where k = 'band')::uuid, (select v from ctx where k = 'cursor')::bigint)),
  'nothing after cursor');
-- tombstone
select public.apply_mutation(gen_random_uuid(), 'songs', (select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'song')::uuid, '{"deleted_at":"x"}');
select pg_temp.assert((select data->>'deleted_at' from public.pull_changes((select v from ctx where k = 'band')::uuid,
  (select v from ctx where k = 'cursor')::bigint)) is not null, 'tombstone in feed');
select pg_temp.assert((select count(*) from public.pull_changes((select v from ctx where k = 'band')::uuid, 0, 2)) = 2, 'page limit');

-- ── Storage ──
select pg_temp.as_user(:B);
select pg_temp.assert(not pg_temp.raises(format($q$insert into storage.objects(bucket_id, name) values ('song-files', %L)$q$,
  (select v from ctx where k = 'band') || '/f1/solo.gp')), 'member uploads to band folder');
select pg_temp.assert((select count(*) from storage.objects) = 1, 'member reads band file');
select pg_temp.assert(pg_temp.raises($q$insert into storage.objects(bucket_id, name) values ('song-files', 'not-a-uuid/x.gp')$q$), 'bad path rejected');
select pg_temp.as_user(:C);
select pg_temp.assert(pg_temp.raises(format($q$insert into storage.objects(bucket_id, name) values ('song-files', %L)$q$,
  (select v from ctx where k = 'band') || '/f2/x.gp')), 'non-member upload rejected');
select pg_temp.assert((select count(*) from storage.objects) = 0, 'non-member cannot read file');
delete from storage.objects;
reset role;
select pg_temp.assert((select count(*) from storage.objects) = 1, 'non-member cannot delete file');

-- ── Membership management ──
select pg_temp.as_user(:B);
select pg_temp.assert(pg_temp.raises(format('select public.remove_member(%L, %L)', (select v from ctx where k = 'band'), :A)), 'member cannot remove admin');
select pg_temp.as_user(:A);
select pg_temp.assert(pg_temp.raises(format('select public.remove_member(%L, %L)', (select v from ctx where k = 'band'), :A)), 'last admin cannot leave');

reset role;
\echo 'all assertions passed'
