\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- A = 作家（部屋を持つ）, B = 別の作家, Z = 管理者
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'z@example.com');
update public.profiles set username='artist_a', display_name='Artist A' where id='aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set username='artist_b', display_name='Artist B' where id='bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set username='boss', display_name='Boss' where id='cccccccc-0000-0000-0000-000000000003';
insert into public.admins (user_id, note) values ('cccccccc-0000-0000-0000-000000000003', 'test');

insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','夜の庭',1000,800,'a/1'),
  ('a0000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000001','坂道',1000,800,'a/2'),
  ('b0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000002','B1',1000,800,'b/1');
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap, guestbook_enabled) values
  ('9a000000-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000001','room-a','A の展示',true,5,true);

insert into public.placements (gallery_id, artwork_id, slot_index)
  values ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1',0);

do $$ begin
  -- **全体の件数を当てにしない**（共通の土台と同じDBで動くので、他のテストの行が居る）。
  -- 自分が入れた3人と自分の placement だけを数える。
  if (select count(*) from public.profiles
       where id in ('aaaaaaaa-0000-0000-0000-000000000001',
                    'bbbbbbbb-0000-0000-0000-000000000002',
                    'cccccccc-0000-0000-0000-000000000003')) <> 3
    then raise exception 'HARNESS: このテストの profiles が3件でない'; end if;
  if not exists (select 1 from public.placements
                  where gallery_id = '9a000000-0000-0000-0000-0000000000f1')
    then raise exception 'HARNESS: このテストの placement が無い'; end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='notifications')
    then raise exception 'HARNESS: notifications が無い（0042 未適用）'; end if;
  if exists (select 1 from public.notifications n
              where n.user_id in ('aaaaaaaa-0000-0000-0000-000000000001',
                                  'bbbbbbbb-0000-0000-0000-000000000002',
                                  'cccccccc-0000-0000-0000-000000000003'))
    then raise exception 'HARNESS: このテストの通知が既にある'; end if;
end $$;

\set ON_ERROR_STOP off
begin;

\echo '--- 回帰: 未ログインの来場者が公開サイトを使えるか（0041 の事故） ---'
savepoint s;
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
\echo -n 'A1 公開ギャラリーを読める: '
select count(*)=1 from public.galleries where is_public;
\echo -n 'A2 公開ギャラリーに掛かった作品を読める: '
select count(*)=1 from public.artworks where id='a0000000-0000-0000-0000-0000000000a1';
\echo -n 'A3 いいねを押せる: '
insert into public.likes (gallery_id, artwork_id)
  values ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1');
select count(*)=1 from public.likes;
\echo -n 'A4 芳名帳に記帳できる: '
insert into public.guestbook (gallery_id, name, message)
  values ('9a000000-0000-0000-0000-0000000000f1','ゆき','よかった');
select count(*)=1 from public.guestbook;
\echo -n 'A5 訪問を記録できる（insert が通れば OK。visits の read は所有者だけ）: '
insert into public.visits (gallery_id) values ('9a000000-0000-0000-0000-0000000000f1');
select true;
\echo -n 'A6 それでも他人の非公開の部屋は見えない: '
select count(*)=0 from public.galleries where not is_public;
\echo -n 'A7 通知は1件も読めない: '
select count(*)=0 from public.notifications;
reset role;
rollback to s;
release s;

\echo '--- 偽造できないこと（設計の一番の要点） ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '01 他人宛の通知を作る → '
insert into public.notifications (user_id, kind, title)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'announce', 'Xibit360からのお知らせ（偽）');
rollback to s;

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '02 自分宛でも直接は作れない（insertポリシーが無い） → '
insert into public.notifications (user_id, kind, title)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'announce', '自作自演');
rollback to s;

set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
\echo -n '03 未ログインでも作れない → '
insert into public.notifications (user_id, kind, title)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'like', 'x');
rollback to s;

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '04 push_notification を直接呼べない → '
select public.push_notification('aaaaaaaa-0000-0000-0000-000000000001','announce',null,null,'偽','','x');
rollback to s;

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '05 非管理者は一斉送信できない → '
select public.broadcast_announcement('偽のお知らせ', '');
rollback to s;
release s;

