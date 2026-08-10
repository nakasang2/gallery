\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（48系）。
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-0000000000c1', 'host48@example.com'),
  ('c2000000-0000-0000-0000-0000000000c2', 'guest48@example.com'),
  ('c3000000-0000-0000-0000-0000000000c3', 'other48@example.com');
update public.profiles set username='host48',  display_name='Host 48'  where id='c1000000-0000-0000-0000-0000000000c1';
update public.profiles set username='guest48', display_name='Guest 48' where id='c2000000-0000-0000-0000-0000000000c2';
update public.profiles set username='other48', display_name='Other 48' where id='c3000000-0000-0000-0000-0000000000c3';

insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('cc000000-0000-0000-0000-000000000042', 'c2000000-0000-0000-0000-0000000000c2', 'Guest work', 1000, 800, 'g48/1');

insert into public.expos (id, owner_id, slug, title, statement, duration_days) values
  ('ce000000-0000-0000-0000-000000000048', 'c1000000-0000-0000-0000-0000000000c1',
   'joint-48', 'Joint 48', 'ステートメント', 14);
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('ca000000-0000-0000-0000-000000000048', 'c1000000-0000-0000-0000-0000000000c1', 'jr48', 'Room 48',
   'ce000000-0000-0000-0000-000000000048', true, 15);

do $$ begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='expo_invite_links')
    then raise exception 'HARNESS: 0048 未適用'; end if;
end $$;

\set ON_ERROR_STOP off
begin;

\echo '--- リンクを作る ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c3000000-0000-0000-0000-0000000000c3';
savepoint e;
\echo -n '01 他人の展示のリンクは作れない → '
select public.create_expo_invite_link('ce000000-0000-0000-0000-000000000048');
rollback to e; release e;
reset role;
rollback to s; release s;

-- 以降が使う土台。**savepoint の外**（巻き戻すと後の項目がトークンを引けない）。
--
-- **トークンは psql 変数に取る。** 検査の中で `(select token from expo_invite_links …)` と
-- 書くと、その副問い合わせは**呼び手のロールで評価される** ── リンクの表は主催者以外に
-- 見せない設計（下の 05/06）なので anon では null になり、「関数が0行を返した」に見える
-- （実測 2026-08-10。migration のバグと読み違えかけた）。作った戻り値をそのまま掴む。
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
select public.create_expo_invite_link('ce000000-0000-0000-0000-000000000048') as tok1 \gset
select public.create_expo_invite_link('ce000000-0000-0000-0000-000000000048') as tok2 \gset
reset role;

\echo -n '02 リンクが2本できている: '
select count(*)=2 from public.expo_invite_links
  where expo_id='ce000000-0000-0000-0000-000000000048';
\echo -n '03 トークンは64文字の16進（クライアントが選べない値）: '
select coalesce(bool_and(token ~ '^[0-9a-f]{64}$'), false) from public.expo_invite_links
  where expo_id='ce000000-0000-0000-0000-000000000048';
\echo -n '04 2本目は違うトークンになる: '
select :'tok1' <> :'tok2';

\echo '--- トークンは一覧できない（知っていることが唯一の鍵） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '05 未ログインからリンクの表は見えない: '
select count(*)=0 from public.expo_invite_links;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
\echo -n '06 招かれていないログイン済みからも見えない: '
select count(*)=0 from public.expo_invite_links;
reset role;
rollback to s; release s;

\echo '--- リンクを踏む（未ログインでも展示が見える） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '07 未ログインでも題名・主催者・会期が引ける: '
select coalesce(bool_and(title='Joint 48' and organizer_name='Host 48' and starts_at is null), false)
  from public.expo_by_invite_token(
    :'tok1');
\echo -n '08 未ログインの my_status は null: '
select coalesce(bool_and(my_status is null), false)
  from public.expo_by_invite_token(
    :'tok1');
\echo -n '09 存在しないトークンは0行（有効なものを総当たりで探せない）: '
select count(*)=0 from public.expo_by_invite_token('00000000000000000000000000000000');
reset role;
rollback to s; release s;

\echo '--- 参加希望を出す ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
savepoint e;
\echo -n '10 未ログインでは希望を出せない → '
select public.request_expo_invite(
  :'tok1');
rollback to e; release e;
reset role;
rollback to s; release s;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
savepoint e;
\echo -n '11 主催者は自分の展示に希望を出せない → '
select public.request_expo_invite(
  :'tok1');
rollback to e; release e;
reset role;
rollback to s; release s;

-- 土台: 作家が希望を出す（**savepoint の外**）。
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
select public.request_expo_invite(
  :'tok1');
reset role;

-- 招待の id も**制限の無い席で**掴む。他人の席で副問い合わせすると RLS で見えず null に
-- なり、`approve_expo_request(null)` が「そんな招待は無い」で落ちる ── 期待どおりの
-- エラーではあるが、**確かめたかった理由（他人だから断られる）とは別の理由**になる。
select id as inv from public.expo_invites
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2' \gset

\echo -n '12 希望が requested で入る: '
select coalesce(bool_and(status='requested'), false) from public.expo_invites
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
\echo -n '13 主催者に「参加希望」の通知が届く: '
select coalesce(bool_and(title='Joint 48' and actor_name='Guest 48'), false)
  from public.notifications
 where kind='invite_request' and user_id='c1000000-0000-0000-0000-0000000000c1';

