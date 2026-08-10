\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯。土台は 0036/0038 の番人に通る形で作る。
insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-000000000091', 'host45@example.com'),
  ('92000000-0000-0000-0000-000000000092', 'guest45@example.com');
update public.profiles set username='host45',  display_name='Host 45'  where id='91000000-0000-0000-0000-000000000091';
update public.profiles set username='guest45', display_name='Guest 45' where id='92000000-0000-0000-0000-000000000092';

-- 主催者の**通常の**部屋（公開）と、そこに掛けた自分の作品
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap) values
  ('9a000000-0000-0000-0000-000000000045', '91000000-0000-0000-0000-000000000091', 'own', 'Own room', true, 5);
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('9c000000-0000-0000-0000-000000000045', '91000000-0000-0000-0000-000000000091', 'Own work', 1000, 800, 'h/1'),
  ('9c000000-0000-0000-0000-000000000046', '92000000-0000-0000-0000-000000000092', 'Guest work', 1000, 800, 'g/1');
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('9a000000-0000-0000-0000-000000000045', '9c000000-0000-0000-0000-000000000045', 0);

-- 合同展示（まだ下書き）と、その部屋。**部屋の公開スイッチはわざと入れておく** ──
-- それだけで見えてしまわないことが、このテストの主眼。
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('9e000000-0000-0000-0000-000000000045', '91000000-0000-0000-0000-000000000091', 'joint-45', 'Joint 45', 14);
insert into public.galleries (id, owner_id, slug, title, is_public, expo_id, slots_included, work_cap) values
  ('9a000000-0000-0000-0000-000000000046', '91000000-0000-0000-0000-000000000091', 'joint-room',
   'Joint room', true, '9e000000-0000-0000-0000-000000000045', true, 15);
-- 参加作家の作品を合同展示の壁に掛ける
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('9a000000-0000-0000-0000-000000000046', '9c000000-0000-0000-0000-000000000046', 0);

do $$ begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                  where c.relname='galleries' and p.polname='galleries_select_expo_live')
    then raise exception 'HARNESS: 0045 未適用'; end if;
end $$;

\set ON_ERROR_STOP off
begin;

\echo -n '00 合同展示の部屋は is_public を持てない（true で入れても false に落ちる）: '
select coalesce(bool_and(not is_public), false) from public.galleries
  where id='9a000000-0000-0000-0000-000000000046';

\echo '--- 会期が始まる前（下書き。公開スイッチを立てようとしても立たない） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '01 合同展示の部屋は見えない（is_public だけでは開かない）: '
select count(*)=0 from public.galleries where id='9a000000-0000-0000-0000-000000000046';
\echo -n '02 その配置も見えない: '
select count(*)=0 from public.placements where gallery_id='9a000000-0000-0000-0000-000000000046';
\echo -n '03 参加作家の作品も見えない: '
select count(*)=0 from public.artworks where id='9c000000-0000-0000-0000-000000000046';
\echo -n '04 主催者の通常の部屋は今までどおり見える: '
select count(*)=1 from public.galleries where id='9a000000-0000-0000-0000-000000000045';
\echo -n '05 通常の部屋の作品も今までどおり見える: '
select count(*)=1 from public.artworks where id='9c000000-0000-0000-0000-000000000045';
reset role;
rollback to s;
release s;

\echo '--- 会期が始まったあと ---'
select public.record_expo_purchase('cs_45', '91000000-0000-0000-0000-000000000091',
  '9e000000-0000-0000-0000-000000000045', 14, 2500, 'usd');
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '06 合同展示の部屋が見える: '
select count(*)=1 from public.galleries where id='9a000000-0000-0000-0000-000000000046';
\echo -n '07 配置も見える: '
select count(*)=1 from public.placements where gallery_id='9a000000-0000-0000-0000-000000000046';
\echo -n '08 参加作家の作品も見える（それが展示だから）: '
select count(*)=1 from public.artworks where id='9c000000-0000-0000-0000-000000000046';
\echo -n '09 展示そのものも見える: '
select count(*)=1 from public.expos where id='9e000000-0000-0000-0000-000000000045';
reset role;
rollback to s;
release s;

\echo '--- 通常の公開経路には出ないこと（「完全に別」の要件） ---'
savepoint s;
set local role anon;
set local "request.jwt.claim.sub" = '';
-- **`is_public` で絞る既存の問い合わせ**（/explore・プロフィール・sitemap）が
-- 合同展示の部屋を拾わないこと。会期中でも拾わないのが要点 ── ポリシーは会期中に
-- 読ませるので、`is_public` が立っていれば絞り込みに引っかかってしまう。
\echo -n '10 is_public で絞ると合同展示の部屋は入らない: '
select count(*)=1 from public.galleries
  where owner_id='91000000-0000-0000-0000-000000000091' and is_public;
\echo -n '11 拾えたのは通常の部屋だけ: '
select coalesce(bool_and(expo_id is null), false) from public.galleries
  where owner_id='91000000-0000-0000-0000-000000000091' and is_public;
savepoint e;
\echo -n '12 主催者が公開スイッチを入れ直しても立たない: '
reset role;
update public.galleries set is_public = true where id='9a000000-0000-0000-0000-000000000046';
select coalesce(bool_and(not is_public), false) from public.galleries
  where id='9a000000-0000-0000-0000-000000000046';
rollback to e;
release e;
reset role;
rollback to s;
release s;

\echo '--- 猶予が切れたあと ---'
savepoint s;
update public.expos set starts_at = now() - interval '30 days'
  where id='9e000000-0000-0000-0000-000000000045';
set local role anon;
set local "request.jwt.claim.sub" = '';
\echo -n '13 会期＋猶予を過ぎたら部屋は見えない: '
select count(*)=0 from public.galleries where id='9a000000-0000-0000-0000-000000000046';
\echo -n '14 参加作家の作品も見えない: '
select count(*)=0 from public.artworks where id='9c000000-0000-0000-0000-000000000046';
reset role;
\echo -n '15 掃除しても参加作家の作品は残る: '
select public.purge_expired_expos() >= 1;
select count(*)=1 from public.artworks where id='9c000000-0000-0000-0000-000000000046';
rollback to s;
release s;

\echo '--- 名前の取り合い ---'
savepoint s;
\echo -n '16 アカウント別名と同じ名前で合同展示を作れない → '
update public.profiles set expo_slug = 'taken-name' where id='92000000-0000-0000-0000-000000000092';
savepoint e;
insert into public.expos (owner_id, slug, title) values
  ('91000000-0000-0000-0000-000000000091', 'taken-name', 'ぶつかる');
rollback to e;
release e;
rollback to s;
release s;

savepoint s;
insert into public.admins (user_id, note) values ('91000000-0000-0000-0000-000000000091', 'test');
set local role authenticated;
set local "request.jwt.claim.sub" = '91000000-0000-0000-0000-000000000091';
savepoint e;
\echo -n '17 合同展示と同じ名前をアカウント別名に付けられない → '
select public.set_expo_slug('92000000-0000-0000-0000-000000000092', 'joint-45');
rollback to e;
release e;
\echo -n '18 ぶつからない名前なら付けられる: '
select public.set_expo_slug('92000000-0000-0000-0000-000000000092', 'free-name');
reset role;
select coalesce(bool_and(expo_slug='free-name'), false) from public.profiles
  where id='92000000-0000-0000-0000-000000000092';
rollback to s;
release s;

rollback;
