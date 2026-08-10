\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP off
-- **このファイルは自己完結**（他のテストや seed.sql に依存しない）。土台は 0036/0038 の
-- 番人に通る形で作る: 無料は1室まで、2室目以降は購入台帳の行が要り、等級は
-- `slots_included = true` / `work_cap = 15` で作る。
--
-- id は 0042 のテストとぶつからない帯を使う（同じDBを使い回すため）。
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-0000000000d1', 'boss43@example.com'),
  ('d2000000-0000-0000-0000-0000000000d2', 'one43@example.com'),
  ('d3000000-0000-0000-0000-0000000000d3', 'two43@example.com');
update public.profiles set username='boss43',  display_name='Boss 43'  where id='d1000000-0000-0000-0000-0000000000d1';
update public.profiles set username='owner43a', display_name='Owner 43A' where id='d2000000-0000-0000-0000-0000000000d2';
update public.profiles set username='owner43b', display_name='Owner 43B' where id='d3000000-0000-0000-0000-0000000000d3';
insert into public.admins (user_id, note) values ('d1000000-0000-0000-0000-0000000000d1', 'test');

-- Owner 43A: 無料1室＋購入2件＋有料2室（3室）
-- 無料の1室目は **work_cap <= 5**（0038: 既定値10だと弾かれる。ここを通すと
-- 「無料の1室目を15枠で作る」で10枠が無料になってしまうため）。
insert into public.galleries (owner_id, slug, title, work_cap, created_at) values
  ('d2000000-0000-0000-0000-0000000000d2', 'first', 'First', 5, '2026-01-01T00:00:00Z');
insert into public.purchases (user_id, kind, item_key, sku) values
  ('d2000000-0000-0000-0000-0000000000d2', 'room', 'r2', 'test'),
  ('d2000000-0000-0000-0000-0000000000d2', 'room', 'r3', 'test');
insert into public.galleries (owner_id, slug, title, slots_included, work_cap, created_at) values
  ('d2000000-0000-0000-0000-0000000000d2', 'second', 'Second', true, 15, '2026-02-01T00:00:00Z'),
  ('d2000000-0000-0000-0000-0000000000d2', 'third',  'Third',  true, 15, '2026-03-01T00:00:00Z');

-- Owner 43B: 無料1室だけ
insert into public.galleries (owner_id, slug, title, is_public, work_cap, created_at) values
  ('d3000000-0000-0000-0000-0000000000d3', 'solo', 'Solo', true, 5, '2026-01-15T00:00:00Z');
-- 入口（`is_main`）は 0036 のバックフィルが migration 時に付けるだけなので、
-- あとから insert した部屋には付かない。土台では明示する。
update public.galleries set is_main = true
  where owner_id='d3000000-0000-0000-0000-0000000000d3' and slug='solo';
update public.galleries set is_main = true
  where owner_id='d2000000-0000-0000-0000-0000000000d2' and slug='first';

begin;
\echo '--- 管理者が部屋を足す ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-0000000000d1';
\echo -n '01 管理者は部屋を追加できる: '
select public.admin_add_room('d3000000-0000-0000-0000-0000000000d3') is not null;
reset role;
\echo -n '02 Owner 43B の部屋が 1→2 室になった: '
select count(*)=2 from public.galleries where owner_id='d3000000-0000-0000-0000-0000000000d3';
\echo -n '03 追加された部屋は有料等級（15枠・slots_included）: '
select slots_included and work_cap=15 from public.galleries
  where owner_id='d3000000-0000-0000-0000-0000000000d3' and slug='room-2';
\echo -n '04 題名は未命名扱い（タブに slug が出る）: '
select title='My Gallery' from public.galleries
  where owner_id='d3000000-0000-0000-0000-0000000000d3' and slug='room-2';
\echo -n '05 台帳にも room が1行入った: '
select count(*)=1 from public.purchases
  where user_id='d3000000-0000-0000-0000-0000000000d3' and kind='room';
-- **必ず1行返す形で書く。** `select 式 from ... where 条件` は条件に合う行が無いと
-- **0行＝無言**になり、`t` でも `f` でもないので合格に見える（この項目が実際にそうなって
-- いた。実測 2026-08-09）。`coalesce(bool_and(...), false)` にすると空でも false が出る。
\echo -n '06 入口（is_main）は元の部屋のまま: '
select coalesce(bool_and(slug='solo'), false) from public.galleries
  where owner_id='d3000000-0000-0000-0000-0000000000d3' and is_main;
rollback to s;

\echo '--- 2回押したら2室ふえる（冪等にしない） ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-0000000000d1';
select public.admin_add_room('d3000000-0000-0000-0000-0000000000d3');
select public.admin_add_room('d3000000-0000-0000-0000-0000000000d3');
reset role;
\echo -n '07 2回で2室ふえる: '
select count(*)=3 from public.galleries where owner_id='d3000000-0000-0000-0000-0000000000d3';
\echo -n '08 slug が room-2 / room-3 と重ならずに付く: '
select count(distinct slug)=3 from public.galleries where owner_id='d3000000-0000-0000-0000-0000000000d3';
\echo -n '09 台帳も2行になる（item_key が毎回ちがう）: '
select count(*)=2 from public.purchases
  where user_id='d3000000-0000-0000-0000-0000000000d3' and kind='room';
rollback to s;

\echo '--- 既に room-2 がある人 ---'
savepoint s;
-- Owner 43A は first / second / third を持つ。**既にある部屋の slug を room-2 に改名**して
-- おく（購入無しで insert すると 0038 の番人が正しく弾くので、仕込みは改名で作る）。
-- **仕込みは `set local role` の前に置く** — 管理者ロールのままだと galleries に update
-- ポリシーが無いので0行更新になり、仕込めていないまま「期待と違う」と読める（3回踏んだ）。
update public.galleries set slug='room-2'
  where owner_id='d2000000-0000-0000-0000-0000000000d2' and slug='second';
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-0000000000d1';
select public.admin_add_room('d2000000-0000-0000-0000-0000000000d2');
reset role;
\echo -n '10 空いている slug（room-3）が選ばれる: '
select exists(select 1 from public.galleries
  where owner_id='d2000000-0000-0000-0000-0000000000d2' and slug='room-3');
rollback to s;

\echo '--- 権限 ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-0000000000d3';
\echo -n '11 非管理者は呼べない → '
select public.admin_add_room('d3000000-0000-0000-0000-0000000000d3');
rollback to s;
set local role anon;
\echo -n '12 未ログインは呼べない → '
select public.admin_add_room('d3000000-0000-0000-0000-0000000000d3');
rollback to s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-0000000000d1';
\echo -n '13 居ないユーザーには足せない → '
select public.admin_add_room('d9000000-0000-0000-0000-0000000000d9');
rollback to s;
release s;

\echo -n '14 題名を指定できる: '
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-0000000000d1';
select public.admin_add_room('d3000000-0000-0000-0000-0000000000d3', '特別展 2026');
reset role;
select title='特別展 2026' from public.galleries
  where owner_id='d3000000-0000-0000-0000-0000000000d3' and slug='room-2';
rollback to s;
rollback;
