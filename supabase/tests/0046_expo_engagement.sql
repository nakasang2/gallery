\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（46系）。土台は 0036/0038 の番人に通る形で作る。
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-0000000000a1', 'host46@example.com'),
  ('a2000000-0000-0000-0000-0000000000a2', 'guest46@example.com');
update public.profiles set username='host46',  display_name='Host 46'  where id='a1000000-0000-0000-0000-0000000000a1';
update public.profiles set username='guest46', display_name='Guest 46' where id='a2000000-0000-0000-0000-0000000000a2';

-- 主催者の**通常の**部屋（公開）＝ここが今までどおり動くことの見張り
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap) values
  ('aa000000-0000-0000-0000-000000000046', 'a1000000-0000-0000-0000-0000000000a1', 'own46', 'Own room', true, 5);
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('ac000000-0000-0000-0000-000000000046', 'a1000000-0000-0000-0000-0000000000a1', 'Own work', 1000, 800, 'h46/1'),
  ('ac000000-0000-0000-0000-000000000047', 'a2000000-0000-0000-0000-0000000000a2', 'Guest work', 1000, 800, 'g46/1');
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('aa000000-0000-0000-0000-000000000046', 'ac000000-0000-0000-0000-000000000046', 0);

-- 合同展示（まだ下書き）とその部屋。参加作家の作品を掛ける。
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('ae000000-0000-0000-0000-000000000046', 'a1000000-0000-0000-0000-0000000000a1', 'joint-46', 'Joint 46', 14);
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('aa000000-0000-0000-0000-000000000047', 'a1000000-0000-0000-0000-0000000000a1', 'joint-room46',
   'Joint room', 'ae000000-0000-0000-0000-000000000046', true, 15);
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('aa000000-0000-0000-0000-000000000047', 'ac000000-0000-0000-0000-000000000047', 0);

do $$ begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                  where c.relname='guestbook' and p.polname='guestbook_insert_expo_live')
    then raise exception 'HARNESS: 0046 未適用'; end if;
end $$;

\set ON_ERROR_STOP off
begin;

-- 拒否の確認は**positive なアサーション**にする（DECISIONS 2026-08-13 の決定1）。
-- 理由の全文は 0044_expos の同じ関数のコメント。psql の変数はドル引用符の中では
-- 展開されないので、使う場合は `|| quote_literal(:'x') ||` で外へ出す（0048 参照）。
create or replace function public.__t0046_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

\echo '--- 会期が始まる前（下書き。払っていないのだから何も書けない） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
savepoint e;
\echo -n '01 来場を記録できない : '
select public.__t0046_state($q$insert into public.visits (gallery_id) values ('aa000000-0000-0000-0000-000000000047');$q$) = '42501';
rollback to e; release e;
savepoint e;
\echo -n '02 芳名帳に書けない : '
select public.__t0046_state($q$insert into public.guestbook (gallery_id, name, message) values
  ('aa000000-0000-0000-0000-000000000047', 'x', 'y');$q$) = '42501';
rollback to e; release e;
savepoint e;
\echo -n '03 いいねできない : '
select public.__t0046_state($q$insert into public.likes (gallery_id, artwork_id) values
  ('aa000000-0000-0000-0000-000000000047', 'ac000000-0000-0000-0000-000000000047');$q$) = '42501';
rollback to e; release e;
\echo -n '04 人影の数は 0（下書きを覗けない）: '
select public.public_visit_count('aa000000-0000-0000-0000-000000000047') = 0;
reset role;
rollback to s; release s;

\echo '--- 会期が始まったあと ---'
select public.record_expo_purchase('cs_46', 'a1000000-0000-0000-0000-0000000000a1',
  'ae000000-0000-0000-0000-000000000046', 14, 2500, 'usd');

savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
-- **数えるのは持ち主の席から。** `visits_select_own` は部屋の持ち主にしか読ませないので、
-- 撃った anon の席で数えると「入っていない」と読めてしまう（tests/README の約束4）。
\echo -n '05 来場を記録できる（入った件数を持ち主の席で数える）: '
insert into public.visits (gallery_id) values ('aa000000-0000-0000-0000-000000000047');
reset role;
select count(*)=1 from public.visits where gallery_id='aa000000-0000-0000-0000-000000000047';
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '06 芳名帳に書ける: '
insert into public.guestbook (gallery_id, name, message) values
  ('aa000000-0000-0000-0000-000000000047', '来場者', 'よい展示でした');
select count(*)=1 from public.guestbook where gallery_id='aa000000-0000-0000-0000-000000000047';
\echo -n '07 芳名帳を（未ログインで）読める: '
select coalesce(bool_and(message='よい展示でした'), false) from public.guestbook
  where gallery_id='aa000000-0000-0000-0000-000000000047';
