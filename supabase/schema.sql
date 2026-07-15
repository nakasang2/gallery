-- ============================================================================
-- HAKONIWA — 全スキーマ統合ファイル(schema.sql)
-- ============================================================================
-- これ1枚を Supabase の SQL Editor に貼り付けて Run すれば、必要なテーブル・
-- RLS・関数・Storage が一括で作成されます(migrations 0001〜0021 を統合)。
--
-- ・再実行しても安全(if not exists / create or replace / drop policy if exists でガード)
-- ・番号順に並べてあり、依存関係(テーブル→ポリシー→admin横断read など)を満たします
-- ・個別ファイル(supabase/migrations/*.sql)と同一内容。管理はそちらでも可
--
-- 適用後にやること(README §4/§5 参照):
--   1) 自分を管理者に登録して /admin を有効化:
--        insert into public.admins (user_id, note)
--        select id, 'founder' from auth.users where email = 'あなた@example.com';
--   2) Stripe決済を使うなら環境変数を設定(STRIPE_SECRET_KEY 等)
-- ============================================================================



-- ############################################################################
-- # 0001_init.sql
-- ############################################################################
-- HAKONIWA 初期スキーマ(docs/ARCHITECTURE.md 3章)

/* ================= 1. テーブル ================= */
-- ポリシーが相互にテーブルを参照するため、先にテーブルを全て作る

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  bio text default '',
  avatar_url text,
  sns jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null, -- 'artworks' バケット内の {owner_id}/{artwork_id}
  width int not null check (width > 0),
  height int not null check (height > 0),
  title text not null default '無題',
  description text not null default '',
  year int,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists artworks_owner_idx on public.artworks (owner_id, created_at desc);

create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null default 'main' check (slug ~ '^[a-z0-9-]{1,40}$'),
  title text not null default '私のギャラリー',
  statement text not null default '',
  theme text not null default 'chic',
  layout text not null default 'hall',
  frame_default text not null default 'black',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  slot_index int not null check (slot_index >= 0),
  frame_override text,
  unique (gallery_id, slot_index)
);

/* ================= 2. サインアップ時のプロフィール自動作成 ================= */

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ================= 3. RLS ポリシー ================= */
-- 方針: 自分の行だけ書ける / 公開ギャラリー(is_public)に属するものは誰でも読める

alter table public.profiles enable row level security;
alter table public.artworks enable row level security;
alter table public.galleries enable row level security;
alter table public.placements enable row level security;

-- profiles
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update using ((select auth.uid()) = id);

-- artworks
drop policy if exists "artworks_owner_all" on public.artworks;
create policy "artworks_owner_all"
  on public.artworks for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "artworks_select_in_public_gallery" on public.artworks;
create policy "artworks_select_in_public_gallery"
  on public.artworks for select
  using (
    exists (
      select 1
      from public.placements p
      join public.galleries g on g.id = p.gallery_id
      where p.artwork_id = artworks.id and g.is_public
    )
  );

-- galleries
drop policy if exists "galleries_owner_all" on public.galleries;
create policy "galleries_owner_all"
  on public.galleries for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "galleries_select_public" on public.galleries;
create policy "galleries_select_public"
  on public.galleries for select using (is_public);

-- placements
drop policy if exists "placements_owner_all" on public.placements;
create policy "placements_owner_all"
  on public.placements for all
  using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "placements_select_public" on public.placements;
create policy "placements_select_public"
  on public.placements for select
  using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public)
  );

/* ================= 4. Storage: 作品画像バケット ================= */
-- 公開バケット(公開ギャラリー前提。読み取りは誰でも、書き込みは自分のフォルダのみ)

insert into storage.buckets (id, name, public)
values ('artworks', 'artworks', true)
on conflict (id) do nothing;

drop policy if exists "artwork_images_public_read" on storage.objects;
create policy "artwork_images_public_read"
  on storage.objects for select
  using (bucket_id = 'artworks');

