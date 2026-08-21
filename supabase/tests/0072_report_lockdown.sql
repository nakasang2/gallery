\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

\set ON_ERROR_STOP off
begin;

create or replace function public.__t72_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- **`is not null` はここでは常に真になる罠**（`__t72_state` は成功時も
-- 'no-error' という非nullの文字列を返す）。RLS拒否のSQLSTATE（42501）そのものを
-- 突き合わせる（別視点レビューで発見・2026-08-21。これを直す前は insert が
-- 素通りしていても項目が緑になっていた＝この監査の本題を検査していなかった）。
\echo -n '01 未ログイン(anon)からの直接insertは拒否される（監査#11で見つかったDoSの入口そのもの。0010のwith check(true)が0072で外れている）: '
set local role anon;
set local "request.jwt.claim.sub" = '';
select public.__t72_state($q$
  insert into public.reports (about, reason, contact) values ('spam', 'flood', '')
$q$) like '42501%';

\echo -n '01b 拒否された行は実際に入っていない: '
select not exists (select 1 from public.reports where about = 'spam');

\echo -n '02 サインイン済み(authenticated)からの直接insertも同じく拒否される（サーバー経路化=/api/reportを必ず通す）: '
set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
select public.__t72_state($q$
  insert into public.reports (about, reason, contact) values ('spam', 'flood', '')
$q$) like '42501%';

reset role;
\echo -n '03 service_role（/api/reportが使う）だけは引き続き書ける（RLSをバイパスする既定の役割）: '
set local role service_role;
select public.__t72_state($q$
  insert into public.reports (about, reason, contact) values ('legit', 'a real notice', 'someone@example.com')
$q$) = 'no-error';

reset role;
\echo -n '04 直接insertを拒否しても、admin向けのselectポリシー(0017)は無傷（読み取りの権限は変えていない）: '
select exists (
  select 1 from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_select_admin'
);