\echo '--- いいね（匿名・作品ごと1日1件にまとめる） ---'
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
insert into public.likes (gallery_id, artwork_id) values
  ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1'),
  ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1'),
  ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1');
reset role;
\echo -n '06 いいね3件が1件の通知にまとまる: '
select count(*)=1 from public.notifications where kind='like';
\echo -n '07 件数が3になっている: '
select count=3 from public.notifications where kind='like';
\echo -n '08 宛先は作品の所有者: '
select user_id='aaaaaaaa-0000-0000-0000-000000000001' from public.notifications where kind='like';
\echo -n '09 作品名が焼き込まれている: '
select title='夜の庭' from public.notifications where kind='like';
\echo -n '10 匿名なので actor_name は null: '
select actor_name is null from public.notifications where kind='like';

set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
insert into public.likes (gallery_id, artwork_id)
  values ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a2');
reset role;
\echo -n '11 別の作品は別の通知になる: '
select count(*)=2 from public.notifications where kind='like';

\echo -n '12 既読にしたあとの新しいいいねは新しい通知になる: '
update public.notifications set read_at=now() where kind='like';
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
insert into public.likes (gallery_id, artwork_id)
  values ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1');
reset role;
select count(*)=1 from public.notifications
  where kind='like' and artwork_id='a0000000-0000-0000-0000-0000000000a1' and read_at is null;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.likes (gallery_id, artwork_id)
  values ('9a000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000a1');
reset role;
\echo -n '13 自分の作品に自分でいいねしても件数が増えない: '
select count=1 from public.notifications
  where kind='like' and artwork_id='a0000000-0000-0000-0000-0000000000a1' and read_at is null;
rollback to s;
release s;

\echo '--- 芳名帳（1件ずつ・署名は載せる） ---'
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
insert into public.guestbook (gallery_id, name, message)
  values ('9a000000-0000-0000-0000-0000000000f1','ゆき','とても良かったです');
insert into public.guestbook (gallery_id, name, message)
  values ('9a000000-0000-0000-0000-0000000000f1','','名前なしの感想');
reset role;
\echo -n '14 芳名帳は1件ずつ通知される: '
select count(*)=2 from public.notifications where kind='guestbook';
\echo -n '15 署名と本文が載っている: '
select actor_name='ゆき' and body='とても良かったです' from public.notifications
  where kind='guestbook' and actor_name is not null;
\echo -n '16 無記名は actor_name が null（空文字にしない）: '
select count(*)=1 from public.notifications where kind='guestbook' and actor_name is null;

\echo '--- 招待（0041 の発端） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.invite_artist_by_handle('9a000000-0000-0000-0000-0000000000f1', 'artist_b');
reset role;
\echo -n '17 招かれた作家に通知が届く: '
select count(*)=1 from public.notifications
  where kind='invite' and user_id='bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '18 部屋名と主催者名が載っている: '
select title='A の展示' and actor_name='Artist A' from public.notifications where kind='invite';

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.room_invites set status='accepted' where artist_id='bbbbbbbb-0000-0000-0000-000000000002';
reset role;
\echo -n '19 受諾が主催者に返る: '
select count(*)=1 from public.notifications
  where kind='invite_reply' and user_id='aaaaaaaa-0000-0000-0000-000000000001' and body='accepted';
\echo -n '20 誰が返事したか載っている: '
select actor_name='Artist B' from public.notifications where kind='invite_reply';

\echo '--- 提出（作家ごとにまとめる） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.room_submissions (gallery_id, artwork_id)
  values ('9a000000-0000-0000-0000-0000000000f1','b0000000-0000-0000-0000-0000000000b1');
reset role;
\echo -n '21 提出が主催者に通知される: '
select count(*)=1 from public.notifications
  where kind='submission' and user_id='aaaaaaaa-0000-0000-0000-000000000001';
