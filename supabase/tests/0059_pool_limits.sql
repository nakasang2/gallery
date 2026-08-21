\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0059 の帯）。
insert into auth.users (id, email) values
  ('79000000-0000-0000-0000-000000000001', 'owner59@example.com');
update public.profiles set username='owner59' where id='79000000-0000-0000-0000-000000000001';

\set ON_ERROR_STOP off
begin;

-- 拒否の確認を positive なアサーションにする（LESSONS 2026-08-13。`sql-verdict.mjs` は
-- `ERROR` を見ないので、例外を目で見るだけでは「通ってしまった場合」も緑になる）。
create or replace function public.__t59_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- `replace_placements` に渡す配列を作る。`jsonb_agg` の中に直接ウィンドウ関数は書けない
-- ので、番号付けは内側の副問い合わせで済ませる。
create or replace function public.__t59_rows(p_owner uuid, p_limit int default null, p_shift int default 0)
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('artwork_id', t.id, 'slot_index', t.rn - 1 + p_shift))
    from (select a.id, row_number() over (order by a.id) as rn
            from public.artworks a where a.owner_id = p_owner
           order by a.id limit p_limit) t;
$$;

-- 検証側は**実装を使い回さず独立に数える**（`placement_pool_used` は authenticated から
-- 実行できないよう revoke してあるので、テストの席からは呼べない ── そして独立に
-- 数える方が、実装が正しいかを本当に確かめられる）。
create or replace function public.__t59_used(p_owner uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.placements p
    join public.galleries g on g.id = p.gallery_id where g.owner_id = p_owner;
$$;

\echo '--- 用意: 無料部屋1室（5枠）だけの口座 ---'
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap) values
  ('79000000-0000-0000-0000-000000000011', '79000000-0000-0000-0000-000000000001', 'room59', 'Room 59', true, 5);
do $$ begin
  if not exists (select 1 from public.galleries where id='79000000-0000-0000-0000-000000000011')
  then raise exception '0059 test harness did not seed'; end if;
end $$;

\echo -n '01 枠の合計は5（無料部屋1室）: '
select public.work_slot_pool('79000000-0000-0000-0000-000000000001') = 5;
\echo -n '02 部屋を1つも持たない口座でも下限5（締め出さない）: '
select public.work_slot_pool('00000000-0000-0000-0000-0000000000ff') = 5;

\echo '--- 作品の点数（上限5） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '79000000-0000-0000-0000-000000000001';
-- storage_path は {owner_id}/{id} の形が必須（0074 の artworks_guard_storage_path）。
\echo -n '03 5点までは上げられる: '
select public.__t59_state($q$
  insert into public.artworks (id, owner_id, title, width, height, storage_path)
  select ('79000000-0000-0000-0000-0000000000' || to_char(g, 'FM00'))::uuid,
         '79000000-0000-0000-0000-000000000001', 'W'||g, 1, 1,
         '79000000-0000-0000-0000-000000000001/79000000-0000-0000-0000-0000000000' || to_char(g, 'FM00')
    from generate_series(1,5) g
$q$) = 'no-error';
\echo -n '04 6点目は拒否される（ブラウザを通さない直接の insert でも）: '
select public.__t59_state($q$
  insert into public.artworks (id, owner_id, title, width, height, storage_path) values
    ('79000000-0000-0000-0000-0000000000d6', '79000000-0000-0000-0000-000000000001', 'W6', 1, 1,
     '79000000-0000-0000-0000-000000000001/79000000-0000-0000-0000-0000000000d6')
$q$) like '%work slot pool exceeded: 6 works for a pool of 5%';
\echo -n '05 拒否された行は入っていない: '
select (select count(*) from public.artworks where owner_id='79000000-0000-0000-0000-000000000001') = 5;

\echo '--- 枠を買えば増やせる（上限がDBの数字から導出されている確認） ---'
reset role;
update public.galleries set work_cap = 8 where id='79000000-0000-0000-0000-000000000011';
set local role authenticated;
set local "request.jwt.claim.sub" = '79000000-0000-0000-0000-000000000001';
\echo -n '06 枠を8にすると6点目が通る: '
select public.__t59_state($q$
  insert into public.artworks (id, owner_id, title, width, height, storage_path) values
    ('79000000-0000-0000-0000-0000000000d6', '79000000-0000-0000-0000-000000000001', 'W6', 1, 1,
     '79000000-0000-0000-0000-000000000001/79000000-0000-0000-0000-0000000000d6')
$q$) = 'no-error';

\echo '--- 配置の点数（口座全体で数える） ---'
\echo -n '07 6点を1部屋に掛けられる（枠8）: '
select public.replace_placements('79000000-0000-0000-0000-000000000011',
  public.__t59_rows('79000000-0000-0000-0000-000000000001')) = 6;

