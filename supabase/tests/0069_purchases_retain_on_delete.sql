\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0069 の帯）。
insert into auth.users (id, email) values
  ('69000000-0000-0000-0000-000000000001', 'owner69@example.com');
update public.profiles set username='owner69', display_name='Owner 69' where id='69000000-0000-0000-0000-000000000001';

\set ON_ERROR_STOP off
begin;

create or replace function public.__t69_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

\echo '--- 用意: 決済済みの購入記録を1件持つアカウント ---'
insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency) values
  ('69000000-0000-0000-0000-000000000001', 'video_pass', '', 'video_pass', 2000, 'usd');

\echo -n '01 削除前: 購入記録は本人の user_id で持てている: '
select exists (
  select 1 from public.purchases
   where user_id = '69000000-0000-0000-0000-000000000001' and kind = 'video_pass'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '69000000-0000-0000-0000-000000000001';
\echo -n '02 本人はアカウント削除RPCを呼べる（no-error）: '
select public.__t69_state($q$ select public.delete_my_account() $q$) = 'no-error';

reset role;
\echo -n '03 auth.users の本人行は実際に消えている: '
select not exists (select 1 from auth.users where id = '69000000-0000-0000-0000-000000000001');

\echo -n '04 purchases の行は cascade で消えず、金額・SKUも残っている（法務ポリシーどおり保持）: '
select exists (
  select 1 from public.purchases
   where user_id is null and kind = 'video_pass' and sku = 'video_pass' and amount_jpy = 2000 and currency = 'usd'
);

\echo -n '05 匿名化された行は、削除前の本人のセッションを装っても読めない（NULLはどのauth.uid()とも一致しない・read own purchases）: '
set local role authenticated;
set local "request.jwt.claim.sub" = '69000000-0000-0000-0000-000000000001';
select not exists (
  select 1 from public.purchases where kind = 'video_pass' and sku = 'video_pass'
);
