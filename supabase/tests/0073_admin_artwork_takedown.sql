\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0073 の帯）。
insert into auth.users (id, email) values
  ('73000000-0000-0000-0000-000000000001', 'owner73@example.com'),
  ('73000000-0000-0000-0000-000000000002', 'admin73@example.com'),
  ('73000000-0000-0000-0000-000000000003', 'other73@example.com');
update public.profiles set username='owner73', display_name='Owner 73' where id='73000000-0000-0000-0000-000000000001';
update public.profiles set username='admin73', display_name='Admin 73' where id='73000000-0000-0000-0000-000000000002';
update public.profiles set username='other73', display_name='Other 73' where id='73000000-0000-0000-0000-000000000003';
insert into public.admins (user_id) values ('73000000-0000-0000-0000-000000000002');

insert into public.galleries (id, owner_id, slug, title, work_cap) values
  ('73c00000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'room73', 'Room 73', 5);
insert into public.artworks (id, owner_id, storage_path, width, height, title) values
  ('73a00000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001',
   '73000000-0000-0000-0000-000000000001/73a00000-0000-0000-0000-000000000001', 100, 100, 'Reported work');
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('73c00000-0000-0000-0000-000000000001', '73a00000-0000-0000-0000-000000000001', 0);

\set ON_ERROR_STOP off
begin;

create or replace function public.__t73_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no-error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '73000000-0000-0000-0000-000000000003';

\echo -n '01 非管理者は admin_list_gallery_artworks を呼べない（is_adminガード）: '
select public.__t73_state($q$
  select * from public.admin_list_gallery_artworks('73c00000-0000-0000-0000-000000000001')
$q$) like '%not authorised%';

\echo -n '02 非管理者は admin_takedown_artwork も呼べない: '
select public.__t73_state($q$
  select * from public.admin_takedown_artwork('73a00000-0000-0000-0000-000000000001')
$q$) like '%not authorised%';

\echo -n '02b 非管理者は admin_get_artwork_location も呼べない: '
select public.__t73_state($q$
  select * from public.admin_get_artwork_location('73a00000-0000-0000-0000-000000000001')
$q$) like '%not authorised%';

-- RLS越しだとother73はそもそもこの作品を読めない（非公開の他人の部屋）ので、
-- 「本当に消えていないか」はRLSを外して見る。
reset role;
\echo -n '03 拒否された後も作品は無傷: '
select exists (select 1 from public.artworks where id = '73a00000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claim.sub" = '73000000-0000-0000-0000-000000000002';

\echo -n '04 管理者は部屋の作品一覧を見られる（非公開の部屋でも。0001のartworks_select_in_public_galleryは公開部屋しか通さないため、既存のRLSだけでは見えない）: '
select exists (
  select 1 from public.admin_list_gallery_artworks('73c00000-0000-0000-0000-000000000001')
   where id = '73a00000-0000-0000-0000-000000000001'
);

\echo -n '04b 管理者は admin_get_artwork_location で場所だけ見られる（削除しない）: '
select owner_id::text = '73000000-0000-0000-0000-000000000001'
   and storage_path = '73000000-0000-0000-0000-000000000001/73a00000-0000-0000-0000-000000000001'
  from public.admin_get_artwork_location('73a00000-0000-0000-0000-000000000001');

\echo -n '04c admin_get_artwork_location を呼んだだけでは作品は消えない（R2削除→DB削除の順序が成り立つ前提）: '
select exists (select 1 from public.artworks where id = '73a00000-0000-0000-0000-000000000001');

\echo -n '05 管理者は作品を完全に削除できる（owner_idを返す）: '
select owner_id::text = '73000000-0000-0000-0000-000000000001'
  from public.admin_takedown_artwork('73a00000-0000-0000-0000-000000000001');

\echo -n '06 削除後、作品の行そのものが消えている: '
select not exists (select 1 from public.artworks where id = '73a00000-0000-0000-0000-000000000001');

\echo -n '07 placements も cascade で消えている（部屋には何も残らない）: '
select not exists (select 1 from public.placements where artwork_id = '73a00000-0000-0000-0000-000000000001');

\echo -n '08 存在しないidへのtakedownはエラーにならず、単に0行を返す（後始末で二重に押しても壊れない）: '
select not exists (select 1 from public.admin_takedown_artwork('73a00000-0000-0000-0000-000000000001'));