drop policy if exists "artwork_images_insert_own" on storage.objects;
create policy "artwork_images_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "artwork_images_update_own" on storage.objects;
create policy "artwork_images_update_own"
  on storage.objects for update
  using (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "artwork_images_delete_own" on storage.objects;
create policy "artwork_images_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ############################################################################
-- # 0002_video.sql
-- ############################################################################
-- 動画作品対応: artworks に種別カラムを追加

alter table public.artworks
  add column if not exists kind text not null default 'image'
  check (kind in ('image', 'video'));


-- ############################################################################
-- # 0003_order_profile.sql
-- ############################################################################
-- 配置の並び順とプロフィール編集のための追加

-- 作品の表示順(エディタでの並び替えを永続化する)
alter table public.artworks
  add column if not exists sort_order double precision not null default 0;

create index if not exists artworks_owner_order_idx
  on public.artworks (owner_id, sort_order, created_at);


-- ############################################################################
-- # 0004_hanging_caption.sql
-- ############################################################################
-- テーマごとの吊し方(額縁の掛け方)とキャプションの見せ方を保存するための追加

-- 額縁の吊し方 / キャプションの見せ方(公開ギャラリーのスナップショットに含める)
alter table public.galleries
  add column if not exists hanging_default text not null default 'wire',
  add column if not exists caption_default text not null default 'side';


-- ############################################################################
-- # 0005_dashboard.sql
-- ############################################################################
-- ダッシュボード用: ギャラリーの更新日時

alter table public.galleries
  add column if not exists updated_at timestamptz not null default now();

-- 行の更新時に updated_at を自動更新
create or replace function public.touch_gallery()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists galleries_touch on public.galleries;
create trigger galleries_touch
  before update on public.galleries
  for each row execute function public.touch_gallery();


-- ############################################################################
-- # 0006_storage_bytes.sql
-- ############################################################################
-- ストレージ容量の管理(プラン上限 300MB/ユーザー の実測用)

-- 作品ごとの保存バイト数(display + thumb + video の合計)。
-- 既存行は 0 のまま(過去の作品は容量計算に含めないベストエフォート)
alter table public.artworks
  add column if not exists bytes bigint not null default 0;


-- ############################################################################
-- # 0007_delete_account.sql
-- ############################################################################
-- アカウント削除(要件10.1)
--
-- クライアントの anon キーでは auth.users を消せないため、本人限定の
-- security definer 関数を用意する。auth.users の削除は FK の cascade で
-- profiles → artworks / galleries → placements まで連鎖する。
-- (Storage のファイルは cascade されないので、クライアント側で先に削除する)

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;


-- ############################################################################
-- # 0008_engagement.sql
-- ############################################################################
-- 来場者エンゲージメント: 訪問記録・芳名帳・いいね(要件フェーズ2)

/* ---- 訪問(公開ページのビュー記録。解析用) ---- */
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists visits_gallery_idx on public.visits (gallery_id, created_at desc);

alter table public.visits enable row level security;

-- 誰でも「公開中のギャラリーに対してのみ」記録できる。読めるのはオーナーだけ
drop policy if exists "visits_insert_public" on public.visits;
create policy "visits_insert_public"
  on public.visits for insert
  with check (exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public));

drop policy if exists "visits_select_own" on public.visits;
create policy "visits_select_own"
  on public.visits for select
  using (exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid())));

/* ---- 芳名帳(来場コメント。公開ギャラリーでは誰でも読める) ---- */
create table if not exists public.guestbook (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 40),
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists guestbook_gallery_idx on public.guestbook (gallery_id, created_at desc);

alter table public.guestbook enable row level security;

drop policy if exists "guestbook_insert_public" on public.guestbook;
create policy "guestbook_insert_public"
  on public.guestbook for insert
  with check (exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public));

drop policy if exists "guestbook_select_public_or_own" on public.guestbook;
create policy "guestbook_select_public_or_own"
  on public.guestbook for select
  using (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id and (g.is_public or g.owner_id = (select auth.uid()))
    )
  );

-- 迷惑コメントはオーナーが消せる
drop policy if exists "guestbook_delete_own" on public.guestbook;
create policy "guestbook_delete_own"
  on public.guestbook for delete
  using (exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid())));

/* ---- いいね(作品ごと・匿名。重複防止はクライアント側のベストエフォート) ---- */
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists likes_gallery_idx on public.likes (gallery_id);
create index if not exists likes_artwork_idx on public.likes (artwork_id);

alter table public.likes enable row level security;

drop policy if exists "likes_insert_public" on public.likes;
create policy "likes_insert_public"
  on public.likes for insert
  with check (exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public));

