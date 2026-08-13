\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0062 の帯）。
insert into auth.users (id, email) values
  ('62000000-0000-0000-0000-000000000001', 'host62@example.com'),
  ('62000000-0000-0000-0000-000000000002', 'artist62@example.com'),
  ('62000000-0000-0000-0000-000000000003', 'other62@example.com');
update public.profiles set username='host62',   display_name='Host 62'   where id='62000000-0000-0000-0000-000000000001';
update public.profiles set username='artist62', display_name='Artist 62' where id='62000000-0000-0000-0000-000000000002';
update public.profiles set username='other62',  display_name='Other 62'  where id='62000000-0000-0000-0000-000000000003';

\set ON_ERROR_STOP off
begin;

-- 例外を捕まえて SQLSTATE を返す（`0061_expo_room_scope.sql` の `__t61_state` と同じ作法）。
create or replace function public.__t62_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000001';

\echo '--- 用意: 主催者(host62)が展示を作り、artist62 を招く ---'
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('62e00000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', 'expo62', 'Expo 62', 14);
insert into public.expo_invites (id, expo_id, artist_id, status) values
  ('62f00000-0000-0000-0000-000000000001', '62e00000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000002', 'pending');

\echo -n '01 招待した直後は、まだ artist62 の部屋は無い: '
select count(*)=0 from public.galleries where expo_id='62e00000-0000-0000-0000-000000000001';

/* ================= 1. 承諾した瞬間に部屋が自動で作られる ================= */

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000002';
update public.expo_invites set status='accepted' where id='62f00000-0000-0000-0000-000000000001';

\echo -n '02 承諾直後、artist62 が所有する部屋が1つできている: '
select count(*)=1 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

\echo -n '03 自動生成の部屋は合同展示の設定（slots_included・work_cap=15）で作られる: '
select coalesce(bool_and(slots_included and work_cap=15), false) from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

\echo -n '04 再度 status=accepted で更新しても（招き直し等）2部屋目は作られない（冪等）: '
update public.expo_invites set status='accepted' where id='62f00000-0000-0000-0000-000000000001';
select count(*)=1 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

/* ================= 2. 1展示・1作家1部屋 ================= */

\echo -n '05 artist62 が同じ展示に2部屋目を直接作ろうとすると拒否される（check_violation=23514）: '
select public.__t62_state($sql$
  insert into public.galleries (owner_id, slug, title, expo_id, slots_included, work_cap) values
    ('62000000-0000-0000-0000-000000000002', 'expo62-artist-2', 'Second Room',
     '62e00000-0000-0000-0000-000000000001', true, 15)
$sql$) = '23514';

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000001';
\echo -n '06 主催者(host62)は同じ展示に自分の部屋を1つ作れる（1展示・1作家1部屋なので作家ごとに1つずつ）: '
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('62b00000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', 'expo62-host', 'Host Room',
   '62e00000-0000-0000-0000-000000000001', true, 15);
select count(*)=2 from public.galleries where expo_id='62e00000-0000-0000-0000-000000000001';

\echo -n '07 host62 が同じ展示に2部屋目を作ろうとすると拒否される（23514）: '
select public.__t62_state($sql$
  insert into public.galleries (owner_id, slug, title, expo_id, slots_included, work_cap) values
    ('62000000-0000-0000-0000-000000000001', 'expo62-host-2', 'Host Room 2',
     '62e00000-0000-0000-0000-000000000001', true, 15)
$sql$) = '23514';

/* ================= 3. 主催者は展示内の全部屋を読めるが、書けない ================= */

\echo -n '08 host62 は artist62 の自動生成の部屋を読める（galleries_select_expo_owner）: '
select count(*)=1 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

