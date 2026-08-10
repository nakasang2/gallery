\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0051 の帯）。
insert into auth.users (id, email) values
  ('66000000-0000-0000-0000-000000000001', 'host51@example.com'),
  ('66000000-0000-0000-0000-000000000002', 'other51@example.com');
update public.profiles set username='host51',  display_name='Host 51'  where id='66000000-0000-0000-0000-000000000001';
update public.profiles set username='other51', display_name='Other 51' where id='66000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

\echo '--- 用意: 展示3つ（未来予約用・即時用・過去指定用） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '66000000-0000-0000-0000-000000000001';
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('66000000-0000-0000-0000-000000000011', '66000000-0000-0000-0000-000000000001', 'future51', 'Future 51', 14);
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('66000000-0000-0000-0000-000000000012', '66000000-0000-0000-0000-000000000001', 'immediate51', 'Immediate 51', 14);
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('66000000-0000-0000-0000-000000000013', '66000000-0000-0000-0000-000000000001', 'past51', 'Past 51', 14);
reset role;

\echo '--- 未来の日時を指定：その時刻まで見えていない ---'
select public.record_expo_purchase(
  'sess51-future', '66000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000011',
  14, 2500, 'usd', now() + interval '10 days');
\echo -n '01 starts_atは指定した未来の日時になる: '
select coalesce(bool_and(starts_at > now() + interval '9 days'), false)
  from public.expos where id='66000000-0000-0000-0000-000000000011';
\echo -n '02 まだ会期前なのでexpo_is_liveはfalse: '
select coalesce(bool_and(not public.expo_is_live(starts_at, ends_at)), true)
  from public.expos where id='66000000-0000-0000-0000-000000000011';
\echo -n '03 ends_atはstarts_at+14日として導出される: '
select coalesce(bool_and(ends_at = starts_at + interval '14 days'), false)
  from public.expos where id='66000000-0000-0000-0000-000000000011';

\echo '--- 日時を省略：従来どおり即時公開 ---'
select public.record_expo_purchase(
  'sess51-immediate', '66000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000012',
  14, 2500, 'usd');
\echo -n '04 starts_atはほぼ今: '
select coalesce(bool_and(starts_at <= now() and starts_at > now() - interval '1 minute'), false)
  from public.expos where id='66000000-0000-0000-0000-000000000012';
\echo -n '05 いま会期中なのでexpo_is_liveはtrue: '
select coalesce(bool_and(public.expo_is_live(starts_at, ends_at)), false)
  from public.expos where id='66000000-0000-0000-0000-000000000012';

\echo '--- 過去の日時を指定：clampせず、その時点で即時公開扱いになる ---'
select public.record_expo_purchase(
  'sess51-past', '66000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000013',
  14, 2500, 'usd', now() - interval '1 day');
\echo -n '06 starts_atは指定した過去の日時のまま（clampされない）: '
select coalesce(bool_and(starts_at < now() and starts_at > now() - interval '2 days'), false)
  from public.expos where id='66000000-0000-0000-0000-000000000013';
\echo -n '07 既に始まっているのでexpo_is_liveはtrue: '
select coalesce(bool_and(public.expo_is_live(starts_at, ends_at)), false)
  from public.expos where id='66000000-0000-0000-0000-000000000013';

\echo '--- webhookの再送で2回入らない（0019/0031と同じ作法） ---'
select public.record_expo_purchase(
  'sess51-future', '66000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000011',
  30, 4000, 'usd', now() + interval '1 day');
\echo -n '08 同じセッションidの再送では会期の長さも変わらない: '
select coalesce(bool_and(duration_days = 14), false)
  from public.expos where id='66000000-0000-0000-0000-000000000011';

\echo '--- 2つのチェックアウトを並行して開いた競合状態（別セッションid・同じ展示）でもクラッシュしない ---'
select public.record_expo_purchase(
  'sess51-immediate-race', '66000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000012',
  30, 4000, 'usd');
\echo -n '09 別セッションidでも2件目は黙って抜ける（会期の長さは1件目のまま）: '
select coalesce(bool_and(duration_days = 14), false)
  from public.expos where id='66000000-0000-0000-0000-000000000012';
\echo -n '10 台帳もこの展示につき1行のまま（一意制約に落ちてクラッシュしない）: '
select count(*) = 1
  from public.purchases where kind='expo' and item_key='66000000-0000-0000-0000-000000000012';

\echo '--- 公開後は本人にも starts_at を書かせない（0044のガードは維持） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '66000000-0000-0000-0000-000000000001';
savepoint e;
\echo -n '11 支払い後、本人がstarts_atを書き換えようとすると拒否される → '
-- **`now()` はトランザクション内で固定される**ので、直前の record_expo_purchase が
-- 使った値と同じになり「変わっていない」と誤判定しかねない。区別できる値にする。
update public.expos set starts_at = now() + interval '1 hour' where id='66000000-0000-0000-0000-000000000012';
rollback to e; release e;
reset role;

\echo '--- 他人の展示には支払えない ---'
savepoint e;
\echo -n '12 他人の展示idでは拒否される → '
select public.record_expo_purchase(
  'sess51-other', '66000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000011',
  14, 2500, 'usd', now() + interval '1 day');
rollback to e; release e;

\echo '--- 6引数（p_starts_at省略）の呼び方も引き続き使える（既定値で解決） ---'
select public.record_expo_purchase(
  'sess51-legacy-call', '66000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000012',
  14, 2500, 'usd');
\echo -n '13 6引数で呼んでも解決される（この展示は既に始まっているので何も起きない）: '
select coalesce(bool_and(duration_days = 14), false)
  from public.expos where id='66000000-0000-0000-0000-000000000012';

rollback;