drop policy if exists "likes_select_public_or_own" on public.likes;
create policy "likes_select_public_or_own"
  on public.likes for select
  using (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id and (g.is_public or g.owner_id = (select auth.uid()))
    )
  );


-- ############################################################################
-- # 0009_space_extras.sql
-- ############################################################################
-- 空間・見せ方の拡張: カスタムレイアウトのパラメータと OGP 代表作の手動指定

alter table public.galleries
  -- layout = 'custom' のときの部屋パラメータ(hw/hd/island)。プリセット時は空
  add column if not exists layout_params jsonb not null default '{}'::jsonb,
  -- OGPカード・作家ページのカバーに使う作品(未指定なら slot 0)
  add column if not exists cover_artwork_id uuid references public.artworks (id) on delete set null;


-- ############################################################################
-- # 0010_reports.sql
-- ############################################################################
-- 通報のDB化(mailto導線の置き換え)

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  -- 通報対象(自由記述のURL/ハンドル。ギャラリー削除後も通報記録は残す)
  about text not null check (char_length(about) <= 200),
  reason text not null check (char_length(reason) between 1 and 1000),
  contact text not null default '' check (char_length(contact) <= 200),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- 誰でも送信できる。閲覧ポリシーは作らない(運用者が service role / SQL Editor で見る)
drop policy if exists "reports_insert_any" on public.reports;
create policy "reports_insert_any"
  on public.reports for insert
  with check (true);


-- ############################################################################
-- # 0011_per_work_overrides.sql
-- ############################################################################
-- 0011: per-work hanging & caption overrides.
-- Frames already override per work (placements.frame_override); hanging and
-- caption now follow the same pattern — the gallery row keeps the defaults
-- (theme-recommended), placements carry the optional per-work override.
-- NULL = inherit the gallery default. No RLS changes: the existing placement
-- policies (owner writes, public reads via the gallery) already cover them.

alter table public.placements
  add column if not exists hanging_override text,
  add column if not exists caption_override text;