\echo '--- 枠を減らす（部屋の削除・合同展示からの離脱で実際に起きる） ---'
reset role;
update public.galleries set work_cap = 5 where id='79000000-0000-0000-0000-000000000011';
\echo -n '08 いま使用6・上限5＝既に超過している状態が作れた: '
select public.placement_pool_used('79000000-0000-0000-0000-000000000001') = 6
   and public.work_slot_pool('79000000-0000-0000-0000-000000000001') = 5;
set local role authenticated;
set local "request.jwt.claim.sub" = '79000000-0000-0000-0000-000000000001';
\echo -n '09 **超過していても「1点外す」保存は通る**（閉じ込めない）: '
select public.__t59_state($q$
  select public.replace_placements('79000000-0000-0000-0000-000000000011',
    public.__t59_rows('79000000-0000-0000-0000-000000000001', 5))
$q$) = 'no-error';
\echo -n '10 5点に減っている: '
select public.__t59_used('79000000-0000-0000-0000-000000000001') = 5;
\echo -n '11 上限まで戻ったので、そこから増やすのは拒否される: '
select public.__t59_state($q$
  select public.replace_placements('79000000-0000-0000-0000-000000000011',
    public.__t59_rows('79000000-0000-0000-0000-000000000001'))
$q$) like '%work slot pool exceeded: 6 placements for a pool of 5%';
\echo -n '12 拒否されたので5点のまま（部分適用されていない）: '
select public.__t59_used('79000000-0000-0000-0000-000000000001') = 5;

\echo '--- 超過状態のまま「並べ替えるだけ」も通る ---'
reset role;
-- もう一度6点の超過状態を作る（RPCを通さず素の権限で入れる＝トリガは走るが baseline 0
-- では拒否されるので、トリガを一時的に外して土台だけ作る）
alter table public.placements disable trigger placements_pool_limit;
insert into public.placements (gallery_id, artwork_id, slot_index)
  select '79000000-0000-0000-0000-000000000011', a.id, 5
    from public.artworks a where a.owner_id='79000000-0000-0000-0000-000000000001'
     and a.id not in (select artwork_id from public.placements
                       where gallery_id='79000000-0000-0000-0000-000000000011');
alter table public.placements enable trigger placements_pool_limit;
\echo -n '13 使用6・上限5の状態に戻した: '
select public.__t59_used('79000000-0000-0000-0000-000000000001') = 6;
set local role authenticated;
set local "request.jwt.claim.sub" = '79000000-0000-0000-0000-000000000001';
\echo -n '14 **点数を変えずに枠を移す保存も通る**（超過中でも並べ替えできる）: '
select public.__t59_state($q$
  select public.replace_placements('79000000-0000-0000-0000-000000000011',
    public.__t59_rows('79000000-0000-0000-0000-000000000001', null, 8))
$q$) = 'no-error';
\echo -n '15 6点のまま（減らしても増やしてもいない）: '
select public.__t59_used('79000000-0000-0000-0000-000000000001') = 6;

\echo '--- RPCを通らない直接の書き込みは厳密に判定する（baseline が無い） ---'
\echo -n '16 直接 insert で増やそうとすると拒否される: '
select public.__t59_state($q$
  insert into public.placements (gallery_id, artwork_id, slot_index) values
    ('79000000-0000-0000-0000-000000000011',
     (select id from public.artworks where owner_id='79000000-0000-0000-0000-000000000001' order by id limit 1), 14)
$q$) like '%work slot pool exceeded%';

\echo '--- 1部屋の物理上限（15枠） ---'
reset role;
update public.galleries set work_cap = 15 where id='79000000-0000-0000-0000-000000000011';
-- 2室目（有料等級・15枠込み）は購入台帳が無いと 0038 の `enforce_room_allowance` に
-- 弾かれる（"no unused room purchase"）。$25 の部屋を1つ買った状態にする。
insert into public.purchases (user_id, kind, item_key, amount_jpy, currency) values
  ('79000000-0000-0000-0000-000000000001', 'room', 'room-59b', 2500, 'usd');
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('79000000-0000-0000-0000-000000000012', '79000000-0000-0000-0000-000000000001', 'r59b', 'Room 59 B', null, true, 15);
delete from public.placements where gallery_id='79000000-0000-0000-0000-000000000011';
insert into public.artworks (id, owner_id, title, width, height, storage_path)
  select ('79000000-0000-0000-0000-0000000000e' || to_char(g, 'FM0'))::uuid,
         '79000000-0000-0000-0000-000000000001', 'X'||g, 1, 1, 'x/'||g
    from generate_series(1,9) g;
\echo -n '17 枠30・作品15点を用意できた: '
select public.work_slot_pool('79000000-0000-0000-0000-000000000001') = 30
   and (select count(*) from public.artworks where owner_id='79000000-0000-0000-0000-000000000001') = 15;