\echo '--- 承認前は何の権限も無い ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
savepoint e;
\echo -n '14 承認前は作品を出せない → '
insert into public.expo_submissions (expo_id, artwork_id) values
  ('ce000000-0000-0000-0000-000000000048', 'cc000000-0000-0000-0000-000000000042');
rollback to e; release e;
\echo -n '15 二度押しは requested のまま（増えない）: '
select public.request_expo_invite(
  :'tok1') = 'requested';
reset role;
select count(*)=1 from public.expo_invites
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
rollback to s; release s;

\echo '--- **自分で自分を承認できない**（これが無いと承認の意味が消える） ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
savepoint e;
\echo -n '16 希望を出した本人が accepted にできない → '
update public.expo_invites set status='accepted'
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
rollback to e; release e;
savepoint e;
\echo -n '17 pending に化けさせることもできない → '
update public.expo_invites set status='pending'
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
rollback to e; release e;
\echo -n '18 希望の取り下げ（declined）はできる: '
update public.expo_invites set status='declined', responded_at=now()
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
reset role;
select coalesce(bool_and(status='declined'), false) from public.expo_invites
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
rollback to s; release s;

\echo '--- 承認は主催者だけ ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c3000000-0000-0000-0000-0000000000c3';
savepoint e;
\echo -n '19 他人は承認できない → '
select public.approve_expo_request(:'inv');
rollback to e; release e;
reset role;
rollback to s; release s;

savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
-- `returns void` なので**戻り値では判定しない**（`void is null` は false ── 一度これで
-- 「承認できなかった」と読み違えた）。効いたかどうかは行の状態で見る。
select public.approve_expo_request(:'inv');
reset role;
\echo -n '20 主催者は承認できる（行が accepted になる）: '
select coalesce(bool_and(status='accepted'), false) from public.expo_invites
  where expo_id='ce000000-0000-0000-0000-000000000048'
    and artist_id='c2000000-0000-0000-0000-0000000000c2';
\echo -n '21 承認は**作家に**通知される（主催者が自分の操作の通知を受けない）: '
select coalesce(bool_and(user_id='c2000000-0000-0000-0000-0000000000c2' and actor_name='Host 48'), false)
  from public.notifications where kind='invite_approved';
\echo -n '22 承認で「受諾されました」が主催者に飛ばない: '
select count(*)=0 from public.notifications
  where kind='invite_reply' and user_id='c1000000-0000-0000-0000-0000000000c1';
\echo -n '23 承認後は作品を出せる: '
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
insert into public.expo_submissions (expo_id, artwork_id) values
  ('ce000000-0000-0000-0000-000000000048', 'cc000000-0000-0000-0000-000000000042');
reset role;
select count(*)=1 from public.expo_submissions
  where expo_id='ce000000-0000-0000-0000-000000000048';
\echo -n '24 主催者が掛けられる: '
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('ca000000-0000-0000-0000-000000000048', 'cc000000-0000-0000-0000-000000000042', 0);
reset role;
select count(*)=1 from public.placements
  where gallery_id='ca000000-0000-0000-0000-000000000048';
\echo -n '25 承認済みをもう一度承認しようとしても弾かれる（二度押し） → '
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
savepoint e;
select public.approve_expo_request(:'inv');
rollback to e; release e;
reset role;
\echo -n '26 リンクから踏み直しても accepted のまま: '
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
select public.request_expo_invite(
  :'tok1') = 'accepted';
reset role;
\echo -n '27 my_status に自分の状態が出る: '
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-0000000000c2';
select coalesce(bool_and(my_status='accepted'), false)
  from public.expo_by_invite_token(
    :'tok1');
reset role;
rollback to s; release s;

\echo '--- 主催者が招いてあった相手がリンクを踏んだら、それは受諾 ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
select public.invite_artist_to_expo('ce000000-0000-0000-0000-000000000048', 'other48');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c3000000-0000-0000-0000-0000000000c3';
\echo -n '28 pending の相手が踏むと accepted になる（招いたのに入れない、を作らない）: '
select public.request_expo_invite(
  :'tok1') = 'accepted';
reset role;
\echo -n '29 その受諾は主催者に通知される: '
select coalesce(bool_and(body='accepted' and actor_name='Other 48'), false)
  from public.notifications
 where kind='invite_reply' and user_id='c1000000-0000-0000-0000-0000000000c1';
rollback to s; release s;

\echo '--- 無効化 ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-0000000000c1';
update public.expo_invite_links set revoked_at = now()
  where expo_id='ce000000-0000-0000-0000-000000000048';
reset role;
\echo -n '30 無効化しても行は残る（いつ止めたかを残す）: '
select count(*)=2 from public.expo_invite_links
  where expo_id='ce000000-0000-0000-0000-000000000048';
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '31 無効化したリンクからは展示が引けない: '
select count(*)=0 from public.expo_by_invite_token(
  :'tok1');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c3000000-0000-0000-0000-0000000000c3';
savepoint e;
\echo -n '32 無効化したリンクでは希望を出せない → '
select public.request_expo_invite(
  :'tok1');
rollback to e; release e;
reset role;
rollback to s; release s;

\echo '--- 展示を消したらリンクも消える ---'
savepoint s;
delete from public.expos where id='ce000000-0000-0000-0000-000000000048';
\echo -n '33 リンクは cascade で消える: '
select count(*)=0 from public.expo_invite_links;
rollback to s; release s;

rollback;
