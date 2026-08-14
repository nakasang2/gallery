\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0063 の帯）。
insert into auth.users (id, email) values
  ('63000000-0000-0000-0000-000000000001', 'host63@example.com'),
  ('63000000-0000-0000-0000-000000000002', 'artist63@example.com');
update public.profiles set username='host63',   display_name='Host 63'   where id='63000000-0000-0000-0000-000000000001';
update public.profiles set username='artist63', display_name='Artist 63' where id='63000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

-- 例外を捕まえて SQLSTATE を返す（0061/0062 の `__t6x_state` と同じ作法）。
create or replace function public.__t63_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

\echo '--- 用意: 主催者(host63)が展示を作り、artist63 を招いて承諾させる ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000001';
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('63e00000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', 'expo63', 'Expo 63', 14);
-- 主催者自身の部屋（1展示・1作家1部屋なので主催者も1つ持てる）
insert into public.galleries (id, owner_id, expo_id, slug, title, work_cap, slots_included) values
  ('63c00000-0000-0000-0000-000000000009', '63000000-0000-0000-0000-000000000001',
   '63e00000-0000-0000-0000-000000000001', 'expo-63-host', 'Host room 63', 15, true);
-- 主催者は通常展示の部屋も1つ持つ（「唯一の部屋は合同展示に持っていけない」の番人に
-- 掛からないように、かつ「展示から外す」先が無い状態を作らないため）
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included) values
  ('63c00000-0000-0000-0000-000000000008', '63000000-0000-0000-0000-000000000001',
   'main63h', 'Host normal 63', 5, false);
insert into public.expo_invites (id, expo_id, artist_id, status) values
  ('63f00000-0000-0000-0000-000000000002', '63e00000-0000-0000-0000-000000000001',
   '63000000-0000-0000-0000-000000000002', 'pending');

set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000002';
update public.expo_invites set status='accepted' where id='63f00000-0000-0000-0000-000000000002';

\echo -n '01 承諾で artist63 の部屋が自動生成されている（0062 の回帰確認）: '
select count(*)=1 from public.galleries
  where expo_id='63e00000-0000-0000-0000-000000000001'
    and owner_id='63000000-0000-0000-0000-000000000002';

/* ========== 1. 参加作家は「通常展示に戻す」で展示から抜けられない（本題） ========== */

\echo -n '02 参加作家が自分の合同展示の部屋を通常展示に戻そうとすると拒否される（23514）: '
select public.__t63_state($$select public.switch_room_expo(
  (select id from public.galleries where expo_id='63e00000-0000-0000-0000-000000000001'
     and owner_id='63000000-0000-0000-0000-000000000002'), null)$$) = '23514';

\echo -n '03 拒否されたあとも、その部屋は展示に残っている（0063以前はここで消えていた）: '
reset role;
select count(*)=1 from public.galleries
  where expo_id='63e00000-0000-0000-0000-000000000001'
    and owner_id='63000000-0000-0000-0000-000000000002';

\echo -n '04 招待も accepted のまま（状態が食い違っていない）: '
select coalesce(bool_and(status='accepted'), false) from public.expo_invites
  where id='63f00000-0000-0000-0000-000000000002';

/* ========== 2. 降りる道は残っている（受信箱の「降りる」＝辞退） ========== */

set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000002';
update public.expo_invites set status='declined' where id='63f00000-0000-0000-0000-000000000002';

\echo -n '05 辞退すれば、これまでどおり部屋も一緒に片付く（降りる道は塞いでいない）: '
reset role;
select count(*)=0 from public.galleries
  where expo_id='63e00000-0000-0000-0000-000000000001'
    and owner_id='63000000-0000-0000-0000-000000000002';

\echo -n '06 招き直して承諾すれば、また部屋ができる（復旧できる）: '
set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000002';
update public.expo_invites set status='accepted' where id='63f00000-0000-0000-0000-000000000002';
reset role;
select count(*)=1 from public.galleries
  where expo_id='63e00000-0000-0000-0000-000000000001'
    and owner_id='63000000-0000-0000-0000-000000000002';

/* ========== 3. 主催者には残す（自分の展示から自分の部屋を外せる） ========== */
-- **部屋枠の購入を先に積む。** 展示から外した部屋は「通常展示の部屋」になるので、
-- 0038/0050 の部屋枠の番人に通る必要がある（主催者は既に無料枠を1室使っている）。
-- 積まずに外そうとすると `no unused room purchase` で落ちる ── これは 0063 の番人では
-- なく元からの正しい挙動で、一度この土台を作らずに書いて誤って「0063が壊した」と
-- 読みかけた。
reset role;
insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency) values
  ('63000000-0000-0000-0000-000000000001', 'room', 'sku63-1', 'sku63-1', 2500, 'usd');

set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000001';

\echo -n '07 主催者は自分の部屋を展示から外せる（no-error）: '
select public.__t63_state($$select public.switch_room_expo(
  '63c00000-0000-0000-0000-000000000009', null)$$) = 'no-error';

\echo -n '08 外した部屋は通常展示になっている: '
reset role;
select coalesce(bool_and(expo_id is null), false) from public.galleries
  where id='63c00000-0000-0000-0000-000000000009';

\echo -n '09 主催者が外しても、参加作家の部屋は展示に残る（巻き添えにしない）: '
select count(*)=1 from public.galleries
  where expo_id='63e00000-0000-0000-0000-000000000001'
    and owner_id='63000000-0000-0000-0000-000000000002';

/* ========== 4. 入る向きは今までどおり（0062 の回帰確認） ========== */

set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000001';

\echo -n '10 主催者は外した部屋を自分の展示へ戻せる（入る向きは塞いでいない）: '
select public.__t63_state($$select public.switch_room_expo(
  '63c00000-0000-0000-0000-000000000009', '63e00000-0000-0000-0000-000000000001')$$) = 'no-error';

\echo -n '11 戻した部屋は合同展示の設定（slots_included・work_cap=15）に戻っている: '
reset role;
select coalesce(bool_and(expo_id='63e00000-0000-0000-0000-000000000001'
                         and slots_included and work_cap=15), false)
  from public.galleries where id='63c00000-0000-0000-0000-000000000009';

\echo -n '12 他人の部屋には相変わらず触れない（not your room・P0001）: '
set local role authenticated;
set local "request.jwt.claim.sub" = '63000000-0000-0000-0000-000000000002';
select public.__t63_state($$select public.switch_room_expo(
  '63c00000-0000-0000-0000-000000000009', null)$$) = 'P0001';

\echo -n '13 未ログインからは呼べない（実行権限が無い・42501）: '
set local role anon;
set local "request.jwt.claim.sub" = '';
select public.__t63_state($$select public.switch_room_expo(
  '63c00000-0000-0000-0000-000000000009', null)$$) = '42501';

rollback;
