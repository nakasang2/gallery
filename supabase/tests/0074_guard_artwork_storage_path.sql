\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0074 の帯）。
insert into auth.users (id, email) values
  ('74000000-0000-0000-0000-000000000001', 'owner74@example.com'),
  ('74000000-0000-0000-0000-000000000002', 'other74@example.com');
update public.profiles set username='owner74', display_name='Owner 74' where id='74000000-0000-0000-0000-000000000001';
update public.profiles set username='other74', display_name='Other 74' where id='74000000-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
begin;

create or replace function public.__t74_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '74000000-0000-0000-0000-000000000001';

\echo -n '01 正しい形（{owner_id}/{id}）のstorage_pathでは作品を作れる（アプリの唯一の書き込み経路）: '
select public.__t74_state($q$
  insert into public.artworks (id, owner_id, storage_path, width, height, title) values
    ('74a00000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001',
     '74000000-0000-0000-0000-000000000001/74a00000-0000-0000-0000-000000000001', 100, 100, 'Legit')
$q$) = 'no-error';

\echo -n '02 他人のフォルダを名乗るstorage_pathでは作れない（監査で見つかった脆弱性そのもの・なりすまし帰属）: '
select public.__t74_state($q$
  insert into public.artworks (id, owner_id, storage_path, width, height, title) values
    ('74a00000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000001',
     '74000000-0000-0000-0000-000000000002/some-other-id', 100, 100, 'Spoofed')
$q$) like '23514%';

\echo -n '03 自分のuidだが自分のidではないフォルダも同じく拒否される（id違い）: '
select public.__t74_state($q$
  insert into public.artworks (id, owner_id, storage_path, width, height, title) values
    ('74a00000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000001',
     '74000000-0000-0000-0000-000000000001/not-my-id', 100, 100, 'Wrong id')
$q$) like '23514%';

\echo -n '04 拒否された行は実際に存在しない: '
select not exists (select 1 from public.artworks where id = '74a00000-0000-0000-0000-000000000002');

\echo -n '05 UPDATEで既存の正しいstorage_pathを他人のフォルダへ書き換えることもできない: '
select public.__t74_state($q$
  update public.artworks set storage_path = '74000000-0000-0000-0000-000000000002/hijack'
   where id = '74a00000-0000-0000-0000-000000000001'
$q$) like '23514%';

\echo -n '06 無関係の列（title）だけの更新は素通りする（既存の正しい行を巻き添えにしない）: '
select public.__t74_state($q$
  update public.artworks set title = 'Renamed' where id = '74a00000-0000-0000-0000-000000000001'
$q$) = 'no-error';

-- **`is not null` はここでは常に真になる罠**（`__t74_state` は成功時も
-- 'no-error' という非nullの文字列を返す）。RLS拒否のSQLSTATE（42501）そのものを
-- 突き合わせる（別視点レビューで発見・2026-08-21。0072と同じ穴）。
\echo -n '07 未ログイン(anon)からの直接insertも拒否される（storage_pathの形は正しいので、これはガードではなくRLSのwith checkで落ちる）: '
set local role anon;
set local "request.jwt.claim.sub" = '';
select public.__t74_state($q$
  insert into public.artworks (id, owner_id, storage_path, width, height, title) values
    ('74a00000-0000-0000-0000-000000000004', '74000000-0000-0000-0000-000000000002',
     '74000000-0000-0000-0000-000000000002/74a00000-0000-0000-0000-000000000004', 100, 100, 'Anon')
$q$) like '42501%';

\echo -n '08 拒否された行は実際に入っていない: '
select not exists (select 1 from public.artworks where id = '74a00000-0000-0000-0000-000000000004');
