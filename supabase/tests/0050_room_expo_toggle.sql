\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0050 の帯）。
insert into auth.users (id, email) values
  ('55000000-0000-0000-0000-000000000001', 'host50@example.com'),
  ('55000000-0000-0000-0000-000000000002', 'other50@example.com');
update public.profiles set username='host50',  display_name='Host 50'  where id='55000000-0000-0000-0000-000000000001';
update public.profiles set username='other50', display_name='Other 50' where id='55000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

-- 拒否の確認は**positive なアサーション**にする（DECISIONS 2026-08-13 の決定1）。
-- 理由の全文は 0044_expos の同じ関数のコメント。psql の変数はドル引用符の中では
-- 展開されないので、使う場合は `|| quote_literal(:'x') ||` で外へ出す（0048 参照）。
create or replace function public.__t0050_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

\echo '--- 用意: 主催者の下書き展示・他人の展示・作品1点 ---'
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('55000000-0000-0000-0000-000000000011', '55000000-0000-0000-0000-000000000001', 'host50-expo', 'Host 50 Expo', 14);
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('55000000-0000-0000-0000-000000000012', '55000000-0000-0000-0000-000000000002', 'other50-expo', 'Other 50 Expo', 14);
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000001', 'Host work', 1000, 800, 'h/1');

set local role authenticated;
set local "request.jwt.claim.sub" = '55000000-0000-0000-0000-000000000001';

\echo '--- 部屋A（無料・唯一の部屋）を用意 ---'
insert into public.galleries (id, owner_id, slug, title, work_cap) values
  ('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000001', 'room50-a', 'Room A', 5);
\echo -n '01 作成直後は通常展示（無料・5枠）: '
select coalesce(bool_and(expo_id is null and not slots_included and work_cap=5), false)
  from public.galleries where id='55000000-0000-0000-0000-000000000031';

\echo '--- 唯一の部屋は合同展示に持っていけない（玄関が無くなるため） ---'
savepoint e;
\echo -n '02 唯一の部屋を合同展示にしようとすると拒否される : '
select public.__t0050_state($q$select public.switch_room_expo('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000011');$q$) = '23514';
rollback to e; release e;
\echo -n '   （拒否されたので部屋Aはまだ通常展示のまま）: '
select coalesce(bool_and(expo_id is null), false)
  from public.galleries where id='55000000-0000-0000-0000-000000000031';

\echo '--- 部屋を購入して部屋C（有料・通常展示）を用意し、2室目を作る ---'
reset role;
insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency) values
  ('55000000-0000-0000-0000-000000000001', 'room', 'sku50-1', 'sku50-1', 2500, 'usd');
set local role authenticated;
set local "request.jwt.claim.sub" = '55000000-0000-0000-0000-000000000001';
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included) values
  ('55000000-0000-0000-0000-000000000033', '55000000-0000-0000-0000-000000000001', 'room50-c', 'Room C', 15, true);

\echo '--- 他に通常展示の部屋があるので、部屋Aは合同展示に入れる ---'
select public.switch_room_expo('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000011');
\echo -n '03 合同展示に入った（有料等級・15枠に揃う）: '
select coalesce(bool_and(expo_id='55000000-0000-0000-0000-000000000011' and slots_included and work_cap=15), false)
  from public.galleries where id='55000000-0000-0000-0000-000000000031';

\echo -n '04 同じ値を渡しても無害（二度押し）: '
select public.switch_room_expo('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000011');
select coalesce(bool_and(expo_id='55000000-0000-0000-0000-000000000011'), false)
  from public.galleries where id='55000000-0000-0000-0000-000000000031';

\echo '--- 合同展示 → 通常展示（無料枠は空いているので着地） ---'
select public.switch_room_expo('55000000-0000-0000-0000-000000000031', null);
\echo -n '05 通常展示に戻り、無料の1室として着地: '
select coalesce(bool_and(expo_id is null and not slots_included and work_cap=5), false)
  from public.galleries where id='55000000-0000-0000-0000-000000000031';

\echo '--- 部屋B（最初から合同展示として作成）を通常展示に戻す ---'
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included, expo_id) values
  ('55000000-0000-0000-0000-000000000032', '55000000-0000-0000-0000-000000000001', 'room50-b', 'Room B', 15, true,
   '55000000-0000-0000-0000-000000000011');

savepoint e;
\echo -n '06 無料枠は部屋Aが使用中・有料枠も部屋Cが購入を使い切っているので拒否される : '
select public.__t0050_state($q$select public.switch_room_expo('55000000-0000-0000-0000-000000000032', null);$q$) = '23514';
rollback to e; release e;

\echo '--- もう1つ購入があれば有料枠に着地する ---'
reset role;
insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency) values
  ('55000000-0000-0000-0000-000000000001', 'room', 'sku50-2', 'sku50-2', 2500, 'usd');
set local role authenticated;
set local "request.jwt.claim.sub" = '55000000-0000-0000-0000-000000000001';
select public.switch_room_expo('55000000-0000-0000-0000-000000000032', null);
\echo -n '07 2件目の購入で有料枠(15枠)に着地: '
select coalesce(bool_and(expo_id is null and slots_included and work_cap=15), false)
  from public.galleries where id='55000000-0000-0000-0000-000000000032';

\echo '--- 空でない部屋は切替できない ---'
savepoint e;
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000021', 0);
\echo -n '08 作品が置かれた部屋は合同展示に入れない : '
select public.__t0050_state($q$select public.switch_room_expo('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000011');$q$) = '23514';
rollback to e; release e;

\echo '--- 他人の展示・他人の部屋は触れない ---'
savepoint e;
\echo -n '09 他人の展示には入れられない : '
select public.__t0050_state($q$select public.switch_room_expo('55000000-0000-0000-0000-000000000031', '55000000-0000-0000-0000-000000000012');$q$) = '23514';
rollback to e; release e;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '55000000-0000-0000-0000-000000000002';
savepoint e;
\echo -n '10 他人の部屋は切替できない : '
select public.__t0050_state($q$select public.switch_room_expo('55000000-0000-0000-0000-000000000031', null);$q$) = 'P0001';
rollback to e; release e;
reset role;

\echo '--- 直接のUPDATEは塞がれている（switch_room_expo() 経由を強制） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '55000000-0000-0000-0000-000000000001';
savepoint e;
\echo -n '11 生のUPDATEでexpo_idを書けない : '
select public.__t0050_state($q$update public.galleries set expo_id = '55000000-0000-0000-0000-000000000011'
 where id = '55000000-0000-0000-0000-000000000031';$q$) = '23514';
rollback to e; release e;
reset role;

rollback;
