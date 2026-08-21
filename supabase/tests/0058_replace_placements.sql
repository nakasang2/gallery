\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0058 の帯）。
insert into auth.users (id, email) values
  ('78000000-0000-0000-0000-000000000001', 'owner58@example.com'),
  ('78000000-0000-0000-0000-000000000002', 'guest58@example.com'),
  ('78000000-0000-0000-0000-000000000003', 'stranger58@example.com');
update public.profiles set username='owner58'     where id='78000000-0000-0000-0000-000000000001';
update public.profiles set username='guest58'     where id='78000000-0000-0000-0000-000000000002';
update public.profiles set username='stranger58'  where id='78000000-0000-0000-0000-000000000003';

\set ON_ERROR_STOP off
begin;

-- 拒否の確認を **positive なアサーション**にするための補助（このトランザクション限り）。
-- `scripts/sql-verdict.mjs` は `ERROR` を見ない（拒否の確認では期待しているため）ので、
-- `select public.replace_placements(...)` が例外を出すのを目で見るだけでは、
-- **通ってしまった場合も「すべて期待どおり」になる**（数値が出るだけで `f` は出ない）。
-- SQLSTATE を返させて `= '42501'` を突き合わせれば、通れば `f` が出る。
-- 別のSQLSTATE（書き間違いなど）で通ってしまうことも防げる。
-- `exception` を持つブロックは副トランザクションなので、部分挿入もここで巻き戻る。
create or replace function public.__t58_state(p_gallery uuid, p_rows jsonb)
returns text language plpgsql as $$
begin
  perform public.replace_placements(p_gallery, p_rows);
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

\echo '--- 用意: 所有者の部屋1室＋自分の作品3点／他人の作品1点 ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '78000000-0000-0000-0000-000000000001';
-- `work_cap` は明示する。列の既定は10だが、0038 の `enforce_room_allowance` は
-- 「無料の1室目は `PLAN.worksPerGallery`（5）で作る」しか許さない（既定値のままだと
-- "work_cap 10 not allowed for the free room" で弾かれる）。
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap) values
  ('78000000-0000-0000-0000-000000000011', '78000000-0000-0000-0000-000000000001', 'room58', 'Room 58', true, 5);
-- storage_path は {owner_id}/{id} の形が必須（0074 の artworks_guard_storage_path）。
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('78000000-0000-0000-0000-0000000000c1', '78000000-0000-0000-0000-000000000001', 'Own 1', 1, 1,
   '78000000-0000-0000-0000-000000000001/78000000-0000-0000-0000-0000000000c1'),
  ('78000000-0000-0000-0000-0000000000c2', '78000000-0000-0000-0000-000000000001', 'Own 2', 1, 1,
   '78000000-0000-0000-0000-000000000001/78000000-0000-0000-0000-0000000000c2'),
  ('78000000-0000-0000-0000-0000000000c3', '78000000-0000-0000-0000-000000000001', 'Own 3', 1, 1,
   '78000000-0000-0000-0000-000000000001/78000000-0000-0000-0000-0000000000c3');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '78000000-0000-0000-0000-000000000002';
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('78000000-0000-0000-0000-0000000000a1', '78000000-0000-0000-0000-000000000002', 'Guest 1', 1, 1,
   '78000000-0000-0000-0000-000000000002/78000000-0000-0000-0000-0000000000a1');
reset role;

-- **番人の番人**: 土台が無いと下の否定形アサーションが全部通ってしまう
-- （LESSONS 2026-08-09「否定形のアサーションは土台が無いときも通る」）。
do $$ begin
  if not exists (select 1 from public.galleries where id='78000000-0000-0000-0000-000000000011')
     or (select count(*) from public.artworks
          where id in ('78000000-0000-0000-0000-0000000000c1','78000000-0000-0000-0000-0000000000c2',
                       '78000000-0000-0000-0000-0000000000c3','78000000-0000-0000-0000-0000000000a1')) <> 4
  then raise exception '0058 test harness did not seed'; end if;
end $$;

\echo '--- 所有者が3点を置く ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '78000000-0000-0000-0000-000000000001';
\echo -n '01 replace_placements が置いた件数を返す: '
select public.replace_placements('78000000-0000-0000-0000-000000000011', '[
  {"artwork_id":"78000000-0000-0000-0000-0000000000c1","slot_index":0,"frame_override":"oak"},
  {"artwork_id":"78000000-0000-0000-0000-0000000000c2","slot_index":4},
  {"artwork_id":"78000000-0000-0000-0000-0000000000c3","slot_index":9}
]'::jsonb) = 3;
\echo -n '02 上書きの列が入っている: '
select coalesce((select frame_override='oak' from public.placements
  where gallery_id='78000000-0000-0000-0000-000000000011' and slot_index=0), false);
\echo -n '03 渡していない上書きは null: '
select coalesce((select mat_override is null and light_override is null from public.placements
  where gallery_id='78000000-0000-0000-0000-000000000011' and slot_index=4), false);

\echo '--- 枠を移す（旧経路が一時的に上限+1行になっていた操作） ---'
\echo -n '04 slot 9 → 14 に移して件数は3のまま: '
select public.replace_placements('78000000-0000-0000-0000-000000000011', '[
  {"artwork_id":"78000000-0000-0000-0000-0000000000c1","slot_index":0},
  {"artwork_id":"78000000-0000-0000-0000-0000000000c2","slot_index":4},
  {"artwork_id":"78000000-0000-0000-0000-0000000000c3","slot_index":14}
]'::jsonb) = 3;
\echo -n '05 古い slot 9 は残っていない: '
select not exists (select 1 from public.placements
  where gallery_id='78000000-0000-0000-0000-000000000011' and slot_index=9);

