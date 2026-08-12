\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0057 の帯）。
insert into auth.users (id, email) values
  ('77000000-0000-0000-0000-000000000001', 'host57@example.com'),
  ('77000000-0000-0000-0000-000000000002', 'artist57@example.com');
update public.profiles set username='host57',   display_name='Host 57'   where id='77000000-0000-0000-0000-000000000001';
update public.profiles set username='artist57', display_name='Artist 57' where id='77000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

\echo '--- 用意: 展示2つ（会期中・下書き）＋作家の作品2点＋主催者の作品1点 ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000001';
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-000000000001', 'live57',  'Live 57',  14),
  ('77000000-0000-0000-0000-000000000012', '77000000-0000-0000-0000-000000000001', 'draft57', 'Draft 57', 14);
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('77000000-0000-0000-0000-0000000000c1', '77000000-0000-0000-0000-000000000001', 'Host own', 1, 1, 'p/host');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('77000000-0000-0000-0000-0000000000a1', '77000000-0000-0000-0000-000000000002', 'Work A', 1, 1, 'p/a'),
  ('77000000-0000-0000-0000-0000000000a2', '77000000-0000-0000-0000-000000000002', 'Work B', 1, 1, 'p/b');
reset role;

-- live57 だけ決済を通す（starts_at はクライアントから触れないので RPC 経由）
select public.record_expo_purchase(
  'sess57-live', '77000000-0000-0000-0000-000000000001',
  '77000000-0000-0000-0000-000000000011', 14, 2500, 'usd');

-- 招待を受諾させる（提出できる状態にする）
insert into public.expo_invites (expo_id, artist_id, status) values
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-000000000002', 'accepted'),
  ('77000000-0000-0000-0000-000000000012', '77000000-0000-0000-0000-000000000002', 'accepted');

\echo '--- 提出（既存の通知が出る）→ 通知を消してから取り下げを見る ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
insert into public.expo_submissions (expo_id, artwork_id) values
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-0000000000a1'),
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-0000000000a2'),
  ('77000000-0000-0000-0000-000000000012', '77000000-0000-0000-0000-0000000000a1');
reset role;
delete from public.notifications;

\echo '--- 会期中の展示から取り下げる → 主催者に通知が出る ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
delete from public.expo_submissions
  where expo_id='77000000-0000-0000-0000-000000000011' and artwork_id='77000000-0000-0000-0000-0000000000a1';
reset role;
\echo -n '01 主催者に unsubmit の通知が1件出る: '
select coalesce(bool_and(kind='unsubmit' and user_id='77000000-0000-0000-0000-000000000001'), false)
  from public.notifications;
\echo -n '02 展示名と作家名が入っている: '
select coalesce(bool_and(title='Live 57' and actor_name='Artist 57'), false) from public.notifications;
\echo -n '03 件数は1: '
select count(*)=1 from public.notifications;

\echo '--- 同じ作家が同じ日にもう1点引っ込める → 1件に畳まれて件数が増える ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
delete from public.expo_submissions
  where expo_id='77000000-0000-0000-0000-000000000011' and artwork_id='77000000-0000-0000-0000-0000000000a2';
reset role;
\echo -n '04 行は増えず1件のまま: '
select count(*)=1 from public.notifications;
\echo -n '05 count が 2 に増える: '
select coalesce(bool_and(count=2), false) from public.notifications;

\echo '--- 下書きの展示からの取り下げは通知しない（選び直しの雑音を出さない） ---'
delete from public.notifications;
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
delete from public.expo_submissions
  where expo_id='77000000-0000-0000-0000-000000000012' and artwork_id='77000000-0000-0000-0000-0000000000a1';
reset role;
\echo -n '06 下書きでは通知が出ない（0件）: '
select count(*)=0 from public.notifications;

\echo '--- 主催者が自分の作品を引っ込めたときは通知しない ---'
insert into public.expo_submissions (expo_id, artwork_id) values
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-0000000000c1');
delete from public.notifications;
delete from public.expo_submissions
  where expo_id='77000000-0000-0000-0000-000000000011' and artwork_id='77000000-0000-0000-0000-0000000000c1';
\echo -n '07 自分の作品なら通知が出ない（0件）: '
select count(*)=0 from public.notifications;

\echo '--- 作品ごと削除されたときは通知する（会期中の展示から消えたので） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
insert into public.expo_submissions (expo_id, artwork_id) values
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-0000000000a1');
reset role;
delete from public.notifications;
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
delete from public.artworks where id='77000000-0000-0000-0000-0000000000a1';
reset role;
\echo -n '08 作品削除の cascade でも通知が出る: '
select coalesce(bool_and(kind='unsubmit'), false) from public.notifications;
\echo -n '09 作家名は引けないので空になる（作品ごと消えているため）: '
select coalesce(bool_and(coalesce(actor_name,'')=''), false) from public.notifications;

\echo '--- 展示ごと削除したときは1件も飛ばさない（cascade の大量通知を防ぐ） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '77000000-0000-0000-0000-000000000002';
insert into public.expo_submissions (expo_id, artwork_id) values
  ('77000000-0000-0000-0000-000000000011', '77000000-0000-0000-0000-0000000000a2');
reset role;
delete from public.notifications;
delete from public.expos where id='77000000-0000-0000-0000-000000000011';
\echo -n '10 展示削除では通知が出ない（0件）: '
select count(*)=0 from public.notifications;

\echo '--- 種別の許可リスト ---'
\echo -n '11 知らない種別は拒否される: '
savepoint s11;
insert into public.notifications (user_id, kind, title)
  values ('77000000-0000-0000-0000-000000000001', 'bogus_kind', 'x');
rollback to s11;
\echo -n '12 既存の種別は引き続き通る（submission）: '
insert into public.notifications (user_id, kind, title)
  values ('77000000-0000-0000-0000-000000000001', 'submission', 'x');
select coalesce(bool_and(kind='submission'), false) from public.notifications where title='x';

rollback;
