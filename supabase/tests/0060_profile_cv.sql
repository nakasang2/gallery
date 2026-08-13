\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0060 の帯）。
insert into auth.users (id, email) values
  ('60000000-0000-0000-0000-000000000001', 'cv60a@example.com'),
  ('60000000-0000-0000-0000-000000000002', 'cv60b@example.com');

\set ON_ERROR_STOP off
begin;

\echo '--- 1. 列がある・型が text・not null・既定は空文字 ---'
select '1a ' || case when count(*) = 1 then 'OK' else 'NG' end
  from information_schema.columns
 where table_schema='public' and table_name='profiles' and column_name='cv';
select '1b ' || case when data_type = 'text' then 'OK' else 'NG(' || data_type || ')' end
  from information_schema.columns
 where table_schema='public' and table_name='profiles' and column_name='cv';
select '1c ' || case when is_nullable = 'NO' then 'OK' else 'NG' end
  from information_schema.columns
 where table_schema='public' and table_name='profiles' and column_name='cv';

\echo '--- 2. 既存行（トリガで作られたプロフィール）は空文字で埋まっている＝null にならない ---'
select '2 ' || case when cv = '' then 'OK' else 'NG(' || coalesce(cv, '<null>') || ')' end
  from public.profiles where id='60000000-0000-0000-0000-000000000001';

\echo '--- 3. 本人は自分の来歴を更新できる（0002 の profiles_self_update がそのまま効く） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000001';
update public.profiles set cv = '2024 個展（東京）' where id='60000000-0000-0000-0000-000000000001';
select '3 ' || case when cv = '2024 個展（東京）' then 'OK' else 'NG' end
  from public.profiles where id='60000000-0000-0000-0000-000000000001';
reset role;

\echo '--- 4. 他人の来歴は書き換えられない（RLS） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000002';
update public.profiles set cv = '乗っ取り' where id='60000000-0000-0000-0000-000000000001';
reset role;
select '4 ' || case when cv = '2024 個展（東京）' then 'OK' else 'NG(書き換えられた)' end
  from public.profiles where id='60000000-0000-0000-0000-000000000001';

\echo '--- 5. 公開の読み取りで来歴が見える（来場者が情報パネルで読む経路） ---'
set local role anon;
select '5 ' || case when count(*) = 1 then 'OK' else 'NG' end
  from public.profiles where id='60000000-0000-0000-0000-000000000001' and cv <> '';
reset role;

\echo '--- 6. null を入れようとしたら弾かれる（not null） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000001';
savepoint s6;
update public.profiles set cv = null where id='60000000-0000-0000-0000-000000000001';
rollback to savepoint s6;
reset role;
select '6 ' || case when cv = '2024 個展（東京）' then 'OK' else 'NG' end
  from public.profiles where id='60000000-0000-0000-0000-000000000001';

rollback;
