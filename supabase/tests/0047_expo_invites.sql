\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（47系）。土台は 0036/0038 の番人に通る形で作る。
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-0000000000b1', 'host47@example.com'),
  ('b2000000-0000-0000-0000-0000000000b2', 'guest47@example.com'),
  ('b3000000-0000-0000-0000-0000000000b3', 'other47@example.com');
update public.profiles set username='host47',  display_name='Host 47'  where id='b1000000-0000-0000-0000-0000000000b1';
update public.profiles set username='guest47', display_name='Guest 47' where id='b2000000-0000-0000-0000-0000000000b2';
update public.profiles set username='other47', display_name='Other 47' where id='b3000000-0000-0000-0000-0000000000b3';

-- 主催者の**通常の**部屋（無料枠。work_cap<=5）＝ここに他人の作品が入らないことの見張り
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap) values
  ('ba000000-0000-0000-0000-000000000047', 'b1000000-0000-0000-0000-0000000000b1', 'own47', 'Own room', true, 5);

insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('bc000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-0000000000b1', 'Host work',  1000, 800, 'h47/1'),
  ('bc000000-0000-0000-0000-000000000042', 'b2000000-0000-0000-0000-0000000000b2', 'Guest work', 1000, 800, 'g47/1'),
  ('bc000000-0000-0000-0000-000000000043', 'b2000000-0000-0000-0000-0000000000b2', 'Guest keeps', 1000, 800, 'g47/2'),
  ('bc000000-0000-0000-0000-000000000044', 'b3000000-0000-0000-0000-0000000000b3', 'Other work', 1000, 800, 'o47/1');

-- 合同展示（下書き）と、その部屋2室（**部屋が複数あっても招待は1回**が要点）
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('be000000-0000-0000-0000-000000000047', 'b1000000-0000-0000-0000-0000000000b1', 'joint-47', 'Joint 47', 14);
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('ba000000-0000-0000-0000-000000000048', 'b1000000-0000-0000-0000-0000000000b1', 'jr47-a', 'Room A',
   'be000000-0000-0000-0000-000000000047', true, 15),
  ('ba000000-0000-0000-0000-000000000049', 'b1000000-0000-0000-0000-0000000000b1', 'jr47-b', 'Room B',
   'be000000-0000-0000-0000-000000000047', true, 15);

do $$ begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='expo_invites')
    then raise exception 'HARNESS: 0047 未適用'; end if;
end $$;

\set ON_ERROR_STOP off
begin;

\echo '--- 部屋への招待が撤去されていること ---'
\echo -n '01 room_invites が無い: '
select count(*)=0 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='room_invites';
\echo -n '02 room_submissions が無い: '
select count(*)=0 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='room_submissions';
\echo -n '03 部屋を招待で読ませていたポリシーが無い: '
select count(*)=0 from pg_policy p join pg_class c on c.oid=p.polrelid
  where c.relname='galleries' and p.polname='galleries_select_invited';
\echo -n '04 部屋への提出で作品を読ませていたポリシーが無い: '
select count(*)=0 from pg_policy p join pg_class c on c.oid=p.polrelid
  where c.relname='artworks' and p.polname='artworks_select_submitted_to_my_room';
\echo -n '05 使えなくなった関数が残っていない: '
select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('invited_to_room','may_submit_artwork','artwork_submitted_to_my_room',
                      'invite_artist_by_handle','drop_placement_on_unsubmit','drop_placements_on_revoke',
                      'notify_invite','notify_invite_reply','notify_submission');

\echo '--- 招く（@ハンドル） ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
\echo -n '06 主催者がハンドルで招ける（@付きでも受ける）: '
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', '@Guest47') is not null;
\echo -n '07 招待は pending で入る: '
select coalesce(bool_and(status='pending'), false) from public.expo_invites
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
savepoint e;
\echo -n '08 自分は招けない → '
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'host47');
rollback to e; release e;
savepoint e;
\echo -n '09 居ないハンドルは招けない → '
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'nobody47');
rollback to e; release e;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-0000000000b3';
savepoint e;
\echo -n '10 他人の展示には招待を出せない → '
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'guest47');
rollback to e; release e;
reset role;
rollback to s; release s;

\echo '--- 招かれた作家の側 ---'
-- 以降のケースが使う土台。**savepoint の外**に置く（巻き戻すと後の項目が数えられない）。
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'guest47');
reset role;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
\echo -n '11 自分宛の招待が見える: '
select count(*)=1 from public.expo_invites where artist_id='b2000000-0000-0000-0000-0000000000b2';
\echo -n '12 **下書きの展示の題名が読める**（何に招かれたのか出せる）: '
select coalesce(bool_and(title='Joint 47'), false) from public.expos
  where id='be000000-0000-0000-0000-000000000047';
