\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0068 の帯）。
insert into auth.users (id, email) values
  ('68000000-0000-0000-0000-000000000001', 'owner68@example.com'),
  ('68000000-0000-0000-0000-000000000002', 'other68@example.com');
update public.profiles set username='owner68', display_name='Owner 68' where id='68000000-0000-0000-0000-000000000001';
update public.profiles set username='other68', display_name='Other 68' where id='68000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

-- 拒否の確認を positive なアサーションにする（0059/0061 と同じ作法）。
create or replace function public.__t68_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- 部屋数の番人（enforce_room_allowance・0062）に本題（テーマ/レイアウト）のテストを
-- 邪魔されないよう、先に部屋購入を4つぶん積んでおく（このテストで作る部屋は最大4つ）。
insert into public.purchases (user_id, kind, item_key, sku) values
  ('68000000-0000-0000-0000-000000000001', 'room', 'room68-p1', 'room'),
  ('68000000-0000-0000-0000-000000000001', 'room', 'room68-p2', 'room'),
  ('68000000-0000-0000-0000-000000000001', 'room', 'room68-p3', 'room'),
  ('68000000-0000-0000-0000-000000000001', 'room', 'room68-p4', 'room');

\echo '--- 用意: 無料の部屋（whitecube/corridor）と、購入記録の無い「昔からある」部屋（chic/hall。0068より前からのグランドファザー行を模す） ---'
-- postgres（superuser）のまま挿入するとガードは素通りする（guard_theme_layout_change は
-- current_user が authenticated/anon のときだけ検査するため）。これでガード導入前から
-- 存在する「購入記録の無い有料値」の行を作れる。1文ずつ分ける ── 複数行VALUESの
-- 同一INSERT内では後続行が先行行を見てしまい、部屋数の番人が本題より先に反応する。
insert into public.galleries (id, owner_id, slug, title, work_cap, theme, layout) values
  ('68c00000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001', 'room68-main', 'Main 68', 5, 'whitecube', 'corridor');
insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included, theme, layout) values
  ('68c00000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001', 'room68-legacy', 'Legacy 68', 15, true, 'chic', 'hall');

set local role authenticated;
set local "request.jwt.claim.sub" = '68000000-0000-0000-0000-000000000001';

\echo -n '01 未購入の有料テーマへの変更は拒否される（監査で見つかった脆弱性そのもの）: '
select public.__t68_state($q$
  update public.galleries set theme='noir' where id='68c00000-0000-0000-0000-000000000001'
$q$) like '23514%';

\echo -n '02 未購入の有料レイアウトへの変更は拒否される: '
select public.__t68_state($q$
  update public.galleries set layout='portrait' where id='68c00000-0000-0000-0000-000000000001'
$q$) like '23514%';

\echo -n '03 拒否された後も、実際の値は変わっていない: '
select (select theme from public.galleries where id='68c00000-0000-0000-0000-000000000001') = 'whitecube'
   and (select layout from public.galleries where id='68c00000-0000-0000-0000-000000000001') = 'corridor';

\echo -n '04 forever-free の値への変更は常に許可される: '
select public.__t68_state($q$
  update public.galleries set theme='whitecube', layout='corridor' where id='68c00000-0000-0000-0000-000000000001'
$q$) = 'no-error';

\echo -n '05 無関係の列（title）だけの更新は、既存の未購入テーマ(chic/hall)を巻き添えにしない（グランドファザー行を壊さない）: '
select public.__t68_state($q$
  update public.galleries set title='Legacy 68 renamed' where id='68c00000-0000-0000-0000-000000000002'
$q$) = 'no-error';

\echo -n '05b 【別視点レビューで発見】未購入の値をUPDATEで他の部屋へ複製できない（legacy68のchicをmain68へ複製しようとする）: '
select public.__t68_state($q$
  update public.galleries set theme='chic' where id='68c00000-0000-0000-0000-000000000001'
$q$) like '23514%';

\echo -n '05c 同じく layout(hall) の複製もUPDATEでは拒否される: '
select public.__t68_state($q$
  update public.galleries set layout='hall' where id='68c00000-0000-0000-0000-000000000001'
$q$) like '23514%';

\echo '--- 購入すると解禁される ---'
-- purchases には insert ポリシーが無い（webhookのservice roleだけが書ける想定）ので、
-- fixtureの書き込みは一旦 authenticated を抜けて行う。
reset role;
insert into public.purchases (user_id, kind, item_key, sku) values
  ('68000000-0000-0000-0000-000000000001', 'theme', 'noir', 'single_item');
set local role authenticated;
set local "request.jwt.claim.sub" = '68000000-0000-0000-0000-000000000001';
\echo -n '06 テーマを購入すると、そのテーマへの変更が通る: '
select public.__t68_state($q$
  update public.galleries set theme='noir' where id='68c00000-0000-0000-0000-000000000001'
$q$) = 'no-error';
\echo -n '07 実際に noir へ変わっている: '
select (select theme from public.galleries where id='68c00000-0000-0000-0000-000000000001') = 'noir';

\echo '--- 2室目は口座内に既にある値をコピーできる（新たな解禁ではないため・ユーザー決定 2026-08-09） ---'
\echo -n '08 購入していない layout(hall) でも、口座内の別の部屋(legacy68)に既にあれば新規作成できる: '
select public.__t68_state($q$
  insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included, theme, layout) values
    ('68c00000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000001', 'room68-copy', 'Copy 68', 5, true, 'noir', 'hall')
$q$) = 'no-error';

\echo -n '09 口座のどこにも無く購入もしていない値では、新規作成できない: '
select public.__t68_state($q$
  insert into public.galleries (id, owner_id, slug, title, work_cap, slots_included, theme, layout) values
    ('68c00000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000001', 'room68-deny', 'Deny 68', 5, true, 'chic', 'island')
$q$) like '23514%';

\echo -n '10 別ユーザーには、この口座が買った/使っているテーマは無関係（自分の口座に無ければ依然拒否される）: '
set local role authenticated;
set local "request.jwt.claim.sub" = '68000000-0000-0000-0000-000000000002';
select public.__t68_state($q$
  insert into public.galleries (id, owner_id, slug, title, work_cap, theme, layout) values
    ('68c00000-0000-0000-0000-000000000005', '68000000-0000-0000-0000-000000000002', 'room68-other', 'Other 68', 5, 'noir', 'corridor')
$q$) like '23514%';

\echo -n '11 未ログイン(anon)からも同じく拒否される: '
set local role anon;
set local "request.jwt.claim.sub" = '';
select public.__t68_state($q$
  insert into public.galleries (id, owner_id, slug, title, work_cap, theme, layout) values
    ('68c00000-0000-0000-0000-000000000006', '68000000-0000-0000-0000-000000000002', 'room68-anon', 'Anon 68', 5, 'noir', 'corridor')
$q$) is not null; -- RLSのwith check(owner一致)かガードのどちらかで必ず落ちる
