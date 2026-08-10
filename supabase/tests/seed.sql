-- 本番に近い形の既存データ（0035 まで適用済みの状態で入っているもの）。
-- 0036 と 0038 のバックフィルが**既にある行に対して**正しく効くかを見るために入れる。
-- 空のDBで流すと backfill は 0 行に当たって空振りし、何も検査できない。
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'one@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'two@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'three@example.com');

update public.profiles set username = 'owner_one',  display_name = 'Owner One'  where id = '11111111-0000-0000-0000-000000000001';
update public.profiles set username = 'owner_two',  display_name = 'Owner Two'  where id = '22222222-0000-0000-0000-000000000002';
update public.profiles set username = 'no_rooms',   display_name = 'No Rooms'   where id = '33333333-0000-0000-0000-000000000003';

-- Owner One: 3室（created_at をずらす。0036/0038 は「所有者ごと最古の1室」を見る）
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap, created_at) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'first',  '最初の部屋',   true,  5,  '2026-01-01T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'second', '2つめの部屋', false, 15, '2026-02-01T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'third',  '3つめの部屋', true,  15, '2026-03-01T00:00:00Z');

-- Owner Two: 1室だけ
insert into public.galleries (id, owner_id, slug, title, is_public, work_cap, created_at) values
  ('b2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'solo', 'ひとつだけ', true, 5, '2026-01-15T00:00:00Z');

-- 作品と配置（0037/0041 が placements の書き込み経路を差し替えるので、既存行が
-- 生き残るかを見る）
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('c3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '既存の作品A', 1200, 900, 'one/a'),
  ('c3000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', '既存の作品B', 1200, 900, 'two/b');
insert into public.placements (gallery_id, artwork_id, slot_index) values
  ('a1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 0),
  ('b2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000002', 0);

-- 芳名帳・いいね・訪問（0042 のトリガが後から載る表。既存行が残るか）
insert into public.guestbook (gallery_id, name, message) values
  ('a1000000-0000-0000-0000-000000000001', '過去の来場者', '前からある記帳');
insert into public.likes (gallery_id, artwork_id) values
  ('a1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001');
insert into public.visits (gallery_id) values ('a1000000-0000-0000-0000-000000000001');

-- 購入台帳（0038 の等級ベースの番人が数える先）
-- 0038 の等級ベースの番人は `purchases.kind='room'` を数える。列は 0035 時点のものだけ
-- を使う（`stripe_session_id` はこの時点には無い）。
insert into public.purchases (user_id, kind, item_key, amount_jpy, currency) values
  ('11111111-0000-0000-0000-000000000001', 'room', 'room_2', 2500, 'usd'),
  ('11111111-0000-0000-0000-000000000001', 'room', 'room_3', 2500, 'usd');