\echo -n '22 出した作家の名前が載っている（まとめの鍵でもある）: '
select actor_name='Artist B' from public.notifications where kind='submission';

\echo '--- 一斉送信（管理者） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select public.broadcast_announcement('新しいテーマ「霧」を追加しました', '部屋のテーマから選べます。');
reset role;
\echo -n '23 全員（3人）に1件ずつ配られる: '
select count(*)=3 from public.notifications where kind='announce';
\echo -n '24 管理者自身にも届く: '
select count(*)=1 from public.notifications
  where kind='announce' and user_id='cccccccc-0000-0000-0000-000000000003';

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
\echo -n '25 空のタイトルは拒否 → '
select public.broadcast_announcement('   ', '本文だけ');
rollback to s;
release s;

\echo '--- 読める範囲・既読 ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '26 Bに見えるのは自分宛だけ（招待1＋お知らせ1）: '
select count(*)=2 from public.notifications;
\echo -n '27 Aのいいね通知はBには見えない: '
select count(*)=0 from public.notifications where kind='like';
select public.mark_notifications_read();
\echo -n '28 まとめて既読にできる: '
select count(*)=0 from public.notifications where read_at is null;
rollback to s;

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.mark_notifications_read();
reset role;
\echo -n '29 既読はBの分だけで、Aの未読は残っている: '
select count(*) > 0 from public.notifications
  where user_id='aaaaaaaa-0000-0000-0000-000000000001' and read_at is null;
rollback to s;
release s;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
-- **確認は B の席から出てやる**。B には A の行が見えない（それが正しい）ので、
-- B のまま数えると 0 件になり「消えた」と読めてしまう。1つ前の版でそれを踏んだ。
update public.notifications set read_at=now()
  where user_id='aaaaaaaa-0000-0000-0000-000000000001';
delete from public.notifications where user_id='aaaaaaaa-0000-0000-0000-000000000001';
reset role;
\echo -n '30 他人の通知を既読にできない（Aの未読が残っている）: '
select count(*) > 0 from public.notifications
  where user_id='aaaaaaaa-0000-0000-0000-000000000001' and read_at is null;
\echo -n '31 他人の通知を消せない（Aの行が残っている）: '
select count(*) > 0 from public.notifications
  where user_id='aaaaaaaa-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo -n '32 自分の通知は消せる: '
delete from public.notifications where user_id='bbbbbbbb-0000-0000-0000-000000000002';
select count(*)=0 from public.notifications where user_id='bbbbbbbb-0000-0000-0000-000000000002';
rollback to s;
release s;

\echo '--- source が消えても通知は残るか ---'
savepoint s;
delete from public.artworks where id='a0000000-0000-0000-0000-0000000000a1';
\echo -n '33 作品を消しても通知は残り、作品名も読める: '
select count(*) > 0 from public.notifications where kind='like' and title='夜の庭';
\echo -n '34 artwork_id は null に落ちる（cascade で通知が消えない）: '
select count(*)=0 from public.notifications
  where kind='like' and artwork_id='a0000000-0000-0000-0000-0000000000a1';
rollback to s;

delete from public.galleries where id='9a000000-0000-0000-0000-0000000000f1';
\echo -n '35 部屋を消しても芳名帳の通知は残る: '
select count(*)=2 from public.notifications where kind='guestbook';
rollback to s;
release s;

\echo '--- 通知が本来の操作を壊さないか ---'
savepoint s;
-- プロフィールが消えた作品（宛先が居ない）へのいいね。push_notification は黙って
-- 何もしないので、いいね自体は成功しなければならない。
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
insert into public.likes (gallery_id, artwork_id)
  values ('9a000000-0000-0000-0000-0000000000f1','b0000000-0000-0000-0000-0000000000b1');
reset role;
\echo -n '36 他人の作品へのいいねも普通に入る: '
select count(*)=1 from public.likes where artwork_id='b0000000-0000-0000-0000-0000000000b1';
rollback to s;
release s;

rollback;
