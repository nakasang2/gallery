\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。reports は auth.users を参照しないので利用者は要らない。
-- 「誰でも通報できる（未ログインの来場者を含む）」ことが要件なので anon で流す。

\set ON_ERROR_STOP off
begin;

-- 拒否の確認は**positive なアサーション**にする（DECISIONS 2026-08-13 の決定1）。
-- 理由の全文は 0044_expos の同じ関数のコメント。psql の変数はドル引用符の中では
-- 展開されないので、使う場合は `|| quote_literal(:'x') ||` で外へ出す（0048 参照）。
create or replace function public.__t0056_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate;
end $$;

\echo '--- 既存の経路（種別なし）は壊れていない ---'
set local role anon;
insert into public.reports (about, reason) values ('@someone/show', '嫌がらせを受けています');
reset role;
\echo -n '01 anonが従来の形で通報できる: '
select coalesce(bool_and(kind = 'other' and not sworn), false)
  from public.reports where about='@someone/show';

\echo '--- 著作権以外は宣誓を要求しない ---'
set local role anon;
insert into public.reports (about, reason, kind) values ('@x/harass', 'ひどい言葉が書かれています', 'harassment');
insert into public.reports (about, reason, kind) values ('@x/illegal', '違法な内容です', 'illegal');
reset role;
\echo -n '02 harassment は宣誓なしで通る: '
select coalesce(bool_and(kind='harassment'), false) from public.reports where about='@x/harass';
\echo -n '03 illegal は宣誓なしで通る: '
select coalesce(bool_and(kind='illegal'), false) from public.reports where about='@x/illegal';

\echo '--- 著作権は法定要件が揃っていないと拒否される（§512(c)(3)） ---'
set local role anon;
savepoint s4;
\echo -n '04 宣誓なしの著作権通報は拒否される（ERRORが出るのが正しい）: '
select public.__t0056_state($q$insert into public.reports (about, reason, kind, claimant, work_identified)
  values ('@x/copy1', '私の絵が使われています', 'copyright', 'Yamada Taro', 'My painting "Blue"');$q$) = '23514';
rollback to s4;
savepoint s5;
\echo -n '05 申立人の氏名が空の著作権通報は拒否される: '
select public.__t0056_state($q$insert into public.reports (about, reason, kind, claimant, work_identified, sworn)
  values ('@x/copy2', '私の絵が使われています', 'copyright', '', 'My painting "Blue"', true);$q$) = '23514';
rollback to s5;
savepoint s6;
\echo -n '06 著作物の特定が空の著作権通報は拒否される: '
select public.__t0056_state($q$insert into public.reports (about, reason, kind, claimant, work_identified, sworn)
  values ('@x/copy3', '私の絵が使われています', 'copyright', 'Yamada Taro', '', true);$q$) = '23514';
rollback to s6;
\echo '--- 揃っていれば通る ---'
insert into public.reports (about, reason, kind, claimant, work_identified, sworn)
  values ('@x/copy4', '私の絵が使われています', 'copyright', 'Yamada Taro', 'My painting "Blue"', true);
reset role;
\echo -n '07 4要件が揃った著作権通報は通る: '
select coalesce(bool_and(kind='copyright' and sworn and claimant='Yamada Taro'), false)
  from public.reports where about='@x/copy4';

\echo '--- 種別の許可リスト ---'
set local role anon;
savepoint s8;
\echo -n '08 知らない種別は拒否される: '
select public.__t0056_state($q$insert into public.reports (about, reason, kind) values ('@x/bogus', 'test', 'whatever');$q$) = '23514';
rollback to s8;
reset role;

\echo '--- 通報の中身は来場者から読めない（申立人の氏名・連絡先は個人情報） ---'
set local role anon;
\echo -n '09 anonはreportsを読めない（0行）: '
select coalesce(count(*) = 0, false) from public.reports;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
\echo -n '10 authenticatedもreportsを読めない（0行）: '
select coalesce(count(*) = 0, false) from public.reports;
reset role;

rollback;