savepoint e;
\echo -n '13 受諾する前は出せない → '
insert into public.expo_submissions (expo_id, artwork_id) values
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000042');
rollback to e; release e;
\echo -n '14 受諾できる: '
update public.expo_invites set status='accepted', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
select coalesce(bool_and(status='accepted'), false) from public.expo_invites
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
\echo -n '15 受諾後は自分の作品を出せる: '
insert into public.expo_submissions (expo_id, artwork_id) values
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000042');
select count(*)=1 from public.expo_submissions
  where expo_id='be000000-0000-0000-0000-000000000047';
savepoint e;
\echo -n '16 他人の作品は出せない → '
insert into public.expo_submissions (expo_id, artwork_id) values
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000044');
rollback to e; release e;
reset role;

\echo '--- 主催者に見える範囲（出したものだけ） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
\echo -n '17 提出された作品は読める: '
select count(*)=1 from public.artworks where id='bc000000-0000-0000-0000-000000000042';
\echo -n '18 **出していない作品は読めない**（ライブラリは覗けない）: '
select count(*)=0 from public.artworks where id='bc000000-0000-0000-0000-000000000043';
\echo -n '19 招いていない作家の作品も読めない: '
select count(*)=0 from public.artworks where id='bc000000-0000-0000-0000-000000000044';

\echo '--- 掛ける ---'
\echo -n '20 提出された作品を A 室に掛けられる: '
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ba000000-0000-0000-0000-000000000048', 'bc000000-0000-0000-0000-000000000042', 0);
select count(*)=1 from public.placements
  where gallery_id='ba000000-0000-0000-0000-000000000048';
\echo -n '21 **同じ招待で B 室にも掛けられる**（部屋ごとに招き直さない）: '
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ba000000-0000-0000-0000-000000000049', 'bc000000-0000-0000-0000-000000000042', 0);
select count(*)=1 from public.placements
  where gallery_id='ba000000-0000-0000-0000-000000000049';
savepoint e;
\echo -n '22 出していない作品は掛けられない → '
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ba000000-0000-0000-0000-000000000048', 'bc000000-0000-0000-0000-000000000043', 1);
rollback to e; release e;
savepoint e;
\echo -n '23 **通常の部屋には掛けられない**（0037 で塞いだ穴は塞がったまま） → '
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ba000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000042', 1);
rollback to e; release e;
\echo -n '24 主催者自身の作品は今までどおり掛けられる: '
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ba000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000041', 0);
select count(*)=1 from public.placements
  where gallery_id='ba000000-0000-0000-0000-000000000047';
reset role;
rollback to s; release s;

\echo '--- 通知 ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'other47');
reset role;
\echo -n '25 招待の通知は**招かれた作家**に届き、展示の題名が入る: '
select coalesce(bool_and(title='Joint 47' and actor_name='Host 47'), false)
  from public.notifications
 where kind='invite' and user_id='b3000000-0000-0000-0000-0000000000b3';
\echo -n '26 通知は部屋に紐づかない（合同展示に対応する部屋は1つに決まらない）: '
select coalesce(bool_and(gallery_id is null), false) from public.notifications
 where kind='invite' and user_id='b3000000-0000-0000-0000-0000000000b3';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-0000000000b3';
update public.expo_invites set status='declined', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b3000000-0000-0000-0000-0000000000b3';
reset role;
\echo -n '27 返事の通知は**主催者**に届き、本文に状態が入る: '
select coalesce(bool_and(body='declined' and actor_name='Other 47'), false)
  from public.notifications
 where kind='invite_reply' and user_id='b1000000-0000-0000-0000-0000000000b1';
rollback to s; release s;

\echo '--- 提出の通知は作家ごとにまとまる ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
update public.expo_invites set status='accepted', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
insert into public.expo_submissions (expo_id, artwork_id) values
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000042'),
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000043');
reset role;
\echo -n '28 2点出しても通知は1行にまとまる（件数が2）: '
select coalesce(bool_and(count=2), false) from public.notifications
 where kind='submission' and user_id='b1000000-0000-0000-0000-0000000000b1'
   and actor_name='Guest 47';
rollback to s; release s;