-- ############################################################################
-- # 0012_mat.sql
-- ############################################################################
-- 0012: mat (the paper border inside the frame) — presence + colour.
-- Same two-layer pattern as every other design axis: the gallery row holds the
-- default ('auto' = each frame's recommended mat), placements carry the optional
-- per-work override (NULL = inherit). Keys resolve against lib/presets.ts MATS
-- (auto / none / white / ivory / grey / black); unknown keys fall back to 'auto'
-- at render time, so no CHECK constraint is needed.

alter table public.galleries
  add column if not exists mat_default text not null default 'auto';

alter table public.placements
  add column if not exists mat_override text;


-- ############################################################################
-- # 0013_gallery_capacity.sql
-- ############################################################################
-- 0013: per-gallery work capacity (REQUIREMENTS.md §11.5/§11.7 — "room capacity" axis).
-- Capacity now travels with the room itself instead of being one global constant:
-- each hakoniwa gets its own work_cap, fixed to the plan's value at creation time
-- ("buy a room" = a fresh row with that purchase's cap already baked in).
--
-- Existing rows default to 10 (today's global PLAN.worksPerGallery) so no current
-- gallery is retroactively shrunk — only *new* galleries created after this ships
-- get the smaller free-tier cap (5), written explicitly by lib/galleries.ts.

alter table public.galleries
  add column if not exists work_cap integer not null default 10;


-- ############################################################################
-- # 0014_design_overrides.sql
-- ############################################################################
-- 0014: Design Tools overrides (REQUIREMENTS.md §11.5/§11.8) — the buy-once
-- "design tools" capability: wall/floor colour, light colour/intensity, and a
-- small logo composited onto the title wall, layered on top of the chosen
-- theme. Stored as one jsonb blob (same two-layer pattern as mat/work_cap):
-- '{}' means "no overrides, render the theme as-is".

alter table public.galleries
  add column if not exists design_overrides jsonb not null default '{}'::jsonb;


-- ############################################################################
-- # 0015_artwork_purchase_link.sql
-- ############################################################################
-- 0015: per-artwork purchase/shop link — an artist can point a specific work
-- at wherever they sell it (their own shop, Etsy, a DM link, etc.). Shown to
-- visitors on the artwork panel; optional, null means "not for sale here".

alter table public.artworks
  add column if not exists purchase_url text;


-- ############################################################################
-- # 0016_purchases.sql
-- ############################################################################
-- Purchases ledger (REQUIREMENTS.md §11.x) — the seam a future payment
-- integration (a Stripe webhook, most likely) writes into; entitlements
-- reads from it. Deliberately no insert policy: a real purchase must be
-- verified server-side (the webhook uses the service role key, which
-- bypasses RLS), so there is no client-writable path to grant yourself
-- content for free.
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('theme', 'layout', 'design_tools', 'video_pass')),
  item_key text not null default '', -- theme/layout id; '' for design_tools and video_pass (kept not-null so the unique constraint below actually dedupes)
  created_at timestamptz not null default now(),
  unique (user_id, kind, item_key)
);

alter table purchases enable row level security;

drop policy if exists "read own purchases" on purchases;
create policy "read own purchases" on purchases
  for select using (auth.uid() = user_id);


-- ############################################################################
-- # 0017_admin.sql
-- ############################################################################
-- Admin role + read access for an in-app admin console (total revenue, owned
-- packages, every exhibition space). Until now the "admin" was whoever had the
-- Supabase SQL Editor / service-role key (see 0010_reports, 0016_purchases); this
-- adds a first-class admin identity in the DB and grants it cross-user SELECT via
-- RLS, so the /admin page can run on the same anon key + RLS model as the rest of
-- the app. There is deliberately no client-writable path to become an admin.

/* ================= 1. 管理者テーブル ================= */
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- No insert/update/delete policy: admins are seeded out-of-band only.
-- To make yourself an admin, run this once in the SQL Editor (service role):
--   insert into public.admins (user_id, note)
--   select id, 'founder' from auth.users where email = 'you@example.com';
-- A user may read their OWN admin row so the client can self-identify.
drop policy if exists "admins_read_own" on public.admins;
create policy "admins_read_own" on public.admins
  for select using ((select auth.uid()) = user_id);

-- SECURITY DEFINER so it can consult admins regardless of the caller's RLS.
-- Used both by the client (rpc) to gate the UI and by the policies below.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

grant execute on function public.is_admin() to anon, authenticated;

/* ================= 2. 管理者の横断read（既存の所有者/公開ポリシーに追加） ================= */
-- profiles is already world-readable (profiles_select_all), so no admin policy needed there.

drop policy if exists "galleries_select_admin" on public.galleries;
create policy "galleries_select_admin" on public.galleries
  for select using (public.is_admin());

drop policy if exists "placements_select_admin" on public.placements;
create policy "placements_select_admin" on public.placements
  for select using (public.is_admin());

drop policy if exists "artworks_select_admin" on public.artworks;
create policy "artworks_select_admin" on public.artworks
  for select using (public.is_admin());

drop policy if exists "purchases_select_admin" on public.purchases;
create policy "purchases_select_admin" on public.purchases
  for select using (public.is_admin());

drop policy if exists "reports_select_admin" on public.reports;
create policy "reports_select_admin" on public.reports
  for select using (public.is_admin());

drop policy if exists "visits_select_admin" on public.visits;
create policy "visits_select_admin" on public.visits
  for select using (public.is_admin());

drop policy if exists "likes_select_admin" on public.likes;
create policy "likes_select_admin" on public.likes
  for select using (public.is_admin());

drop policy if exists "guestbook_select_admin" on public.guestbook;
create policy "guestbook_select_admin" on public.guestbook
  for select using (public.is_admin());

/* ================= 3. 売上集計の下地（金額を購入時点で記録） ================= */
-- purchases (0016) only recorded WHICH entitlement, not the amount. Revenue must be
-- summed from what was actually charged (prices can change), so store it per row.
-- A future Stripe webhook writes sku + amount_jpy alongside kind/item_key.
alter table public.purchases add column if not exists sku text;
alter table public.purchases add column if not exists amount_jpy integer check (amount_jpy is null or amount_jpy >= 0);


-- ############################################################################
-- # 0018_site_config.sql
-- ############################################################################
-- Site-wide config the admin console edits and the public site reads. First use:
-- which artworks the landing-page hero shows (one setting drives PC and mobile,
-- since both read the same row). Extensible key/value so later site settings don't
-- each need a migration.

create table if not exists public.site_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_config enable row level security;

-- The landing page is public, so anyone (anon key) may read config.
drop policy if exists "site_config_read_all" on public.site_config;
create policy "site_config_read_all" on public.site_config
  for select using (true);

-- Only admins may change it (is_admin() from 0017).
drop policy if exists "site_config_write_admin" on public.site_config;
create policy "site_config_write_admin" on public.site_config
  for all using (public.is_admin()) with check (public.is_admin());


-- ############################################################################
-- # 0019_checkout.sql
-- ############################################################################
-- Stripe checkout support (REQUIREMENTS.md §11.7). Two pieces:
--   1. purchases.kind grows the values the webhook actually records
--      ('capacity' add-ons, future 'room' / 'theme_collection' rows).
--   2. An atomic "record the payment AND bump the cap" function the webhook
--      calls after a paid "+N works" checkout. Doing both in one transaction,
--      keyed on the Stripe session id, means: retries are no-ops (the ledger
--      row dedupes), and a genuinely-charged purchase is ALWAYS recorded even
--      if the target room is gone — we never delete the record to force a retry.

/* ================= 1. purchases.kind の拡張 ================= */
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check
  check (kind in ('theme', 'layout', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room'));

/* ================= 2. キャパ購入の記録+加算(webhook専用・冪等) ================= */
-- Runs as the function owner (postgres) so it can write regardless of RLS, but
-- execution is granted to service_role ONLY — anon/authenticated must not be
-- able to raise their own cap for free. Returns one of:
--   'applied'    — newly recorded and the room's cap was raised
--   'duplicate'  — this Stripe session was already processed (safe no-op)
--   'no_gallery' — payment RECORDED, but the room no longer exists / not owned
--                  (caller logs this for manual reconciliation; the charge is
--                   never lost, and returning success stops pointless retries)
create or replace function public.record_capacity_purchase(
  p_session text,
  p_user uuid,
  p_gallery uuid,
  p_amount int,
  p_amount_jpy int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_capacity_purchase: amount must be positive';
  end if;

  -- The ledger row is the durable record of the charge. Its unique
  -- (user_id, kind, item_key=session) makes redelivery a no-op.
  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy)
  values (p_user, 'capacity', p_session, 'capacity_addon', p_amount_jpy)
  on conflict (user_id, kind, item_key) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- Same transaction as the insert: either both land or neither does, so the
  -- cap can't be bumped twice and the record can't exist without the attempt.
  update public.galleries
     set work_cap = work_cap + p_amount
   where id = p_gallery
     and owner_id = p_user;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return 'no_gallery';
  end if;
  return 'applied';
end;
$$;

revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int) from public;
revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int) from anon;
revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int) from authenticated;
grant execute on function public.record_capacity_purchase(text, uuid, uuid, int, int) to service_role;


