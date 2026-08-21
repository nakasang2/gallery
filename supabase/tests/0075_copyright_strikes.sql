\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0075 の帯）。
insert into auth.users (id, email) values
  ('75000000-0000-0000-0000-000000000001', 'infringer75@example.com'),
  ('75000000-0000-0000-0000-000000000002', 'admin75@example.com'),
  ('75000000-0000-0000-0000-000000000003', 'other75@example.com');
update public.profiles set username='infringer75', display_name='Infringer 75' where id='75000000-0000-0000-0000-000000000001';
update public.profiles set username='admin75', display_name='Admin 75' where id='75000000-0000-0000-0000-000000000002';
update public.profiles set username='other75', display_name='Other 75' where id='75000000-0000-0000-0000-000000000003';
insert into public.admins (user_id) values ('75000000-0000-0000-0000-000000000002');

\set ON_ERROR_STOP off
begin;

create or replace function public.__t75_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '75000000-0000-0000-0000-000000000003';

\echo -n '01 非管理者は admin_record_copyright_strike を呼べない（is_adminガード）: '
select public.__t75_state($q$
  select public.admin_record_copyright_strike(
    '75000000-0000-0000-0000-000000000001', '75a00000-0000-0000-0000-000000000001', 'Some work')
$q$) like '%not authorised%';

-- 仕込みはechoの前に置く（判定器はechoの直後の1文しか見ない）。
-- **user_id は infringer75（001）以外にする** ── 05 で「001の件数=2」を数えるとき、
-- ここで001の行を1つ仕込んでしまうと母数がずれて期待外れになる（実際に踏んだ）。
reset role;
insert into public.copyright_strikes (user_id, artwork_id, artwork_title) values
  ('75000000-0000-0000-0000-000000000003', '75a00000-0000-0000-0000-000000000009', 'Seed row');
set local role authenticated;
set local "request.jwt.claim.sub" = '75000000-0000-0000-0000-000000000003';

\echo -n '02 非管理者は copyright_strikes を読めない（selectポリシーが無い）: '
select not exists (select 1 from public.copyright_strikes where artwork_id = '75a00000-0000-0000-0000-000000000009');

set local role authenticated;
set local "request.jwt.claim.sub" = '75000000-0000-0000-0000-000000000002';

\echo -n '03 管理者は admin_record_copyright_strike を呼べる: '
select public.__t75_state($q$
  select public.admin_record_copyright_strike(
    '75000000-0000-0000-0000-000000000001', '75a00000-0000-0000-0000-000000000001', 'Infringing work')
$q$) = 'no-error';

\echo -n '04 記録した行が実際に入っている（誰の・どの作品の・何というタイトルか）: '
select user_id::text = '75000000-0000-0000-0000-000000000001'
   and artwork_id::text = '75a00000-0000-0000-0000-000000000001'
   and artwork_title = 'Infringing work'
  from public.copyright_strikes
 where artwork_id = '75a00000-0000-0000-0000-000000000001';

-- **側作用のある関数呼び出しと、それに依存するサブクエリを同じ AND 式に並べない。**
-- Postgres は同じ SELECT のターゲットリスト内での評価順を保証しないため、
-- サブクエリ側が INSERT より先に評価されて「まだ無い行」を読み、結果全体が
-- （t/f どちらでもなく）NULL に落ちて「何も検査していない」扱いになる
-- （実際に踏んだ。挿入とその後の確認は別の文に分ける）。
select public.__t75_state($q$
  select public.admin_record_copyright_strike(
    '75000000-0000-0000-0000-000000000001', '75a00000-0000-0000-0000-000000000002', 'Second strike')
$q$) as r05;

\echo -n '05 2回目の取り下げも別行として積み重なり、管理者は件数を数えられる（反復侵害の判断材料）: '
select (select count(*) from public.copyright_strikes where user_id = '75000000-0000-0000-0000-000000000001') = 2;

select public.__t75_state($q$
  select public.admin_record_copyright_strike(
    '75000000-0000-0000-0000-000000000001', '75a00000-0000-0000-0000-000000000003', null)
$q$) as r06;

\echo -n '06 タイトルが無くても記録できる（作品が既に消えたあとの経路。NULLは空文字に落ちる）: '
select (select artwork_title from public.copyright_strikes where artwork_id = '75a00000-0000-0000-0000-000000000003') = '';

-- 仕込みはechoの前に置く。
reset role;
delete from auth.users where id = '75000000-0000-0000-0000-000000000001';

\echo -n '07 対象ユーザーが削除されると記録も一緒に消える（この記録は個人の法的な履歴なので、0069のpurchasesの匿名化保持とは違いcascadeでよい）: '
select not exists (select 1 from public.copyright_strikes where user_id = '75000000-0000-0000-0000-000000000001');