\echo '--- 空にする ---'
\echo -n '06 空配列で全部下りる: '
select public.replace_placements('78000000-0000-0000-0000-000000000011', '[]'::jsonb) = 0;
\echo -n '07 null を渡しても空配列と同じ（例外にしない）: '
select public.replace_placements('78000000-0000-0000-0000-000000000011', null) = 0;

\echo '--- 同意（0037）がそのまま効いているか＝RPCが抜け道になっていないこと ---'
\echo -n '08 招待の無い他人の作品は置けない（RLS違反=42501）: '
select public.__t58_state('78000000-0000-0000-0000-000000000011', '[
  {"artwork_id":"78000000-0000-0000-0000-0000000000c1","slot_index":0},
  {"artwork_id":"78000000-0000-0000-0000-0000000000a1","slot_index":1}
]'::jsonb) = '42501';
\echo -n '09 その失敗で自分の作品も1行も入っていない（原子性）: '
select not exists (select 1 from public.placements where gallery_id='78000000-0000-0000-0000-000000000011');

\echo '--- 同意が揃えば置ける（合同展示: 招待の受諾＋その展示への提出。0047 の形） ---'
-- `room_invites` は 0047 で**撤去**され、同意は合同展示経由になった。
-- 合同展示の部屋（`slots_included=true, work_cap=15`）は購入台帳を数える
-- `enforce_room_allowance` に引っかかるので、0047 のテストと同じく素の権限で入れる。
reset role;
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('78000000-0000-0000-0000-000000000021', '78000000-0000-0000-0000-000000000001', 'joint58', 'Joint 58', 14);
insert into public.galleries (id, owner_id, slug, title, expo_id, slots_included, work_cap) values
  ('78000000-0000-0000-0000-000000000012', '78000000-0000-0000-0000-000000000001', 'jr58', 'Joint room 58',
   '78000000-0000-0000-0000-000000000021', true, 15);
insert into public.expo_invites (expo_id, artist_id, status) values
  ('78000000-0000-0000-0000-000000000021', '78000000-0000-0000-0000-000000000002', 'accepted');
insert into public.expo_submissions (expo_id, artwork_id) values
  ('78000000-0000-0000-0000-000000000021', '78000000-0000-0000-0000-0000000000a1');
set local role authenticated;
set local "request.jwt.claim.sub" = '78000000-0000-0000-0000-000000000001';
\echo -n '10 受諾＋提出が揃った他作家の作品は合同展示の部屋に置ける: '
select public.replace_placements('78000000-0000-0000-0000-000000000012', '[
  {"artwork_id":"78000000-0000-0000-0000-0000000000c1","slot_index":0},
  {"artwork_id":"78000000-0000-0000-0000-0000000000a1","slot_index":1}
]'::jsonb) = 2;
\echo -n '11 同じ作品を主催者の通常の部屋には置けない（部屋の単位で効いている）: '
select public.__t58_state('78000000-0000-0000-0000-000000000011', '[
  {"artwork_id":"78000000-0000-0000-0000-0000000000a1","slot_index":0}
]'::jsonb) = '42501';

\echo '--- 所有者でない人からは触れない ---'
-- 通常の部屋に2点入れ直してから、他人・未ログインが触れないことを見る
select public.replace_placements('78000000-0000-0000-0000-000000000011', '[
  {"artwork_id":"78000000-0000-0000-0000-0000000000c1","slot_index":0},
  {"artwork_id":"78000000-0000-0000-0000-0000000000c2","slot_index":1}
]'::jsonb);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '78000000-0000-0000-0000-000000000003';
\echo -n '12 他人の部屋は空配列でも拒否される（黙って成功しない）: '
select public.__t58_state('78000000-0000-0000-0000-000000000011', '[]'::jsonb) = '42501';
reset role;
\echo -n '13 他人が触ろうとしても2行が生き残っている: '
select (select count(*) from public.placements
  where gallery_id='78000000-0000-0000-0000-000000000011') = 2;

\echo '--- 未ログインからは触れない ---'
set local role anon;
-- `reset role` は JWT のクレームを消さない（LESSONS 2026-08-09）
set local "request.jwt.claim.sub" = '';
\echo -n '14 anon からは拒否される: '
select public.__t58_state('78000000-0000-0000-0000-000000000011', '[]'::jsonb) = '42501';
reset role;
\echo -n '15 anon が触ろうとしても2行が生き残っている: '
select (select count(*) from public.placements
  where gallery_id='78000000-0000-0000-0000-000000000011') = 2;

\echo -n '16 実行権限が public に開いていない: '
select not has_function_privilege('public', 'public.replace_placements(uuid, jsonb)', 'execute');
\echo -n '17 authenticated には開いている: '
select has_function_privilege('authenticated', 'public.replace_placements(uuid, jsonb)', 'execute');
\echo -n '18 service_role には開いていない（auth.uid() が null で必ず落ちるため）: '
select not has_function_privilege('service_role', 'public.replace_placements(uuid, jsonb)', 'execute');
\echo -n '19 anon にも開いていない: '
select not has_function_privilege('anon', 'public.replace_placements(uuid, jsonb)', 'execute');
\echo -n '20 security definer になっていない（RLSを素通りさせない）: '
select not prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='replace_placements';

rollback;
