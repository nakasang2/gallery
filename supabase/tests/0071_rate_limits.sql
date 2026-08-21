\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

\set ON_ERROR_STOP off
begin;

\echo -n '01 上限内(1回目/max3)は許可される: '
select public.check_rate_limit('t71_bucket', 't71_key_a', 3, 3600) = true;

\echo -n '02 上限内(2回目/max3)も許可される: '
select public.check_rate_limit('t71_bucket', 't71_key_a', 3, 3600) = true;

\echo -n '03 上限内(3回目/max3)も許可される: '
select public.check_rate_limit('t71_bucket', 't71_key_a', 3, 3600) = true;

\echo -n '04 上限を超えた4回目は拒否される: '
select public.check_rate_limit('t71_bucket', 't71_key_a', 3, 3600) = false;

\echo -n '05 別のkeyは独立して数えられる（同じ窓でも他人の通報数に巻き込まれない）: '
select public.check_rate_limit('t71_bucket', 't71_key_b', 3, 3600) = true;

\echo -n '06 別のbucketも独立して数えられる（reportの流量がuploadの上限を消費しない）: '
select public.check_rate_limit('t71_other_bucket', 't71_key_a', 3, 3600) = true;

\echo -n '07 authenticatedロールからも呼べる（/api/upload-urlがauth.dbで呼ぶ経路）: '
set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
select public.check_rate_limit('t71_bucket', 't71_key_c', 3, 3600) = true;

reset role;
\echo -n '08 このカウンタ表は直接readできない（RLS有効・ポリシー無し。anonから）: '
set local role anon;
select not exists (select 1 from public.rate_limit_counters limit 1);
