\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0064 の帯）。
insert into auth.users (id, email) values
  ('64000000-0000-0000-0000-000000000001', 'host64@example.com'),
  ('64000000-0000-0000-0000-000000000002', 'artist64@example.com'),
  ('64000000-0000-0000-0000-000000000003', 'other64@example.com');
update public.profiles set username='host64',   display_name='Host 64'   where id='64000000-0000-0000-0000-000000000001';
update public.profiles set username='artist64', display_name='Artist 64' where id='64000000-0000-0000-0000-000000000002';
update public.profiles set username='other64',  display_name='Other 64'  where id='64000000-0000-0000-0000-000000000003';

\set ON_ERROR_STOP off
begin;

create or replace function public.__t64_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

\echo '--- 用意: host64 の展示に artist64 が参加し、自分の部屋に1点掛ける ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000001';
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('64e00000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001', 'expo64', 'Expo 64', 14);
insert into public.expo_invites (id, expo_id, artist_id, status) values
  ('64f00000-0000-0000-0000-000000000002', '64e00000-0000-0000-0000-000000000001',
   '64000000-0000-0000-0000-000000000002', 'pending');

set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000002';
update public.expo_invites set status='accepted' where id='64f00000-0000-0000-0000-000000000002';

-- **一時表ではなく psql 変数に退避する。** 一時表はロールを切り替えると読めなくなり
-- （`anon` には権限が無い）、検査したい行そのものが取れずに項目が空振りする。
select id as rid from public.galleries
 where expo_id='64e00000-0000-0000-0000-000000000001'
   and owner_id='64000000-0000-0000-0000-000000000002' \gset

insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
  ('64a00000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000002', 'W64', 100, 100, '64/w1',
   :'rid');
insert into public.placements (gallery_id, artwork_id, slot_index) values
  (:'rid', '64a00000-0000-0000-0000-000000000001', 0);

\echo -n '01 作家は自分の部屋に1点掛けられた: '
select count(*)=1 from public.placements where gallery_id=:'rid';

/* ========== 1. 準備できたがオフのあいだは、主催者にも見えない ========== */
set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000001';

\echo -n '02 【準備中】主催者に参加作家の作品は見えない（作りかけは見せない）: '
select count(*)=0 from public.artworks where id='64a00000-0000-0000-0000-000000000001';

\echo -n '03 【準備中】主催者に配置も見えない: '
select count(*)=0 from public.placements where gallery_id=:'rid';

\echo -n '04 【準備中】部屋の行そのものは読める（0062 の回帰確認・準備状態を出すため）: '
select count(*)=1 from public.galleries where id=:'rid';

/* ========== 2. 「準備できた」をオンにすると、主催者に中身が見える ========== */
set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000002';
select public.set_expo_room_ready(:'rid', true);

set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000001';

\echo -n '05 【準備完了】主催者に参加作家の作品が見える（付ける前に中身を確かめられる）: '
select count(*)=1 from public.artworks where id='64a00000-0000-0000-0000-000000000001';

\echo -n '06 【準備完了】主催者に配置も見える: '
select count(*)=1 from public.placements where gallery_id=:'rid';

/* ========== 3. 見えるようになっても、書けるようにはなっていない ========== */

\echo -n '07 主催者は参加作家の作品を書き換えられない（0件更新）: '
with u as (
  update public.artworks set title='HIJACKED' where id='64a00000-0000-0000-0000-000000000001' returning 1
) select count(*)=0 from u;

\echo -n '08 主催者は参加作家の作品を消せない（0件削除）: '
with d as (
  delete from public.artworks where id='64a00000-0000-0000-0000-000000000001' returning 1
) select count(*)=0 from d;

\echo -n '09 主催者は参加作家の壁の配置を消せない（0件削除）: '
with d as (
  delete from public.placements where gallery_id=:'rid' returning 1
) select count(*)=0 from d;

\echo -n '10 主催者は参加作家の部屋の行も書き換えられない（0062 の回帰確認）: '
with u as (
  update public.galleries set title='HIJACKED' where id=:'rid' returning 1
) select count(*)=0 from u;

/* ========== 4. 関係の無い人には、準備完了でも見えない ========== */
set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000003';

\echo -n '11 展示に無関係の other64 には、準備完了でも作品が見えない: '
select count(*)=0 from public.artworks where id='64a00000-0000-0000-0000-000000000001';

\echo -n '12 other64 には配置も見えない: '
select count(*)=0 from public.placements where gallery_id=:'rid';

set local role anon;
set local "request.jwt.claim.sub" = '';

\echo -n '13 未ログインの来場者にも見えない（会期はまだ始まっていない）: '
select count(*)=0 from public.artworks where id='64a00000-0000-0000-0000-000000000001';

-- **未ログインでも述語を「呼べる」ことを確かめる。** 呼べないと、この述語を読む
-- ポリシーが評価された瞬間にクエリごと落ち、**公開ページが未ログインから全滅する**
-- （2026-08-14 に実際にそう書いてしまい、項目13がそれを検出した。0041 と同じ形）。
-- 呼べたうえで false を返す＝権限を渡しても見えるものは1行も増えない、が正しい姿。
\echo -n '14 未ログインでも述語は呼べる（呼べないと公開ページが全滅する）: '
select public.__t64_state($$select public.expo_room_ready_for_organizer(
  '00000000-0000-0000-0000-000000000000'::uuid)$$) = 'no-error';

\echo -n '14b 未ログインが呼ぶと false を返す（呼べても何も見えるようにならない）: '
select public.expo_room_ready_for_organizer(:'rid') = false;

/* ========== 5. オフに戻せば、また見えなくなる（決定権は作家が持つ） ========== */
set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000002';
select public.set_expo_room_ready(:'rid', false);

set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000001';

\echo -n '15 作家がオフに戻すと、主催者からまた見えなくなる: '
select count(*)=0 from public.artworks where id='64a00000-0000-0000-0000-000000000001';

\echo -n '16 配置も見えなくなる: '
select count(*)=0 from public.placements where gallery_id=:'rid';

/* ========== 6. 自分の作品・通常展示への回帰が無いこと ========== */
set local role authenticated;
set local "request.jwt.claim.sub" = '64000000-0000-0000-0000-000000000002';

\echo -n '17 作家自身は、準備状態に関わらず自分の作品を読める: '
select count(*)=1 from public.artworks where id='64a00000-0000-0000-0000-000000000001';

\echo -n '18 作家自身は自分の作品を書き換えられる（既存の権利を狭めていない）: '
with u as (
  update public.artworks set title='W64b' where id='64a00000-0000-0000-0000-000000000001' returning 1
) select count(*)=1 from u;

rollback;