set local role authenticated;
set local "request.jwt.claim.sub" = '79000000-0000-0000-0000-000000000001';
\echo -n '18 15点は1部屋に掛かる: '
select public.replace_placements('79000000-0000-0000-0000-000000000011',
  public.__t59_rows('79000000-0000-0000-0000-000000000001')) = 15;
\echo -n '19 枠が余っていても16点目は物理上限で拒否される: '
select public.__t59_state($q$
  insert into public.placements (gallery_id, artwork_id, slot_index) values
    ('79000000-0000-0000-0000-000000000011',
     (select id from public.artworks where owner_id='79000000-0000-0000-0000-000000000001' order by id limit 1), 20)
$q$) like '%room slot limit exceeded: 16 placements in one room (max 15)%';
\echo -n '20 2部屋に分ければ合計30点まで掛かる（口座全体で数えている確認）: '
select public.replace_placements('79000000-0000-0000-0000-000000000012',
  public.__t59_rows('79000000-0000-0000-0000-000000000001')) = 15;
\echo -n '21 合計30点になっている: '
select public.__t59_used('79000000-0000-0000-0000-000000000001') = 30;

\echo '--- UPDATE で部屋を寄せて物理上限を破れないこと（別視点レビュー指摘 2026-08-13） ---'
-- A室に 0..14 の15行、B室に 15 の1行を作り、A室ぶんをB室へ寄せると16行になる形。
reset role;
delete from public.placements;
alter table public.placements disable trigger placements_pool_limit;
insert into public.placements (gallery_id, artwork_id, slot_index)
  select '79000000-0000-0000-0000-000000000011', t.id, t.rn - 1
    from (select a.id, row_number() over (order by a.id) as rn
            from public.artworks a where a.owner_id='79000000-0000-0000-0000-000000000001') t;
insert into public.placements (gallery_id, artwork_id, slot_index)
  select '79000000-0000-0000-0000-000000000012', a.id, 15
    from public.artworks a where a.owner_id='79000000-0000-0000-0000-000000000001' order by a.id limit 1;
alter table public.placements enable trigger placements_pool_limit;
\echo -n '25 用意: A室15行・B室1行（合計16・枠30なので口座は超過していない）: '
select (select count(*) from public.placements where gallery_id='79000000-0000-0000-0000-000000000011') = 15
   and (select count(*) from public.placements where gallery_id='79000000-0000-0000-0000-000000000012') = 1;
set local role authenticated;
set local "request.jwt.claim.sub" = '79000000-0000-0000-0000-000000000001';
\echo -n '26 A室の15行をB室へ寄せる UPDATE は物理上限で拒否される: '
select public.__t59_state($q$
  update public.placements set gallery_id='79000000-0000-0000-0000-000000000012'
   where gallery_id='79000000-0000-0000-0000-000000000011'
$q$) like '%room slot limit exceeded: 16 placements in one room (max 15)%';
\echo -n '27 拒否されたので行は動いていない: '
select (select count(*) from public.placements where gallery_id='79000000-0000-0000-0000-000000000011') = 15;
\echo -n '28 上限内に収まる UPDATE は通る（口座の合計は動かないので誤拒否しない）: '
select public.__t59_state($q$
  update public.placements set slot_index = slot_index + 100
   where gallery_id='79000000-0000-0000-0000-000000000011'
$q$) = 'no-error';

\echo '--- 権限 ---'
reset role;
\echo -n '22 判定の材料は誰にも grant されていない（他人の枠数を問い合わせられない）: '
select not has_function_privilege('authenticated', 'public.work_slot_pool(uuid)', 'execute')
   and not has_function_privilege('authenticated', 'public.placement_pool_used(uuid)', 'execute')
   and not has_function_privilege('service_role', 'public.work_slot_pool(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.work_slot_pool(uuid)', 'execute');
\echo -n '22b 申告の入口だけ authenticated に開いている（引数が無く自分の分しか見ない）: '
select has_function_privilege('authenticated', 'public.note_placement_baseline()', 'execute')
   and not has_function_privilege('anon', 'public.note_placement_baseline()', 'execute');
\echo -n '23 トリガ関数も grant されていない: '
select not has_function_privilege('authenticated', 'public.enforce_artwork_pool()', 'execute')
   and not has_function_privilege('authenticated', 'public.enforce_placement_pool()', 'execute');
\echo -n '24 トリガは statement 単位で遷移表を使っている: '
select (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
         where c.relname in ('artworks','placements')
           and t.tgname in ('artworks_pool_limit','placements_pool_limit','placements_room_limit_update')
           and t.tgnewtable is not null and not t.tgtype::int & 1 = 1) = 3;

rollback;
