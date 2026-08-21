\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0061 の帯）。
insert into auth.users (id, email) values
  ('61000000-0000-0000-0000-000000000001', 'host61@example.com'),
  ('61000000-0000-0000-0000-000000000002', 'other61@example.com');
update public.profiles set username='host61',  display_name='Host 61'  where id='61000000-0000-0000-0000-000000000001';
update public.profiles set username='other61', display_name='Other 61' where id='61000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

-- 例外を捕まえて SQLSTATE を返す（`supabase/tests/0058_replace_placements.sql` の
-- `__t58_state` と同じ作法）。`→ ERROR` だけで済ませると番号付きの項目に t/f が
-- 一度も出ず「空振り」になる（AGENTS.md 5.5 / check:gates の空振り検出）ので、
-- ここでは任意のSQL文をラップして SQLSTATE を突き合わせる形にする。
create or replace function public.__t61_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '61000000-0000-0000-0000-000000000001';

\echo '--- 用意: 通常の部屋2室（唯一の部屋を合同展示に持っていけない制約を避けるため）と展示 ---'
insert into public.galleries (id, owner_id, slug, title, work_cap) values
  ('61a00000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'room61-1', 'Room 1', 5);
reset role;
-- 2件購入する。1件目は room61-2 が使う。2件目は、あとで合同展示の部屋を通常展示へ
-- 戻す（switch_room_expo）検証のときに**着地先の空き**として要る（`switch_room_expo`は
-- 通常展示へ戻すとき「有料枠の購入が余っているか」を見るので、無いと拒否される）。
insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency) values
  ('61000000-0000-0000-0000-000000000001', 'room', 'sku61-1', 'sku61-1', 2500, 'usd'),
  ('61000000-0000-0000-0000-000000000001', 'room', 'sku61-2', 'sku61-2', 2500, 'usd');