-- ############################################################################
-- # 0020_articles.sql
-- ############################################################################
-- Articles / guides (STRATEGY §4.1-3): SEO content the team publishes to pull
-- search traffic ("how to open a web solo show", etc.). Admin-authored (same
-- is_admin() gate as site_config/0017-0018); the public reads only published
-- rows. Markdown body is rendered app-side (lib/markdown) — no HTML is stored.

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null default '',
  excerpt text not null default '',
  body_md text not null default '',
  cover_url text,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast listing of the public feed (published, newest first)
create index if not exists articles_published_idx
  on public.articles (published, published_at desc);

alter table public.articles enable row level security;

-- Anyone (anon key) may read PUBLISHED articles — this is public content.
drop policy if exists "articles_read_published" on public.articles;
create policy "articles_read_published" on public.articles
  for select using (published = true);

-- Admins may read everything (incl. drafts) and write. is_admin() from 0017.
drop policy if exists "articles_read_admin" on public.articles;
create policy "articles_read_admin" on public.articles
  for select using (public.is_admin());

drop policy if exists "articles_write_admin" on public.articles;
create policy "articles_write_admin" on public.articles
  for all using (public.is_admin()) with check (public.is_admin());


-- ############################################################################
-- # 0021_artwork_audio.sql
-- ############################################################################
-- Per-work audio guide (REQUIREMENTS §6-3 / STRATEGY P3-12): a short narration
-- that plays as the visitor reaches each work — the automatic version turns the
-- guided tour into an audio tour. The file lives in the artworks storage bucket
-- (owner's folder); this column just holds its public URL, mirroring
-- artworks.purchase_url (0015). No schema beyond one nullable column.

alter table public.artworks add column if not exists audio_url text;