\echo -n '08 参加作家の作品にいいねできる: '
insert into public.likes (gallery_id, artwork_id) values
  ('aa000000-0000-0000-0000-000000000047', 'ac000000-0000-0000-0000-000000000047');
select count(*)=1 from public.likes where gallery_id='aa000000-0000-0000-0000-000000000047';
\echo -n '09 いいねを読める: '
select count(*)=1 from public.likes where artwork_id='ac000000-0000-0000-0000-000000000047';
\echo -n '10 人影の数が数えられる: '
select public.public_visit_count('aa000000-0000-0000-0000-000000000047') = 1;
reset role;

\echo -n '11 いいねの通知は**作品の所有者**に届く（部屋の持ち主ではない）: '
select coalesce(bool_and(user_id='a2000000-0000-0000-0000-0000000000a2'), false)
  from public.notifications
 where kind='like' and artwork_id='ac000000-0000-0000-0000-000000000047';
\echo -n '12 記帳の通知は部屋の持ち主（主催者）に届く: '
select coalesce(bool_and(user_id='a1000000-0000-0000-0000-0000000000a1'), false)
  from public.notifications
 where kind='guestbook' and gallery_id='aa000000-0000-0000-0000-000000000047';
rollback to s; release s;

\echo '--- 主催者が芳名帳を閉じているとき（合同展示でも尊重する） ---'
-- 会期は上の購入で始まったまま（あの `select` は savepoint の外なので生きている）。
savepoint s;
update public.galleries set guestbook_enabled = false
  where id='aa000000-0000-0000-0000-000000000047';
set local role anon;
set local "request.jwt.claim.sub" = '';
savepoint e;
\echo -n '13 閉じていれば書けない : '
select public.__t0046_state($q$insert into public.guestbook (gallery_id, name, message) values
  ('aa000000-0000-0000-0000-000000000047', 'x', 'y');$q$) = '42501';
rollback to e; release e;
reset role;
rollback to s; release s;

\echo '--- 猶予が切れたあと（行が消える前でも閉じる） ---'
savepoint s;
update public.expos set starts_at = now() - interval '30 days'
  where id='ae000000-0000-0000-0000-000000000046';
set local role anon;
set local "request.jwt.claim.sub" = '';
savepoint e;
\echo -n '14 芳名帳に書けない : '
select public.__t0046_state($q$insert into public.guestbook (gallery_id, name, message) values
  ('aa000000-0000-0000-0000-000000000047', 'x', 'y');$q$) = '42501';
rollback to e; release e;
\echo -n '15 人影の数は 0: '
select public.public_visit_count('aa000000-0000-0000-0000-000000000047') = 0;
reset role;
rollback to s; release s;

\echo '--- 通常展示への回帰（`is_public` 側の意味を変えていないこと） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '16 公開部屋に来場を記録できる（同じく持ち主の席で数える）: '
insert into public.visits (gallery_id) values ('aa000000-0000-0000-0000-000000000046');
reset role;
select count(*)=1 from public.visits where gallery_id='aa000000-0000-0000-0000-000000000046';
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '17 公開部屋の芳名帳に書けて読める: '
insert into public.guestbook (gallery_id, name, message) values
  ('aa000000-0000-0000-0000-000000000046', '来場者', 'ふつうの展示');
select count(*)=1 from public.guestbook where gallery_id='aa000000-0000-0000-0000-000000000046';
\echo -n '18 公開部屋にいいねできる: '
insert into public.likes (gallery_id, artwork_id) values
  ('aa000000-0000-0000-0000-000000000046', 'ac000000-0000-0000-0000-000000000046');
select count(*)=1 from public.likes where gallery_id='aa000000-0000-0000-0000-000000000046';
\echo -n '19 公開部屋の人影の数が数えられる: '
select public.public_visit_count('aa000000-0000-0000-0000-000000000046') = 1;
reset role;
rollback to s; release s;

\echo '--- 非公開の下書き（通常展示）は今までどおり閉じている ---'
savepoint s;
update public.galleries set is_public = false where id='aa000000-0000-0000-0000-000000000046';
set local role anon;
set local "request.jwt.claim.sub" = '';
savepoint e;
\echo -n '20 非公開の部屋には書けない : '
select public.__t0046_state($q$insert into public.guestbook (gallery_id, name, message) values
  ('aa000000-0000-0000-0000-000000000046', 'x', 'y');$q$) = '42501';
rollback to e; release e;
\echo -n '21 非公開の部屋の人影の数は 0: '
select public.public_visit_count('aa000000-0000-0000-0000-000000000046') = 0;
reset role;
rollback to s; release s;

rollback;
