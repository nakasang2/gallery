\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0070 の帯）。
insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'owner70@example.com');
update public.profiles set username='owner70', display_name='Owner 70' where id='70000000-0000-0000-0000-000000000001';

\set ON_ERROR_STOP off
begin;

create or replace function public.__t70_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

\echo -n '00 【別視点レビューで発見】ロック句(for no key update)が関数本体から消えていない（静的チェック。for update への書き換えや無指定への退行を検出）: '
select pg_get_functiondef('public.record_capacity_purchase'::regproc) ~* 'for no key update';

\echo '--- 用意: 上限(15)に近い部屋(work_cap=14・購入済み枠)、ちょうど境界に届く部屋(work_cap=13)、余裕のある無料部屋(work_cap=5) ---'
-- 有料部屋(slots_included=true)を作るには部屋購入(kind='room')が1つ要る（enforce_room_allowance）。
insert into public.purchases (user_id, kind, item_key, sku) values
  ('70000000-0000-0000-0000-000000000001', 'room', 'room70-p1', 'room'),
  ('70000000-0000-0000-0000-000000000001', 'room', 'room70-p2', 'room');
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included) values
  ('70c00000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'room70-near', 'Near 70', 14, true);
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included) values
  ('70c00000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', 'room70-boundary', 'Boundary 70', 13, true);
insert into public.galleries (id, owner_id, slug, title, work_cap) values
  ('70c00000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'room70-room', 'Room 70', 5);

\echo -n '00b ちょうど上限に届く場合（13+2=15）は applied を返す（partial との境界。符号ミスの退行を検出）: '
select public.record_capacity_purchase(
  '70sess-boundary', '70000000-0000-0000-0000-000000000001', '70c00000-0000-0000-0000-000000000003', 2, 200, 'usd'
) = 'applied';
\echo -n '00c 実際に15へ上がっている: '
select (select work_cap from public.galleries where id='70c00000-0000-0000-0000-000000000003') = 15;

\echo -n '01 通常の購入(5→7)は applied を返す: '
select public.record_capacity_purchase(
  '70sess-normal', '70000000-0000-0000-0000-000000000001', '70c00000-0000-0000-0000-000000000002', 2, 200, 'usd'
) = 'applied';
\echo -n '02 実際に7へ上がっている: '
select (select work_cap from public.galleries where id='70c00000-0000-0000-0000-000000000002') = 7;

\echo '--- 【別視点レビューで発見】上限近くで要求量どおりに入りきらない購入 ---'
\echo -n '03 work_cap=14の部屋に+2を要求すると、15でクランプされ partial を返す（監査で見つかった脆弱性そのもの）: '
select public.record_capacity_purchase(
  '70sess-partial1', '70000000-0000-0000-0000-000000000001', '70c00000-0000-0000-0000-000000000001', 2, 200, 'usd'
) = 'partial';
\echo -n '04 それでも実際にはクランプされた15まで上がっている（部分適用そのものは正しい）: '
select (select work_cap from public.galleries where id='70c00000-0000-0000-0000-000000000001') = 15;
\echo -n '05 既に15の部屋にさらに+1を要求すると、実増分0で partial を返す（並行購入の2件目を模す）: '
select public.record_capacity_purchase(
  '70sess-partial2', '70000000-0000-0000-0000-000000000001', '70c00000-0000-0000-0000-000000000001', 1, 100, 'usd'
) = 'partial';
\echo -n '06 15を超えて上がってはいない: '
select (select work_cap from public.galleries where id='70c00000-0000-0000-0000-000000000001') = 15;

\echo '--- 冪等性・エラー系 ---'
\echo -n '07 同じセッションの再送は duplicate（枠は変わらない）: '
select public.record_capacity_purchase(
  '70sess-normal', '70000000-0000-0000-0000-000000000001', '70c00000-0000-0000-0000-000000000002', 2, 200, 'usd'
) = 'duplicate';
\echo -n '08 存在しない部屋には no_gallery: '
select public.record_capacity_purchase(
  '70sess-nogallery', '70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 1, 100, 'usd'
) = 'no_gallery';
\echo -n '09 他人の部屋には no_gallery（owner_idが一致しない）: '
insert into auth.users (id, email) values ('70000000-0000-0000-0000-000000000002', 'other70@example.com');
select public.record_capacity_purchase(
  '70sess-otherowner', '70000000-0000-0000-0000-000000000002', '70c00000-0000-0000-0000-000000000002', 1, 100, 'usd'
) = 'no_gallery';
\echo -n '10 amount が0以下なら例外: '
select public.__t70_state($q$
  select public.record_capacity_purchase('70sess-zero', '70000000-0000-0000-0000-000000000001', '70c00000-0000-0000-0000-000000000002', 0, 0, 'usd')
$q$) like '%amount must be positive%';