set local role authenticated;
set local "request.jwt.claim.sub" = '61000000-0000-0000-0000-000000000001';
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included) values
  ('61a00000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'room61-2', 'Room 2', 15, true);
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('61e00000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'expo61', 'Expo 61', 14);

/* ================= 1. 1展示1部屋 ================= */

\echo '--- 1本目の部屋は作れる ---'
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('61b00000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'expo61-a', 'Expo Room A',
   '61e00000-0000-0000-0000-000000000001', true, 15);
\echo -n '01 1本目は入っている: '
select count(*)=1 from public.galleries where expo_id='61e00000-0000-0000-0000-000000000001';

\echo -n '02 同じ展示に2本目を作ろうとすると拒否される（check_violation=23514）: '
select public.__t61_state($sql$
  insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
    ('61b00000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'expo61-b', 'Expo Room B',
     '61e00000-0000-0000-0000-000000000001', true, 15)
$sql$) = '23514';
\echo -n '03 2本目は入っていない（1本のまま）: '
select count(*)=1 from public.galleries where expo_id='61e00000-0000-0000-0000-000000000001';

\echo -n '04 既存の別部屋を switch_room_expo() で同じ展示へ入れようとしても拒否される（23514）: '
select public.__t61_state($sql$
  select public.switch_room_expo('61a00000-0000-0000-0000-000000000002', '61e00000-0000-0000-0000-000000000001')
$sql$) = '23514';
\echo -n '05 拒否されたので room61-2 は通常展示のまま: '
select coalesce(bool_and(expo_id is null), false) from public.galleries
  where id='61a00000-0000-0000-0000-000000000002';

\echo '--- 出て行けば、別の部屋がそこへ入れる ---'
select public.switch_room_expo('61b00000-0000-0000-0000-000000000001', null);
\echo -n '06 出て行った直後は展示に部屋が無い: '
select count(*)=0 from public.galleries where expo_id='61e00000-0000-0000-0000-000000000001';
select public.switch_room_expo('61a00000-0000-0000-0000-000000000002', '61e00000-0000-0000-0000-000000000001');
\echo -n '07 空いた展示に別の部屋が入れる: '
select coalesce(bool_and(expo_id='61e00000-0000-0000-0000-000000000001'), false) from public.galleries
  where id='61a00000-0000-0000-0000-000000000002';
-- 後段のためにいったん戻す（room61-2 を通常展示へ・部屋Aを展示へ）。
select public.switch_room_expo('61a00000-0000-0000-0000-000000000002', null);
select public.switch_room_expo('61b00000-0000-0000-0000-000000000001', '61e00000-0000-0000-0000-000000000001');
\echo -n '08 元の配置に戻った（部屋Aだけが展示に居る）: '
select coalesce(bool_and(expo_id='61e00000-0000-0000-0000-000000000001'), false) from public.galleries
  where id='61b00000-0000-0000-0000-000000000001';

/* ================= 2. 作品プールの分離 ================= */

\echo '--- 通常の共有プール（room61-1・無料5枠＋room61-2・有料15枠＝20）に5点入れる ---'
-- storage_path は {owner_id}/{id} の形が必須（0074 の artworks_guard_storage_path）。
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('61c00000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'W1', 100, 100,
   '61000000-0000-0000-0000-000000000001/61c00000-0000-0000-0000-000000000001'),
  ('61c00000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'W2', 100, 100,
   '61000000-0000-0000-0000-000000000001/61c00000-0000-0000-0000-000000000002'),
  ('61c00000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000001', 'W3', 100, 100,
   '61000000-0000-0000-0000-000000000001/61c00000-0000-0000-0000-000000000003'),
  ('61c00000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000001', 'W4', 100, 100,
   '61000000-0000-0000-0000-000000000001/61c00000-0000-0000-0000-000000000004'),
  ('61c00000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000001', 'W5', 100, 100,
   '61000000-0000-0000-0000-000000000001/61c00000-0000-0000-0000-000000000005');
\echo -n '09 5点は入っている（拒否されていない）: '
select count(*)=5 from public.artworks
  where owner_id='61000000-0000-0000-0000-000000000001' and gallery_id is null;
-- `work_slot_pool`/`placement_pool_used` は internal（authenticated には grant されていない
-- ── 0059 テスト22）ので、確かめるときだけ超越ロール（postgres）に戻る。
reset role;
\echo -n '09b 口座の共有プールは room61-1(5)+room61-2(15)=20（合同展示の部屋Aの15は入らない）: '
select public.work_slot_pool('61000000-0000-0000-0000-000000000001') = 20;
set local role authenticated;
set local "request.jwt.claim.sub" = '61000000-0000-0000-0000-000000000001';

\echo '--- 合同展示の部屋（Expo Room A）専用プールは、共有プールの残量と無関係 ---'
insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
  ('61d00000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'EW1', 100, 100,
   '61000000-0000-0000-0000-000000000001/61d00000-0000-0000-0000-000000000001',
   '61b00000-0000-0000-0000-000000000001');
\echo -n '10 合同展示の部屋専用プールに1点入る（共有プールは20点上限とは無関係に動く）: '
select count(*)=1 from public.artworks where gallery_id='61b00000-0000-0000-0000-000000000001';
\echo -n '11 共有プール側の使用点数は増えていない（5のまま）: '
select count(*)=5 from public.artworks
  where owner_id='61000000-0000-0000-0000-000000000001' and gallery_id is null;

\echo '--- 合同展示の部屋専用プールは、その部屋自身の work_cap(15) で頭打ち ---'
do $$
declare i int;
begin
  for i in 2..15 loop
    insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
      (('61d00000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       '61000000-0000-0000-0000-000000000001', 'EW' || i, 100, 100,
       '61000000-0000-0000-0000-000000000001/61d00000-0000-0000-0000-' || lpad(i::text, 12, '0'),
       '61b00000-0000-0000-0000-000000000001');
  end loop;
end $$;
\echo -n '12 合同展示の部屋専用プールが15点で埋まった: '
select count(*)=15 from public.artworks where gallery_id='61b00000-0000-0000-0000-000000000001';

\echo -n '13 16点目は部屋自身の上限(15)で拒否される（P0001）: '
select public.__t61_state($sql$
  insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
    ('61d00016-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'EW16', 100, 100,
     '61000000-0000-0000-0000-000000000001/61d00016-0000-0000-0000-000000000000',
     '61b00000-0000-0000-0000-000000000001')
$sql$) = 'P0001';
\echo -n '14 拒否されたので15点のまま: '
select count(*)=15 from public.artworks where gallery_id='61b00000-0000-0000-0000-000000000001';

\echo '--- gallery_id は「自分の合同展示の部屋」しか名乗れない ---'
\echo -n '15 通常展示の部屋（room61-1）のidを名乗ると拒否される（共有プールの上限回避の抜け穴を防ぐ・P0001）: '
select public.__t61_state($sql$
  insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
    ('61d09999-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'Fake', 100, 100,
     '61000000-0000-0000-0000-000000000001/61d09999-0000-0000-0000-000000000000',
     '61a00000-0000-0000-0000-000000000001')
$sql$) = 'P0001';

-- 他人（other61）の合同展示の部屋を1つ、素の権限で正式に用意する。
reset role;
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('61e00000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 'expo61-other', 'Expo 61 Other', 14);
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('61b00000-0000-0000-0000-000000000099', '61000000-0000-0000-0000-000000000002', 'other-room', 'Other Room',
   '61e00000-0000-0000-0000-000000000002', true, 15);
set local role authenticated;
set local "request.jwt.claim.sub" = '61000000-0000-0000-0000-000000000001';
\echo -n '16 他人の合同展示の部屋のidを付けると拒否される（P0001）: '
select public.__t61_state($sql$
  insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
    ('61d08888-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'Fake2', 100, 100,
     '61000000-0000-0000-0000-000000000001/61d08888-0000-0000-0000-000000000000',
     '61b00000-0000-0000-0000-000000000099')
$sql$) = 'P0001';

\echo '--- 合同展示の部屋の配置点数は、共有プールの計算に混ざらない ---'
\echo '(合同展示の部屋 Expo Room A の物理15枠いっぱいに掛ける。共有プールに正しく除かれて'
\echo ' いなければ、このあと共有プール側で20点ぴったりまで掛けられるはずが早めに拒否される)'
insert into public.placements (gallery_id, artwork_id, slot_index)
select '61b00000-0000-0000-0000-000000000001',
       ('61d00000-0000-0000-0000-' || lpad(s::text, 12, '0'))::uuid,
       s - 1
  from generate_series(1, 15) as s;
\echo -n '17 合同展示の部屋の物理15枠が埋まった: '
select count(*)=15 from public.placements where gallery_id='61b00000-0000-0000-0000-000000000001';

-- 共有プール（work_slot_pool = room61-1(5) + room61-2(15) = 20）ちょうどまで、
-- 5点の作品を使い回して掛ける（room61-1に15・room61-2に5＝合計20）。
insert into public.placements (gallery_id, artwork_id, slot_index)
select '61a00000-0000-0000-0000-000000000001',
       (array['61c00000-0000-0000-0000-000000000001','61c00000-0000-0000-0000-000000000002',
              '61c00000-0000-0000-0000-000000000003','61c00000-0000-0000-0000-000000000004',
              '61c00000-0000-0000-0000-000000000005']::uuid[])[((s - 1) % 5) + 1],
       s - 1
  from generate_series(1, 15) as s;
insert into public.placements (gallery_id, artwork_id, slot_index)
select '61a00000-0000-0000-0000-000000000002',
       (array['61c00000-0000-0000-0000-000000000001','61c00000-0000-0000-0000-000000000002',
              '61c00000-0000-0000-0000-000000000003','61c00000-0000-0000-0000-000000000004',
              '61c00000-0000-0000-0000-000000000005']::uuid[])[((s - 1) % 5) + 1],
       s - 1
  from generate_series(1, 5) as s;
\echo -n '18 合同展示の部屋の15点に**関係なく**、共有プールちょうど20点まで掛けられた: '
select count(*)=20 from public.placements
  where gallery_id in ('61a00000-0000-0000-0000-000000000001', '61a00000-0000-0000-0000-000000000002');

\echo -n '19 共有プールの21点目は拒否される（合同展示の部屋の15点は足されていない・P0001）: '
select public.__t61_state($sql$
  insert into public.placements (gallery_id, artwork_id, slot_index) values
    ('61a00000-0000-0000-0000-000000000002', '61c00000-0000-0000-0000-000000000001', 5)
$sql$) = 'P0001';

\echo '--- 通常展示に戻すと、専用プールの未配置の作品は共有プールへ解放される ---'
-- 新しい展示・部屋を1本用意（既存の expo61/Expo Room A は placements で埋まっていて
-- 空ではないので switch_room_expo() の対象にできない）。アップロードだけして
-- 掛けない＝「アップロード済みだが未配置」を再現する。
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('61e00000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000001', 'expo61-c', 'Expo 61 C', 14);
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('61b00000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000001', 'expo61-c-a', 'Expo C Room',
   '61e00000-0000-0000-0000-000000000003', true, 15);
insert into public.artworks (id, owner_id, title, width, height, storage_path, gallery_id) values
  ('61d0c000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'Orphan candidate', 100, 100,
   '61000000-0000-0000-0000-000000000001/61d0c000-0000-0000-0000-000000000001',
   '61b00000-0000-0000-0000-000000000003');
select public.switch_room_expo('61b00000-0000-0000-0000-000000000003', null);
\echo -n '20 通常展示へ戻したあと、その作品の gallery_id が null に解放されている: '
select coalesce(bool_and(gallery_id is null), false) from public.artworks
  where id='61d0c000-0000-0000-0000-000000000001';
\echo -n '21 共有プール（gallery_id is null）のライブラリから見えるようになっている: '
select count(*)=1 from public.artworks
  where owner_id='61000000-0000-0000-0000-000000000001' and gallery_id is null
    and id='61d0c000-0000-0000-0000-000000000001';

rollback;