\echo '--- 取り下げたら壁から下りる ---'
-- 土台: 受諾 → 2点出す → 2室に掛ける（**savepoint の外**）。
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
update public.expo_invites set status='accepted', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
insert into public.expo_submissions (expo_id, artwork_id) values
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000042'),
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000043');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ba000000-0000-0000-0000-000000000048', 'bc000000-0000-0000-0000-000000000042', 0),
  ('ba000000-0000-0000-0000-000000000049', 'bc000000-0000-0000-0000-000000000042', 0),
  ('ba000000-0000-0000-0000-000000000048', 'bc000000-0000-0000-0000-000000000043', 1),
  ('ba000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000041', 0);
reset role;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
delete from public.expo_submissions
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artwork_id='bc000000-0000-0000-0000-000000000042';
reset role;
\echo -n '29 1点引っ込めたら**その展示の全部屋**から下りる: '
select count(*)=0 from public.placements
  where artwork_id='bc000000-0000-0000-0000-000000000042';
\echo -n '30 引っ込めていない作品は掛かったまま: '
select count(*)=1 from public.placements
  where artwork_id='bc000000-0000-0000-0000-000000000043';
rollback to s; release s;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
update public.expo_invites set status='declined', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
reset role;
\echo -n '31 辞退したら**その作家の作品が全部屋から下りる**: '
select count(*)=0 from public.placements
  where artwork_id in ('bc000000-0000-0000-0000-000000000042','bc000000-0000-0000-0000-000000000043');
\echo -n '32 提出も引き上がる（辞退したのに主催者から見えたままにしない）: '
select count(*)=0 from public.expo_submissions
  where expo_id='be000000-0000-0000-0000-000000000047';
\echo -n '33 主催者自身の作品は触られない: '
select count(*)=1 from public.placements
  where gallery_id='ba000000-0000-0000-0000-000000000047';
\echo -n '34 辞退後は出し直せない: '
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
savepoint e;
insert into public.expo_submissions (expo_id, artwork_id) values
  ('be000000-0000-0000-0000-000000000047', 'bc000000-0000-0000-0000-000000000042');
rollback to e; release e;
reset role;
\echo -n '35 辞退された相手は招き直せる（pending に戻る）: '
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'guest47') is not null;
reset role;
select coalesce(bool_and(status='pending'), false) from public.expo_invites
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
rollback to s; release s;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-0000000000b2';
update public.expo_invites set status='accepted', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
\echo -n '36 **受諾済みを招き直しても巻き戻らない**（展示が壊れない）: '
select public.invite_artist_to_expo('be000000-0000-0000-0000-000000000047', 'guest47') is not null;
reset role;
select coalesce(bool_and(status='accepted'), false) from public.expo_invites
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
\echo -n '37 掛かっている作品も残っている: '
select count(*)=3 from public.placements
  where artwork_id in ('bc000000-0000-0000-0000-000000000042','bc000000-0000-0000-0000-000000000043');
rollback to s; release s;

\echo '--- 主催者は status を動かせない（受諾は作家の意思表示） ---'
-- ここに来た時点の status は 'accepted'（上の土台で作家が受諾したまま。savepoint の外）。
-- **「変わらないこと」を見るので、いまの値を先に確かめてから撃つ** ── 期待する値を
-- 決め打ちすると、土台が変わった日に「動かせなかった」と「もともとその値だった」を
-- 区別できなくなる。
savepoint s;
\echo -n '38 いまは受諾済み（この項目の前提）: '
select coalesce(bool_and(status='accepted'), false) from public.expo_invites
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-0000000000b1';
update public.expo_invites set status='declined', responded_at=now()
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
reset role;
\echo -n '39 主催者が辞退に書き換えても動かない（update は0行）: '
select coalesce(bool_and(status='accepted'), false) from public.expo_invites
  where expo_id='be000000-0000-0000-0000-000000000047'
    and artist_id='b2000000-0000-0000-0000-0000000000b2';
rollback to s; release s;

\echo '--- 未ログインの回帰（ポリシーが呼ぶ関数の grant 漏れ＝0041 の事故） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '40 公開ギャラリーが読める: '
select count(*)=1 from public.galleries where id='ba000000-0000-0000-0000-000000000047';
-- 上の「取り下げ」の土台で、主催者の作品が公開部屋に掛かっている（savepoint の外）。
\echo -n '41 公開ギャラリーに掛かっている作品が読める: '
select count(*)=1 from public.artworks where id='bc000000-0000-0000-0000-000000000041';
\echo -n '42 招かれていない人に下書きの展示は見えない: '
select count(*)=0 from public.expos where id='be000000-0000-0000-0000-000000000047';
\echo -n '43 提出の行も見えない: '
select count(*)=0 from public.expo_submissions;
\echo -n '44 招待の行も見えない: '
select count(*)=0 from public.expo_invites;
reset role;
rollback to s; release s;

rollback;