\echo -n '09 host62 は artist62 の部屋を書き換えられない（RLSは書き込みポリシーを増やしていない）: '
select public.__t62_state($sql$
  update public.galleries set title='Hijacked'
   where expo_id='62e00000-0000-0000-0000-000000000001'
     and owner_id='62000000-0000-0000-0000-000000000002'
$sql$) = 'no-error';
-- update自体はエラーにならない（RLSのUPDATEは対象0行なら黙って成功する）が、
-- 実際には1行も変わっていないことを確認する。
\echo -n '09b 実際には書き換わっていない: '
select coalesce(bool_and(title <> 'Hijacked'), false) from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000003';
\echo -n '10 展示に無関係の other62 には artist62 の部屋が見えない: '
select count(*)=0 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

/* ================= 4. 「準備できた」トグル ================= */

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000002';
select id into temp artist_room62 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

\echo -n '11 他人の部屋には準備完了トグルを操作できない（not your room・P0001）: '
select public.__t62_state($sql$
  select public.set_expo_room_ready(
    (select id from public.galleries where owner_id='62000000-0000-0000-0000-000000000001'
       and expo_id='62e00000-0000-0000-0000-000000000001'),
    true)
$sql$) = 'P0001';

\echo -n '12 通常展示の部屋には使えない（not a joint-exhibition room・check_violation）: '
insert into public.galleries (id, owner_id, slug, title, work_cap) values
  ('62a00000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', 'normal62', 'Normal Room', 5);
select public.__t62_state($sql$
  select public.set_expo_room_ready('62a00000-0000-0000-0000-000000000001', true)
$sql$) = '23514';

\echo -n '13 自分の合同展示の部屋には準備完了トグルをオンにできる: '
select public.__t62_state($sql$
  select public.set_expo_room_ready((select id from artist_room62), true)
$sql$) = 'no-error';

\echo -n '14 expo_ready_at が入っている: '
select expo_ready_at is not null from public.galleries where id=(select id from artist_room62);

reset role;
\echo -n '15 主催者(host62)に room_ready 通知が届いている: '
select count(*)=1 from public.notifications
  where user_id='62000000-0000-0000-0000-000000000001' and kind='room_ready';

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000001';
\echo -n '16 主催者が自分自身の部屋を準備完了にしても、自分には通知しない（自己通知しない）: '
select public.__t62_state($sql$
  select public.set_expo_room_ready('62b00000-0000-0000-0000-000000000001', true)
$sql$) = 'no-error';
reset role;
\echo -n '16b 自己通知はしない（room_ready通知は artist62 からの1件のまま増えない）: '
select count(*)=1 from public.notifications
  where user_id='62000000-0000-0000-0000-000000000001' and kind='room_ready';

/* ================= 5. 辞退したら、自動生成の部屋も一緒に消える（作品は残る） ================= */

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000002';
insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
  ('62c00000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', 'EW62-1', 100, 100, '62/ew1',
   (select id from artist_room62));

\echo -n '17 作品は作家自身の部屋に紐づいて入っている: '
select count(*)=1 from public.artworks
  where id='62c00000-0000-0000-0000-000000000001' and gallery_id=(select id from artist_room62);

update public.expo_invites set status='declined' where id='62f00000-0000-0000-0000-000000000001';

\echo -n '18 辞退したら、artist62 の自動生成の部屋は消える: '
select count(*)=0 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

\echo -n '19 部屋が消えても、アップロード済みの作品そのものは残る（gallery_id が null に解放される）: '
select count(*)=1 from public.artworks where id='62c00000-0000-0000-0000-000000000001';
\echo -n '20 その作品の gallery_id は null になっている（共有プールへ解放。0061と同じ考え方）: '
select gallery_id is null from public.artworks where id='62c00000-0000-0000-0000-000000000001';

\echo '--- 招き直せば、また部屋が作られる ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000001';
update public.expo_invites set status='pending' where id='62f00000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = '62000000-0000-0000-0000-000000000002';
update public.expo_invites set status='accepted' where id='62f00000-0000-0000-0000-000000000001';

\echo -n '21 招き直して受諾すると、また部屋が1つ作られる: '
select count(*)=1 from public.galleries
  where expo_id='62e00000-0000-0000-0000-000000000001'
    and owner_id='62000000-0000-0000-0000-000000000002';

rollback;
