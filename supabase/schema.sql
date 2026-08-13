-- ============================================================================
-- Xibit360 — 全スキーマ統合ファイル(schema.sql)
-- ============================================================================
-- これ1枚を Supabase の SQL Editor に貼り付けて Run すれば、必要なテーブル・
-- RLS・関数・Storage が一括で作成されます(migrations 0001〜0062 を統合)。
--
-- ・再実行しても安全(if not exists / create or replace / drop ... if exists でガード)
-- ・番号順に並べてあり、依存関係(テーブル→ポリシー→admin横断read など)を満たします
-- ・個別ファイル(supabase/migrations/*.sql)と同一内容。管理はそちらでも可
-- ・後の番号が前の番号を上書きする箇所があります(番号順に流すことが前提):
--     purchases_kind_check        0019 → 0034('frame' 追加版が残る)
--     record_capacity_purchase    0019 → 0028 → 0031(6引数・通貨版だけが残る)
--     grant_entitlement           0022 → 0034('frame' 追加版が残る)
--     guestbook_insert_public     0008 → 0033(guestbook_enabled を見る版が残る)
-- ・0029 だけはスキーマ変更ではなくデータ移行(旧Storage URLの書き換え)です。
--   新規環境では0行で空振りします。詳細はその節のコメント参照。
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
-- Xibit360 初期スキーマ(docs/ARCHITECTURE.md 3章)

/* ================= 1. テーブル ================= */
-- ポリシーが相互にテーブルを参照するため、先にテーブルを全て作る

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  bio text default '',
  cv text not null default '', -- 0060: 来歴（展示歴・受賞歴）。自己紹介とは別欄
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
-- each gallery gets its own work_cap, fixed to the plan's value at creation time
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
-- (owner's folder); this column just holds its public URL — the same one-nullable-
-- column shape 0015 originally gave purchase_url (since replaced by purchase_links,
-- 0055). No schema beyond one nullable column.

alter table public.artworks add column if not exists audio_url text;


-- ############################################################################
-- # 0022_admin_grant.sql
-- ############################################################################
-- Admin manual entitlement grants (unlock a paid item for a specific user).
-- The purchases ledger (0016) has NO client insert policy on purpose — only
-- server-side writes. These two SECURITY DEFINER functions add an admin-only
-- write path: they run as the owner (so they can write the ledger) but reject
-- any caller that isn't an admin (is_admin(), 0017). Granted rows carry
-- sku='admin_grant' and amount_jpy=NULL so they never count as revenue.
-- Item vocabulary is open (kind + item_key), so future paid themes/layouts work
-- with no schema change — the admin UI just lists whatever presets exist.

create or replace function public.grant_entitlement(p_user uuid, p_kind text, p_item_key text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('theme', 'layout', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room') then
    raise exception 'unknown entitlement kind: %', p_kind;
  end if;
  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy)
  values (p_user, p_kind, coalesce(p_item_key, ''), 'admin_grant', null)
  on conflict (user_id, kind, item_key) do nothing;
end;
$$;

create or replace function public.revoke_entitlement(p_user uuid, p_kind text, p_item_key text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.purchases
   where user_id = p_user and kind = p_kind and item_key = coalesce(p_item_key, '');
end;
$$;

-- Callable by any signed-in user, but the is_admin() check inside rejects non-admins.
revoke all on function public.grant_entitlement(uuid, text, text) from public;
revoke all on function public.revoke_entitlement(uuid, text, text) from public;
grant execute on function public.grant_entitlement(uuid, text, text) to authenticated;
grant execute on function public.revoke_entitlement(uuid, text, text) to authenticated;


-- ============================================================================
-- # 0023_arrangement.sql — manual slot placement (§11.13)
-- ============================================================================
-- arrangement[slotIndex] = artworkId | null (gap = intentionally-empty slot).
-- Absent/empty = auto-fill from slot 0 (pre-0023 behaviour), so existing rooms
-- are unchanged. Mirrored into placements.slot_index on publish.
alter table public.galleries
  add column if not exists arrangement jsonb;

-- ============================================================================
-- # 0024_public_visit_count.sql — public visit count for ambient presence (§11.19)
-- ============================================================================
-- Returns ONLY the aggregate visit count, and only for a public gallery (no rows,
-- no timestamps). Drives the past-visitor silhouettes; can't peek at private rooms.
create or replace function public.public_visit_count(p_gallery uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(count(*), 0)::int
  from public.visits v
  where v.gallery_id = p_gallery
    and exists (select 1 from public.galleries g where g.id = p_gallery and g.is_public);
$$;
revoke all on function public.public_visit_count(uuid) from public;
grant execute on function public.public_visit_count(uuid) to anon, authenticated;

-- ============================================================================
-- # 0025_artwork_dimensions.sql — 実寸(cm)と技法
-- ============================================================================
-- Physical dimensions and medium for artworks. The pixel width/height columns
-- stay as-is (they drive the image ratio); these are the artist-declared
-- real-world size (cm) and medium, shown on the label and used to size the piece
-- to its true proportions/scale in 3D.
alter table public.artworks add column if not exists width_cm real;
alter table public.artworks add column if not exists height_cm real;
alter table public.artworks add column if not exists medium text;

-- ============================================================================
-- # 0026_artwork_price.sql — 表示価格(§11.28)
-- ============================================================================
-- Free text as the artist typed it (e.g. "¥50,000", "$500", "Ask") — Xibit360
-- doesn't process the sale, it just shows the price next to the artist's own
-- purchase link on the artwork panel.
alter table public.artworks add column if not exists price text;

-- ============================================================================
-- # 0027_gallery_bgm.sql — 空間BGM(STRATEGY P3-12)
-- ============================================================================
-- The owner uploads one audio track that loops as spatial background music while
-- visitors walk the room. The file lives in the artworks storage bucket
-- ({owner}/{gallery}/bgm); this column holds its public URL. Nullable — a gallery
-- with no track just keeps the generated room tone (silent BGM).
alter table public.galleries add column if not exists bgm_url text;

-- ============================================================================
-- # 0028_capacity_clamp.sql — キャパ購入を物理上限で止める
-- ============================================================================
-- Clamp capacity purchases to the room's physical max (docs/DECISIONS 2026-07-24).
-- The checkout route already clamps quantity against work_cap read at session
-- creation, but two in-flight checkouts on the same room could each pass that
-- check and sum past the max. record_capacity_purchase adds unconditionally, so
-- we cap the result here — the single atomic, race-proof gate. 15 = every
-- layout's slot count (lib/limits MAX_WORKS_PER_ROOM); keep the two in step.
--
-- NOTE (統合ファイル): この5引数版は下の 0031 で drop され、通貨引数を足した
-- 6引数版に置き換わる。最終状態に残るのは 0031 の版だけ。ここは履歴として
-- 個別ファイルと同じ順序で並べてある。
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

  -- Same transaction as the insert. Clamp to 15 so concurrent checkouts can
  -- never raise the cap past what any layout can physically display.
  update public.galleries
     set work_cap = least(work_cap + p_amount, 15)
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

-- ============================================================================
-- # 0029_r2_urls.sql — 保存済みURLを Cloudflare R2 に向け直す(データ移行)
-- ============================================================================
-- docs/DECISIONS.md 2026-07-27。**新しい環境ではこの節は空振りする**(まだ行が
-- 1つも無いので、下のUPDATEはすべて0行)。既存のSupabase Storage時代のデータを
-- 抱えた環境で使う場合は、統合ファイルではなく個別の
-- supabase/migrations/0029_r2_urls.sql を、**ファイルの移送を終えてから**単独で
-- 実行すること(移送前だと、まだ存在しないR2のURLを指す時間ができる)。
--
-- Most files need no change here: `artworks.storage_path` holds a RELATIVE key
-- ({uid}/{artworkId}) and the app builds the absolute URL at read time, so those
-- followed the base-URL switch automatically. The columns below are the ones that
-- were saved as ABSOLUTE Supabase Storage URLs and have to be rewritten once.
--
-- 配信ドメインが cdn.xibit360.art 以外なら、下の 'https://cdn.xibit360.art/' を
-- すべて置き換えてから実行する。
--
-- The old public prefix, matched loosely so any project ref works:
--   https://<ref>.supabase.co/storage/v1/object/public/artworks/<key>
-- Cache-busting suffixes (?v=…) are preserved. 再実行は安全(すでに書き換わった
-- 行はパターンに一致しないので何も起きない)。

-- Profile avatars (0001)
update public.profiles
set avatar_url = regexp_replace(
  avatar_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where avatar_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

-- Per-work audio guides (0021)
update public.artworks
set audio_url = regexp_replace(
  audio_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where audio_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

-- Gallery BGM (0027) and the Design Tools logo inside design_overrides (0014).
--
-- ⚠️ 注意: galleries には updated_at を自動更新する BEFORE UPDATE トリガ
-- (galleries_touch, 0005) があり、/explore は updated_at の降順で並ぶ
-- (lib/publish.ts)。下の2文が1行でも書き換えると、そのギャラリーが「最近更新」の
-- 先頭に浮上する。URL書き換えは作家による編集ではないので望ましくないが、
-- **これを避ける手段は ALTER TABLE か DDL しかない**:
--   - `set updated_at = updated_at` は効かない（BEFOREトリガが後から上書きする）
--   - 後から別UPDATEで戻すのも効かない（そのUPDATE自体がトリガを発火させる）
--   - `alter table ... disable trigger` は**テーブル所有者権限が必要**で、権限が
--     足りないと Supabase SQL Editor は貼り付けた全体を1トランザクションで
--     実行するため**スクリプト全体がロールバックし「1行も変わらない」**。
--     実際にこのプロジェクトではそれが起きたため、その方式は採らない
--     (docs/LESSONS.md 2026-07-27)。
-- Xibit360本番では BGM もロゴも0件だったため下の2文は空振りで、並び順への影響は
-- なかった。他環境で該当行がある場合は、実行前に updated_at を控えておき、
-- 必要なら手で戻すこと。
update public.galleries
set bgm_url = regexp_replace(
  bgm_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where bgm_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

update public.galleries
set design_overrides = regexp_replace(
  design_overrides::text,
  'https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/',
  'g'
)::jsonb
where design_overrides::text like '%.supabase.co/storage/v1/object/public/artworks/%';

-- Article cover images (0020)
update public.articles
set cover_url = regexp_replace(
  cover_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where cover_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

-- Landing-page hero images, stored inside site_config.value jsonb (0018).
-- Rewritten as text and cast back ('g' = every occurrence), so any key holding
-- such a URL is covered no matter how many there are.
update public.site_config
set value = regexp_replace(
  value::text,
  'https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/',
  'g'
)::jsonb,
  updated_at = now()
where value::text like '%.supabase.co/storage/v1/object/public/artworks/%';

-- Verification: every query below should return 0 rows after this runs.
--   select id, avatar_url from public.profiles where avatar_url like '%supabase.co/storage%';
--   select id, audio_url  from public.artworks where audio_url  like '%supabase.co/storage%';
--   select id, bgm_url    from public.galleries where bgm_url    like '%supabase.co/storage%';
--   select id, cover_url  from public.articles  where cover_url  like '%supabase.co/storage%';
--   select id from public.galleries  where design_overrides::text like '%supabase.co/storage%';
--   select key from public.site_config where value::text like '%supabase.co/storage%';

-- ============================================================================
-- # 0030_storage_reservations.sql — 署名済みアップロードの「予約」台帳
-- ============================================================================
-- 容量制限(1人300MB)の穴を塞ぐ。
--
-- 背景
--   容量制限の判定は、これまで artworks.bytes の合計だった。この値は
--   ブラウザの言い値で、しかも作品ファイルは「行を作る前」にアップロードされる。
--   つまり行を作らなければ何MB上げても記録が残らず、毎回新しいidにすれば無制限に
--   書き込めた。音声ガイドとBGMに至っては、そもそもどこにも記録されていなかった。
--
-- 0030以降の考え方(docs/DECISIONS.md 2026-07-27「容量制限の実測化」)
--   使用量の正は **R2に実在するバイト数**。サーバーが署名のたびに {uid}/ 配下を
--   実測する。クライアントの申告値は一切使わないので、artworks.bytes を偽っても、
--   行を作らずに上げても、音声を上げても、すべて同じ1つの数字に反映される。
--
--   実測だけで足りないのは同時実行のとき。何本も同時に署名を要求されると全部が
--   「アップロード前」の同じ数字を見てしまう。そこで署名した分をこのテーブルへ
--   短時間(署名URLの有効期限と同じ10分)だけ積み、実測値＋予約分で判定する。
--   ファイルがR2に着けば実測値に含まれ、予約は期限切れで消える。
--
--   定期実行(cron)は要らない。期限切れの行は、次に誰かが署名を要求したついでに
--   まとめて消える。

create table if not exists public.storage_reservations (
  id bigint generated always as identity primary key,
  uid uuid not null references public.profiles (id) on delete cascade,
  -- R2のオブジェクトキー。用途とidから決まる固定パスなので、同じファイルを
  -- 上げ直しても行は増えない(unique で1本にまとまる)。
  key text not null,
  bytes bigint not null check (bytes > 0),
  expires_at timestamptz not null,
  unique (uid, key)
);

-- 期限切れの一括削除用。行の寿命が10分なのでテーブルは常に小さい。
create index if not exists storage_reservations_expiry_idx
  on public.storage_reservations (expires_at);

alter table public.storage_reservations enable row level security;
-- ポリシーを1つも作らない = anon/authenticated からは直接読み書きできない。
-- 出入口は下の security definer 関数だけ。

/* ================= 予約と容量判定 ================= */
--
-- 引数のうち p_listed_bytes(R2の実測合計)と p_limit_bytes はサーバー(APIルート)が
-- 決めて渡す。この関数自体は authenticated から直接呼べてしまうが、そこで嘘の
-- 実測値を渡しても得はしない:
--   - 通っても増えるのは「自分の予約」だけで、署名付きURLは1本も手に入らない
--     (URLを発行するのは app/api/upload-url/route.ts だけで、そちらは自分でR2を実測する)
--   - 既存の予約は greatest() で増える方向にしか更新できないので、
--     予約を消して枠を空けることはできない
-- つまり、細工してできるのは自分の枠を自分で狭めることだけ。
-- 返り値の型を変えるときは create or replace では置き換えられないので、先に落とす
drop function if exists public.reserve_storage(text[], bigint[], bigint, bigint, int);

create or replace function public.reserve_storage(
  p_keys text[],
  p_bytes bigint[],
  p_listed_bytes bigint,
  p_limit_bytes bigint,
  p_ttl_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(array_length(p_keys, 1), 0);
  v_new bigint;
  v_pending bigint;
  v_used bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  -- 1リクエストのファイル数はAPIルート側と揃えて最大4本
  if v_n = 0 or v_n > 4 or v_n is distinct from coalesce(array_length(p_bytes, 1), 0) then
    raise exception 'bad reservation batch';
  end if;
  if exists (select 1 from unnest(p_keys) as t(k) where k is null or k = '') then
    raise exception 'bad reservation key';
  end if;
  if exists (select 1 from unnest(p_bytes) as t(b) where b is null or b <= 0) then
    raise exception 'bad reservation size';
  end if;
  if p_listed_bytes is null or p_listed_bytes < 0
     or p_limit_bytes is null or p_limit_bytes <= 0
     or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'bad reservation arguments';
  end if;

  -- 期限切れの掃除。これが cron の代わり(署名要求のついでに片付く)。
  -- skip locked = 他のセッションが触っている行は飛ばす。全ユーザー分を無条件に
  -- 消すと、2人が同時に呼んだときお互いの行ロックを待ち合ってデッドロックし得る。
  -- 取りこぼしても下の集計が expires_at で弾くので、掃除は純粋な後片付けでよい。
  delete from public.storage_reservations
   where ctid in (
     select ctid from public.storage_reservations
      where expires_at < now()
      order by expires_at
      limit 1000
      for update skip locked
   );

  -- 同じユーザーの同時リクエストを直列化する。これが無いと2本が互いの予約が
  -- 入る前に残量を読み、どちらも通ってしまう(＝制限を一瞬だけ踏み越えられる)。
  -- トランザクション終了で自動的に外れる。
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- 今回と同じキーの予約は下の upsert で置き換わるので、二重に数えない。
  -- expires_at で絞るので、上の掃除が取りこぼした行があっても正しい。
  select coalesce(sum(bytes), 0) into v_pending
    from public.storage_reservations
   where uid = v_uid and expires_at > now() and not (key = any (p_keys));

  -- 同一キーが1バッチに複数入っていても1本として数える(下の upsert と揃える)
  select coalesce(sum(mb), 0) into v_new
    from (select max(b) as mb from unnest(p_keys, p_bytes) as t(k, b) group by k) d;

  v_used := p_listed_bytes + v_pending;
  if v_used + v_new > p_limit_bytes then
    -- 溢れるときは1行も入れない。失敗した試行が枠を食い続けないようにするため。
    return jsonb_build_object('ok', false, 'used', v_used);
  end if;

  -- greatest() で増える方向にしか更新しない。予約を小さく上書きして枠を空ける、
  -- という抜け道を残さないため(この関数は authenticated から直接も呼べる)。
  insert into public.storage_reservations as sr (uid, key, bytes, expires_at)
  select v_uid, k, max(b), now() + make_interval(secs => p_ttl_seconds)
    from unnest(p_keys, p_bytes) as t(k, b)
   group by k
  on conflict (uid, key) do update
    set bytes = greatest(sr.bytes, excluded.bytes),
        expires_at = greatest(sr.expires_at, excluded.expires_at);

  return jsonb_build_object('ok', true, 'used', v_used + v_new);
end;
$$;

revoke all on function public.reserve_storage(text[], bigint[], bigint, bigint, int) from public;
grant execute on function public.reserve_storage(text[], bigint[], bigint, bigint, int) to authenticated;

/* ================= 確認クエリ ================= */
-- 実行後、残っている予約(通常は0〜数件、10分で自然に消える):
--   select uid, key, bytes, expires_at from public.storage_reservations order by expires_at;

-- ============================================================================
-- # 0031_purchase_currency.sql — 購入をどの通貨で課金したか記録する
-- ============================================================================
-- Why this must land before the first sale: the ledger stores only
-- `amount_jpy` (a legacy column name that has held USD *cents* since the
-- 2026-07-24 USD switch), and the webhook throws `session.currency` away.
-- Stripe Managed Payments / Adaptive Pricing can present the buyer their local
-- currency, in which case `amount_total` comes back in THAT currency's smallest
-- unit — ¥500 and $5.00 both arrive as the integer 500. Mixed into one column
-- with no currency, the admin revenue total silently becomes meaningless, and
-- there is no way to separate the rows afterwards.
--
-- 前提: 0019_checkout.sql と 0028_capacity_clamp.sql が上に並んでいること
-- (この統合ファイルではその順序になっている)。

/* ================= 1. purchases.currency ================= */
-- ISO-4217, lowercase, as Stripe reports it. Existing rows (if any) predate
-- multi-currency and were all charged in USD.
alter table public.purchases
  add column if not exists currency text not null default 'usd';

/* ================= 2. RPC に通貨を通す ================= */
-- The 5-argument version is dropped rather than left alongside: an overload
-- that silently ignores the currency is exactly the bug this migration exists
-- to remove. これが 0019/0028 の5引数版を最終状態から取り除く1行。
drop function if exists public.record_capacity_purchase(text, uuid, uuid, int, int);

create or replace function public.record_capacity_purchase(
  p_session text,
  p_user uuid,
  p_gallery uuid,
  p_amount int,
  p_amount_jpy int,
  p_currency text
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
  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency)
  values (p_user, 'capacity', p_session, 'capacity_addon', p_amount_jpy,
          coalesce(nullif(lower(trim(p_currency)), ''), 'usd'))
  on conflict (user_id, kind, item_key) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- Same transaction as the insert. Clamp to 15 so concurrent checkouts can
  -- never raise the cap past what any layout can physically display.
  update public.galleries
     set work_cap = least(work_cap + p_amount, 15)
   where id = p_gallery
     and owner_id = p_user;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return 'no_gallery';
  end if;
  return 'applied';
end;
$$;

revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) from public;
revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) from anon;
revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) from authenticated;
grant execute on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) to service_role;

-- ============================================================================
-- # 0032_artwork_card.sql — 一覧用の中間サイズ(card.jpg)
-- ============================================================================
-- A mid-size derivative for browse surfaces (Explore cards, artist-page covers).
--
-- Why: those cards render around 330x210 CSS px, but they were being handed
-- `display.jpg` — up to 1600px on the long edge (measured: 141 KB for one card
-- on a real gallery). The 400px `thumb.jpg` we already generate is too small to
-- cover a card on a 2x screen without going soft, so neither existing size fits.
-- 800px does, at roughly a quarter of the bytes.
--
-- This column exists because the file cannot be assumed: every artwork uploaded
-- before this change has no card.jpg, and pointing an <img> at a 404 would break
-- the very surface we are trying to speed up. `false` simply means "fall back to
-- display.jpg", which is exactly today's behaviour — so old rows keep working
-- untouched and no backfill is required.

alter table public.artworks
  add column if not exists has_card boolean not null default false;

comment on column public.artworks.has_card is
  'True when {storage_path}/card.jpg (long edge 800) exists. False = use display.jpg.';

-- ============================================================================
-- # 0033_moderation.sql — 通報を「対応できる」ものにする＋芳名帳のON/OFF
-- ============================================================================
-- Reports were already readable by admins (0017 `reports_select_admin`) but there
-- was nowhere to record what was done about one, and no way to take a gallery
-- down short of the SQL Editor. The /admin page showed a count and nothing else.
--
-- Guestbooks were anonymous, unmoderated, and could not be switched off — the
-- owner could only delete entries after they appeared.

/* ================= 1. 通報に対応状態を持たせる ================= */
alter table public.reports
  add column if not exists status text not null default 'open';
alter table public.reports
  drop constraint if exists reports_status_check;
alter table public.reports
  add constraint reports_status_check check (status in ('open', 'actioned', 'dismissed'));
alter table public.reports
  add column if not exists handled_at timestamptz;
-- What the operator decided, for the audit trail a takedown dispute would need.
alter table public.reports
  add column if not exists handled_note text not null default '';

create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';

-- Admins may work the queue. Still no delete policy: a handled report is the
-- record that the decision was made, so it stays.
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports
  for update using (public.is_admin()) with check (public.is_admin());

/* ================= 2. 管理者による非公開化 ================= */
-- A function rather than a blanket admin UPDATE policy on galleries: taking a
-- gallery down is the ONE cross-user write an admin needs, and this is the only
-- thing it can do. Everything else about someone else's room stays untouchable.
create or replace function public.admin_set_gallery_public(p_gallery uuid, p_public boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if not public.is_admin() then
    raise exception 'admin_set_gallery_public: not authorised';
  end if;
  update public.galleries set is_public = p_public where id = p_gallery;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.admin_set_gallery_public(uuid, boolean) from public;
revoke all on function public.admin_set_gallery_public(uuid, boolean) from anon;
grant execute on function public.admin_set_gallery_public(uuid, boolean) to authenticated;

/* ================= 3. 芳名帳のON/OFF ================= */
-- Defaults to true so nothing changes for existing rooms.
alter table public.galleries
  add column if not exists guestbook_enabled boolean not null default true;

-- Enforced in the policy, not just the UI: hiding the form would still leave the
-- table writable by anyone who can craft a request.
-- 同名ポリシー(0008 の guestbook_insert_public)をここで置き換えるので、
-- 統合ファイルを通しで実行しても最終状態は guestbook_enabled を見る版だけになる。
drop policy if exists "guestbook_insert_public" on public.guestbook;
create policy "guestbook_insert_public"
  on public.guestbook for insert
  with check (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id and g.is_public and g.guestbook_enabled
    )
  );

-- ============================================================================
-- # 0034_frame_purchases.sql — 額(フレーム)を売れるようにする
-- ============================================================================
-- docs/DECISIONS 2026-07-29。
--
-- Themes and layouts could be sold since 0016/0019; frames could not — the
-- ledger's `kind` constraint had no value for them, so a frame purchase would
-- have been rejected by the database even though every other layer was ready.
-- Two places carry that vocabulary and BOTH have to learn 'frame', or the
-- webhook records nothing and the admin grant raises 'unknown entitlement kind':
--   1. purchases.kind — the check constraint (last set by 0019)
--   2. grant_entitlement() — its own hardcoded list (0022)
--
-- Nothing becomes paid by applying this. Every frame that exists today stays
-- free forever (lib/entitlements → FOREVER_FREE_FRAME_IDS); this only opens the
-- door for frames added later.

/* ================= 1. purchases.kind に 'frame' を足す ================= */
-- 上の 0019 が張った同名の制約を落として張り替える。統合ファイルを通しで
-- 実行したときに残るのは、この 'frame' 入りの版。
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check
  check (kind in ('theme', 'layout', 'frame', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room'));

/* ================= 2. 管理者の手動付与も 'frame' を受ける ================= */
-- Same body as 0022 with 'frame' added to the accepted kinds. Kept as a full
-- create-or-replace (not an ALTER) because that is the only way to change a
-- plpgsql function, and re-running it is safe. 引数の型が 0022 と同じなので、
-- 統合ファイルでは 0022 の版がこれに置き換わる(重複して残らない)。
create or replace function public.grant_entitlement(p_user uuid, p_kind text, p_item_key text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('theme', 'layout', 'frame', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room') then
    raise exception 'unknown entitlement kind: %', p_kind;
  end if;
  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy)
  values (p_user, p_kind, coalesce(p_item_key, ''), 'admin_grant', null)
  on conflict (user_id, kind, item_key) do nothing;
end;
$$;

-- 0022 already granted execute to authenticated (the is_admin() check inside is
-- what actually gates it); create or replace keeps those grants, and repeating
-- them is harmless.
revoke all on function public.grant_entitlement(uuid, text, text) from public;
grant execute on function public.grant_entitlement(uuid, text, text) to authenticated;

-- ============================================================================
-- # 0035_light_override.sql — 作品ごとの照明モード(DECISIONS 2026-07-30)
-- ============================================================================
-- 既存の4軸(額・マット・掛け方・キャプション)と同じ形の5軸目。
-- NULL = 部屋の既定(galleries.design_overrides の lightMode)に従う。
alter table placements add column if not exists light_override text;

-- ============================================================================
-- # 0036_main_room.sql — 複数展示室の玄関(ユーザー決定 2026-08-09)
-- 複数展示室（ユーザー決定 2026-08-09）— どの部屋が `/@username` の玄関かを持たせる。
--
-- 追加料金($25・15枠込み)で部屋を増やせるようにしたので、1人が複数の galleries 行を
-- 持つようになる。`/@username` は「メイン部屋」を描き、サブ部屋は `/@username/[slug]`。
-- どれがメインかを DB に持たないと、部屋を増やした瞬間に玄関がどの部屋か決まらない。
--
-- 後方互換: 既存行は is_main=false で入るので、下のバックフィルで**所有者ごとに最古の
-- 1室**を玄関にする。アプリ側の `mainRoomOf()` も「フラグが無ければ最古」にフォール
-- バックするため、0036 未適用のDBでも今までと同じ部屋が `/@username` に出る。
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. galleries.is_main ================= */
alter table public.galleries add column if not exists is_main boolean not null default false;

-- 1人につき玄関は1つだけ。部分ユニークなので false は何行あってもよい。
create unique index if not exists galleries_one_main_per_owner
  on public.galleries (owner_id) where is_main;

-- バックフィル: まだ誰も玄関を持っていない所有者について、最古の1室を玄関にする。
-- 再実行安全(既に玄関がある所有者は not exists で除外される)。
update public.galleries g
   set is_main = true
 where not g.is_main
   and not exists (
     select 1 from public.galleries o where o.owner_id = g.owner_id and o.is_main
   )
   and g.id = (
     select g2.id
       from public.galleries g2
      where g2.owner_id = g.owner_id
      order by g2.created_at asc, g2.id asc
      limit 1
   );

/* ================= 2. 玄関の切り替え ================= */
-- 部分ユニーク索引があるので「古い玄関を消す」と「新しい玄関を立てる」は同一
-- トランザクションでなければならない。クライアントの2回 update では、間に落ちると
-- 玄関ゼロになるか、順序次第で索引違反で弾かれる。
create or replace function public.set_main_room(p_gallery uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  -- security invoker なので RLS がそのまま効く = 自分の部屋しか見えない。
  select owner_id into v_owner from public.galleries where id = p_gallery;
  if v_owner is null then
    raise exception 'set_main_room: no such room';
  end if;

  update public.galleries set is_main = false
   where owner_id = v_owner and is_main and id <> p_gallery;
  update public.galleries set is_main = true
   where id = p_gallery;
end;
$$;

revoke all on function public.set_main_room(uuid) from public;
grant execute on function public.set_main_room(uuid) to authenticated;

/* ================= 3. 部屋数と初期キャパをDBで強制する ================= */
-- ここが無いと課金が守られない。`galleries` の insert は RLS 経由でブラウザから
-- 直接行われ、`createGallery` の枚数チェックはクライアントが渡した購入数を信じる
-- だけなので、**細工したクライアントは購入ゼロで部屋を無限に作れる**（しかも
-- 2室目以降は work_cap=15 で作られるので $3×10 のスロットまで一緒に付いてくる）。
-- 数えるのは購入台帳（kind='room' の行数）で、これは webhook しか書けない。
--
-- 初期キャパも同じ理由で縛る: 無料の1室目に work_cap=15 を入れた insert を送れば
-- 10枠を無料で得られる。1室目は PLAN.worksPerGallery(5)、それ以降は
-- MAX_WORKS_PER_ROOM(15) まで。※ここは**INSERT時の初期値**の話で、あとから
-- スロットを買って上げるのは record_capacity_purchase（15でクランプ済み）の仕事。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rooms int;
  v_bought int;
begin
  select count(*) into v_rooms from public.galleries where owner_id = new.owner_id;
  select count(*) into v_bought from public.purchases
   where user_id = new.owner_id and kind = 'room';

  -- 無料1室 + 購入ぶん。lib/limits.roomAllowance() と同じ式。
  if v_rooms >= 1 + v_bought then
    raise exception 'room allowance exceeded: % rooms, % purchased', v_rooms, v_bought
      using errcode = 'check_violation';
  end if;

  -- 1室目(=まだ部屋が無い)は5枠、それ以降は15枠まで。
  if new.work_cap is not null and new.work_cap > (case when v_rooms = 0 then 5 else 15 end) then
    raise exception 'work_cap % not allowed for a new room', new.work_cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists galleries_enforce_allowance on public.galleries;
create trigger galleries_enforce_allowance
  before insert on public.galleries
  for each row execute function public.enforce_room_allowance();

-- work_cap の引き上げは購入経路(record_capacity_purchase / admin付与)だけに許す。
-- あの関数は security definer なので**その内側では current_user が所有者ロール**に
-- なり、PostgREST 経由の直接 update だけが 'authenticated' / 'anon' で入ってくる。
--
-- ※ この関数は **security invoker でなければ意味が無い**。definer にすると
-- current_user が常に自分の所有者になるので `in ('authenticated','anon')` が
-- 永久に偽＝番人が素通りする（実際に definer で書いてしまい、ローカルの
-- Postgres 16 で「authenticated が work_cap を 3→15 に上げられる」ことを実測して
-- 気づいた。LESSONS 2026-08-09）。
create or replace function public.guard_work_cap_raise()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.work_cap > old.work_cap and current_user in ('authenticated', 'anon') then
    raise exception 'work_cap is raised by purchase only'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_guard_work_cap on public.galleries;
create trigger galleries_guard_work_cap
  before update of work_cap on public.galleries
  for each row execute function public.guard_work_cap_raise();

-- # 0037_placement_consent.sql — 他人の作品の無断掲載を塞ぐ(ユーザー指示 2026-08-09)
-- ============================================================================
-- placement を作れるのは ①自分が所有する作品 ②その部屋への受諾済み招待がある作品
-- のどちらかだけ。②が合同展示の土台になる。0001 の placements_owner_all を置き換える。
/* ================= 1. 招待 ================= */
create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  -- 招かれた作家。この人の作品が、この部屋に掛けられるようになる。
  artist_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (gallery_id, artist_id)
);

create index if not exists room_invites_artist_idx on public.room_invites (artist_id, status);

alter table public.room_invites enable row level security;

-- 部屋の所有者: 自分の部屋の招待を出す・見る・取り下げる。
-- **status は自分では動かせない**（受諾は作家の意思表示なので、招いた側が
-- 勝手に 'accepted' にできてはいけない）。update は下の作家向けポリシーだけが持つ。
drop policy if exists "room_invites_owner_manage" on public.room_invites;
create policy "room_invites_owner_manage"
  on public.room_invites for select using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "room_invites_owner_insert" on public.room_invites;
create policy "room_invites_owner_insert"
  on public.room_invites for insert with check (
    status = 'pending'
    and exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "room_invites_owner_delete" on public.room_invites;
create policy "room_invites_owner_delete"
  on public.room_invites for delete using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

-- 招かれた作家: 自分宛の招待を見る／受諾・辞退する（＝いつでも取り下げられる）。
drop policy if exists "room_invites_artist_read" on public.room_invites;
create policy "room_invites_artist_read"
  on public.room_invites for select using (artist_id = (select auth.uid()));

drop policy if exists "room_invites_artist_respond" on public.room_invites;
create policy "room_invites_artist_respond"
  on public.room_invites for update
  using (artist_id = (select auth.uid()))
  with check (artist_id = (select auth.uid()) and status in ('accepted', 'declined'));

/* ================= 2. placement に同意を要求する ================= */
-- 「その作品を掛けてよいか」を1箇所で答える述語。placement のポリシーと、下の
-- 取り下げトリガの両方がこれを読むので、条件が2箇所に分かれてドリフトしない。
create or replace function public.may_place_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- ① 部屋の所有者が、その作品の所有者でもある（今までの全ケースがこれ）
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
     where g.id = p_gallery and a.owner_id = g.owner_id
  ) or exists (
    -- ② 作品の所有者が、この部屋への招待を受諾している
    select 1
      from public.artworks a
      join public.room_invites i
        on i.gallery_id = p_gallery and i.artist_id = a.owner_id and i.status = 'accepted'
     where a.id = p_artwork
  );
$$;

revoke all on function public.may_place_artwork(uuid, uuid) from public;
grant execute on function public.may_place_artwork(uuid, uuid) to authenticated, service_role;

-- `using` は今までどおり「部屋の所有者」だけにする（**読みと削除は絞らない** —
-- 招待を取り下げた後に、残った placement を消せなくなってしまう）。
-- 絞るのは `with check` = 新しく入る値だけ。
drop policy if exists "placements_owner_all" on public.placements;
create policy "placements_owner_all"
  on public.placements for all
  using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
    and public.may_place_artwork(gallery_id, artwork_id)
  );

/* ================= 3. 取り下げたら壁から下りる ================= */
-- 受諾を取り消した（辞退に変えた・招待が消えた）のに作品が掛かったままなら、
-- 同意の意味が無い。作家が辞退した瞬間に、その部屋のその作家の placement を外す。
create or replace function public.drop_placements_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_gallery := old.gallery_id; v_artist := old.artist_id;
  else
    -- 受諾のままなら何もしない
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_gallery := new.gallery_id; v_artist := new.artist_id;
  end if;

  -- その部屋に掛かっている「この作家の作品」だけを外す。部屋の所有者自身の作品は
  -- ①で許されているので触らない。
  delete from public.placements p
   where p.gallery_id = v_gallery
     and exists (
       select 1 from public.artworks a
        where a.id = p.artwork_id
          and a.owner_id = v_artist
          and a.owner_id <> (select g.owner_id from public.galleries g where g.id = v_gallery)
     );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists room_invites_revoke on public.room_invites;
create trigger room_invites_revoke
  after update or delete on public.room_invites
  for each row execute function public.drop_placements_on_revoke();

/* ================= 4. 既存データの点検 ================= */
-- 既存の placement は全部「部屋の所有者＝作品の所有者」のはずだが、穴が空いていた
-- 期間があるので数えて報告する。0 以外が出たら、その部屋は**再公開のときに
-- upsert が弾かれる**（掛かったままにはならず、公開のやり直しで落ちる）ので、
-- どの行なのかを先に知りたい。
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
    join public.artworks a on a.id = p.artwork_id
   where a.owner_id <> g.owner_id
     and not exists (
       select 1 from public.room_invites i
        where i.gallery_id = p.gallery_id and i.artist_id = a.owner_id and i.status = 'accepted'
     );
  if v_bad > 0 then
    raise warning '0037: % placements reference an artwork the room owner does not own and has no accepted invite for. They stay visible but will be rejected on the next republish — review them.', v_bad;
  else
    raise notice '0037: no cross-owner placements found (expected).';
  end if;
end $$;

-- ============================================================================
-- # 0038_room_grade.sql — 無料枠のロンダリングを塞ぐ(ユーザー指示 2026-08-09)
-- ============================================================================
-- 「無料の1室を消して作り直すと5枠が15枠になる」を塞ぐ。等級(`slots_included`)を
-- 行に持ち、部屋数を作成順ではなく等級で数える。0036 の enforce_room_allowance を
-- 置き換える(同名・同シグネチャなので 0036 の版はこれに差し替わる)。
/* ================= 1. 等級の列 ================= */
alter table public.galleries add column if not exists slots_included boolean not null default false;

-- バックフィル: 所有者ごとに**最古の1室を無料枠**、それ以外を有料とする。0036〜0038 の
-- あいだに作られた部屋は「1室目=5枠 / 以降=15枠」で作られているので、作成順がその
-- ときの等級と一致する。既存の本番データは1人1室なので実質すべて無料枠になる。
update public.galleries g
   set slots_included = true
 where not g.slots_included
   and g.id <> (
     select g2.id from public.galleries g2
      where g2.owner_id = g.owner_id
      order by g2.created_at asc, g2.id asc
      limit 1
   );

/* ================= 2. 番人を等級ベースに差し替える ================= */
-- 0036 の enforce_room_allowance を置き換える（同名・同シグネチャなので、統合
-- ファイルでは 0036 の版がこれに置き換わり重複しない）。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_bought int;
begin
  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries where owner_id = new.owner_id;
  select count(*) into v_bought from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    -- 有料の部屋: 未使用の購入があるあいだだけ
    if v_paid >= v_bought then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_bought
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % exceeds the room maximum', new.work_cap
        using errcode = 'check_violation';
    end if;
  else
    -- 無料の部屋: 1人1つ
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    -- 無料枠は5枠から。ここを通せば「無料の1室目を15枠で insert する」で10枠が無料になる。
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- 0036 で作った before insert トリガをそのまま使う（関数の中身だけ差し替わる）。
drop trigger if exists galleries_enforce_allowance on public.galleries;
create trigger galleries_enforce_allowance
  before insert on public.galleries
  for each row execute function public.enforce_room_allowance();

/* ================= 3. 等級は後から書き換えられない ================= */
-- `slots_included` を false→true にできるなら、無料部屋を有料部屋に化かして
-- 購入枠を空け、もう1室作れてしまう。等級は作成時に決まったら固定。
-- work_cap と同じ作法で、購入経路（security definer）だけに許す。
create or replace function public.guard_room_grade()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slots_included is distinct from old.slots_included
     and current_user in ('authenticated', 'anon') then
    raise exception 'slots_included is fixed at creation'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_guard_grade on public.galleries;
create trigger galleries_guard_grade
  before update of slots_included on public.galleries
  for each row execute function public.guard_room_grade();

-- ============================================================================
-- # 0039_expo_subdomain.sql — 展示ごとのサブドメイン(ユーザー決定 2026-08-09)
-- 展示ごとのサブドメイン（ユーザー決定 2026-08-09）— `tokyo-expo.xibit360.art`
--
-- ワイルドカードは使えない。Vercel は `*.domain` の証明書を「ネームサーバーを Vercel に
-- 完全移管した場合のみ」発行し、`_acme-challenge` だけを NS 委任する回避策は公式に
-- 非推奨（自動更新が保証されない）。このゾーンは `cdn.xibit360.art` が R2 のカスタム
-- ドメイン（＝ゾーンが Cloudflare にあることが必須）で、CORS を直す Transform Rule も
-- 載っているので移管はできない。よって**サブドメインは1件ずつ実在のホストとして登録**し、
-- 通常の HTTP-01 証明書を貰う（`www` と同じ更新経路）。
--
-- 設計上の要点: **サブドメインは任意の別名**。展示は常に `/@ハンドル` で公開され、
-- サブドメインは canonical と配る先だけを変える。Vercel の1プロジェクト50ドメインという
-- 上限は「別名の数」の天井であって展示数の天井ではない ── 尽きても新しい展示は
-- `/@ハンドル` で普通に公開できる。
--
-- **この本は 0040 に置き換えられている**（パス方式に切り替えたので `subdomain` →
-- `expo_slug` に改名された）。履歴として残しつつ、**0040 を適用済みの環境では丸ごと
-- 何もしない**ようにしてある。素の DDL を並べていた版は、貼り直すと 0040 が改名した
-- `subdomain` を作り直し、0040 の改名条件（`expo_slug` が無いこと）を偽にして改名を
-- 空振りさせ、**空の `subdomain` が残った**（schema.sql を2回流すだけで再現。実測
-- 2026-08-09）。**後の番号が消したものを、前の番号が復活させてはいけない。**
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 本人は書き換えられない ================= */
-- サブドメインは**DNSとVercelの登録が伴って初めて機能する**ので、行だけ先に書き換え
-- られると「DBには入っているが届かない別名」ができ、canonical がそこを指してしまう
-- （＝検索に載るURLが死ぬ）。付与も剥奪も管理者経由に限る。
--
-- 0001 の `profiles_update_own` は列を絞っていないため、これは**そのポリシーの穴を
-- 塞ぐ追加のトリガ**。work_cap / slots_included と同じ作法で、`security invoker` に
-- して呼び手のロールを見る（definer にすると current_user が常に所有者になり素通りする
-- ── 実際に 0036 でやってしまった。LESSONS 2026-08-09）。
--
-- 関数と RPC の本体は plpgsql なので、列が無くても作成時には検査されない（実行時に
-- 解決される）。だから下の DO ブロックの外に置いてよい ── 0040 がどちらも drop する。
create or replace function public.guard_subdomain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.subdomain is distinct from old.subdomain
     and current_user in ('authenticated', 'anon') then
    raise exception 'subdomain is assigned by an administrator'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

/* ================= 2. profiles.subdomain ================= */
-- 展示（＝アカウント）1つにつき1つ。部屋はこの下のパスなので、多室でも1つで足りる。
-- 形式は部屋のパス（SLUG_RE）と同じ文字種で、3文字以上。lib/expoHost の
-- EXPO_SUBDOMAIN_RE と対で保つこと。
--
-- 列に触る DDL は**まとめて1つの DO ブロックに入れ、動的SQLで撃つ**。`expo_slug` が
-- あれば（＝0040 済みなら）何もせず抜ける。素の DDL のままだと、制約・索引・トリガが
-- それぞれ「列が無い」で落ちる（列を作らないようにした結果、実際に落ちた）。
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'expo_slug') then
    -- 0040 で改名済み。この本の仕事は終わっている。
    return;
  end if;

  execute 'alter table public.profiles add column if not exists subdomain text';

  if not exists (select 1 from pg_constraint where conname = 'profiles_subdomain_format') then
    execute 'alter table public.profiles add constraint profiles_subdomain_format '
         || 'check (subdomain is null or subdomain ~ ''^[a-z0-9-]{3,40}$'')';
  end if;

  -- 大文字小文字を区別せずユニーク（DNS は区別しないので、`Expo` と `expo` を
  -- 別物として持てると片方が届かない別名になる）。null は何行あってもよい。
  execute 'create unique index if not exists profiles_subdomain_key '
       || 'on public.profiles (lower(subdomain)) where subdomain is not null';

  execute 'drop trigger if exists profiles_guard_subdomain on public.profiles';
  execute 'create trigger profiles_guard_subdomain '
       || 'before update of subdomain on public.profiles '
       || 'for each row execute function public.guard_subdomain()';
end $$;

/* ================= 3. 管理者による付与・剥奪 ================= */
-- 予約語はアプリ側（lib/expoHost の RESERVED）が持ち、ここは最低限の形式だけ見る。
-- 二重に持つと片方だけ更新されて食い違うので、**一覧の正はアプリ側**。
create or replace function public.set_expo_subdomain(p_user uuid, p_subdomain text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  v_clean := nullif(lower(trim(coalesce(p_subdomain, ''))), '');
  if v_clean is not null and v_clean !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'invalid subdomain: %', p_subdomain;
  end if;

  update public.profiles set subdomain = v_clean where id = p_user;
  if not found then
    raise exception 'no such profile';
  end if;
end;
$$;

revoke all on function public.set_expo_subdomain(uuid, text) from public;
revoke all on function public.set_expo_subdomain(uuid, text) from anon;
grant execute on function public.set_expo_subdomain(uuid, text) to authenticated;


-- # 0040_expo_slug.sql — 展示のURLをパスへ(ユーザー決定 2026-08-09)
-- 展示のURLをサブドメインからパスへ（ユーザー決定 2026-08-09）— `/expo/{slug}`
--
-- 0039 はサブドメイン（`tokyo-expo.xibit360.art`）を入れたが、**展示ごとに Vercel の
-- ドメイン追加と Cloudflare の CNAME を毎回手で足す**必要があり、Hobby の
-- 1プロジェクト50ドメインという上限もある。運用の手間が展示数に比例して増えるので、
-- 公開URLは `xibit360.art/expo/{slug}` に切り替える（追加作業ゼロ・上限なし）。
--
-- ルート直下（`xibit360.art/{slug}`）にしなかった理由: ルートには既にアプリのルート
-- 14個と言語コード11個が居て、将来のルートとも衝突する。得るのは1階層ぶんの短さだけ。
--
-- 列は**そのまま使える**（必要なのは「展示ごとにユニークな名前」で、まさにそれ）。
-- 名前だけ実態に合わせて変える — パスを駆動するものが `subdomain` という名前のままだと
-- 後で読む人が必ず誤解する。ホスト解析のコードは `NEXT_PUBLIC_EXPO_DOMAIN` 未設定で
-- 切れる形で残してあるので、将来サブドメインをやるなら環境変数とDNSだけで戻せる。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
-- ※ 0039 を適用済みでも未適用でも、番号順に流せば同じ結果になる。

/* ================= 1. 列・制約・索引の改名 ================= */
do $$
begin
  -- 0039 を適用済み: 改名する
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'subdomain')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'expo_slug')
  then
    alter table public.profiles rename column subdomain to expo_slug;
  end if;
end $$;

-- 0039 を飛ばした環境のために、無ければ作る（改名済みならこれは空振り）
alter table public.profiles add column if not exists expo_slug text;

-- 取り残された `subdomain` の掃除。0039 の古い版を2回流した環境には、改名後に作り直された
-- **空の `subdomain`** が残っている（実測 2026-08-09）。**中身が入っているときは消さない** —
-- 消してよいと言い切れるのは「1行も値が無い」場合だけで、値があるならそれは改名が
-- 起きていない別の状態なので、人間が見るべき。
-- 列の存在確認と中身の確認は**分ける**。1つの IF にまとめると、PL/pgSQL が式を丸ごと
-- 計画する段で `subdomain` を解決しようとし、**列が無い環境（＝掃除の必要が無い環境）で
-- `column "subdomain" does not exist` で落ちる**（実測 2026-08-09）。
-- 中身の確認は動的SQLに逃がす。
do $$
declare
  v_used boolean;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'subdomain')
     and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'expo_slug')
  then
    execute 'select exists (select 1 from public.profiles where subdomain is not null)' into v_used;
    if not v_used then
      alter table public.profiles drop column subdomain;
    end if;
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_subdomain_format;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_expo_slug_format') then
    alter table public.profiles add constraint profiles_expo_slug_format
      check (expo_slug is null or expo_slug ~ '^[a-z0-9-]{3,40}$');
  end if;
end $$;

-- 大文字小文字を区別せずユニーク。URLのパスは区別しうるが、**区別する運用にすると
-- `Expo` と `expo` が別の展示になり、どちらが正なのか誰にも分からなくなる**ので、
-- サブドメインのときと同じく1つに畳む。
drop index if exists public.profiles_subdomain_key;
create unique index if not exists profiles_expo_slug_key
  on public.profiles (lower(expo_slug)) where expo_slug is not null;

/* ================= 2. 本人は書き換えられない（0039 と同じ理由） ================= */
-- 行だけ先に入ると canonical が実在しないURLを指す。付与も剥奪も管理者経由に限る。
-- `security invoker` でなければ意味が無い（definer だと current_user が常に所有者に
-- なって素通りする — 0036 で実際にやった。LESSONS 2026-08-09）。
create or replace function public.guard_expo_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expo_slug is distinct from old.expo_slug
     and current_user in ('authenticated', 'anon') then
    raise exception 'expo_slug is assigned by an administrator'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_subdomain on public.profiles;
drop function if exists public.guard_subdomain();
drop trigger if exists profiles_guard_expo_slug on public.profiles;
create trigger profiles_guard_expo_slug
  before update of expo_slug on public.profiles
  for each row execute function public.guard_expo_slug();

/* ================= 3. 管理者による付与・剥奪 ================= */
create or replace function public.set_expo_slug(p_user uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  v_clean := nullif(lower(trim(coalesce(p_slug, ''))), '');
  if v_clean is not null and v_clean !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'invalid expo slug: %', p_slug;
  end if;

  update public.profiles set expo_slug = v_clean where id = p_user;
  if not found then
    raise exception 'no such profile';
  end if;
end;
$$;

revoke all on function public.set_expo_slug(uuid, text) from public;
revoke all on function public.set_expo_slug(uuid, text) from anon;
grant execute on function public.set_expo_slug(uuid, text) to authenticated;

-- 0039 の版は名前ごと退場（引数の型が同じなので置き換えではなく削除が必要）
drop function if exists public.set_expo_subdomain(uuid, text);


-- # 0041_room_submissions.sql
-- 合同展示の招待を成立させる（ユーザー承認 2026-08-09）— 作家が「出す」形にする
--
-- 0037 で「受諾済みの招待がある作家の作品は掛けられる」ところまで作ったが、UIが作れない。
-- **主催者には招待した作家の作品を「見る」経路が無い**（`artworks` の select は「自分の」か
-- 「どこかの公開ギャラリーに掛かっている」の2つだけ）。招待した相手の未公開の作品は
-- 1件も見えないので、主催者が選ぶ画面は原理的に描けない。
--
-- 埋め方は2つあった:
--   ①主催者が引く（pull）: 招待した作家の**全作品**を主催者に読ませ、主催者が選ぶ
--   ②作家が出す（push）: 作家が**出す作品を選び**、その分だけ主催者に見える  ← これ（ユーザー承認）
-- ②を採る理由: ①は「合同展に誘われた」だけでライブラリ全部（習作・未発表・売れた作品）が
-- 他人に見える。展示に出すつもりの無いものまで見せるのは、招待の対価として重すぎる。
-- ②なら**見える範囲＝出すと決めた範囲**で一致する。
--
-- あわせて 0037 の②を締める: 「受諾済み招待がある」→「受諾済み招待があり、かつ**その作品が
-- 提出されている**」。理由は、招待は作家という単位、掛けるかどうかは作品という単位で、
-- 前者だけで後者を許すと**受諾した瞬間に自分の全作品が掛けられる状態になる**こと。
-- 見えないから安全、には寄りかからない（公開中の作品なら id は公開ページに載っている）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 提出（作家 → 部屋） ================= */
create table if not exists public.room_submissions (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (gallery_id, artwork_id)
);

-- 主催者の画面が「この部屋への提出」を引く向き。
create index if not exists room_submissions_gallery_idx
  on public.room_submissions (gallery_id, created_at);

alter table public.room_submissions enable row level security;

/* ---- 述語は関数に出す（RLSの無限再帰を避けるため） ----
 * 最初は各ポリシーの中に `exists (select 1 from public.artworks …)` と直接書いたが、
 * **`infinite recursion detected in policy for relation "room_submissions"` で
 * 全部落ちた**（scratch Postgres で実測 2026-08-09）。下の2の select ポリシーが
 * `artworks` に `room_submissions` を読ませるので、
 *   room_submissions のポリシー → artworks の RLS → room_submissions のポリシー → …
 * と環になる。**環のどちらかを RLS の外に出さないと切れない。**
 *
 * `security definer` はテーブルの所有者として実行され、所有者は RLS を通らない
 * （`force row level security` を付けていない限り）。0037 の `may_place_artwork` が
 * 既に同じ形なので、作法もそこに合わせる。`security invoker` にしてはいけない
 * ＝呼び手のまま実行すると再帰が戻ってくる（`guard_*` 系とは逆の理由で definer）。 */

-- その作品が自分のものか。
create or replace function public.owns_artwork(p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.artworks a
     where a.id = p_artwork and a.owner_id = (select auth.uid())
  );
$$;

-- 自分の作品を、受諾済みの招待がある部屋に出せるか。辞退したあとは false に戻るので、
-- **辞退後に出し直すことはできない**。
create or replace function public.may_submit_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_artwork(p_artwork) and exists (
    select 1 from public.room_invites i
     where i.gallery_id = p_gallery
       and i.artist_id = (select auth.uid())
       and i.status = 'accepted'
  );
$$;

-- その作品が「自分の部屋に提出されている」か（2の select ポリシー用）。
create or replace function public.artwork_submitted_to_my_room(p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.room_submissions s
      join public.galleries g on g.id = s.gallery_id
     where s.artwork_id = p_artwork
       and g.owner_id = (select auth.uid())
  );
$$;

-- **`anon` にも execute を渡す**。ここを `authenticated` だけにすると
-- **公開サイトが全滅する**（実測 2026-08-09）: RLS のポリシーは**問い合わせたロールと
-- して評価される**ので、下の `artworks_select_submitted_to_my_room` が載っている
-- `artworks` を未ログインの来場者が読むだけで
-- `permission denied for function artwork_submitted_to_my_room` になる。
-- ポリシーは OR で並ぶが、**評価をスキップしてはくれない**。
--
-- 渡しても漏れない: どれも `auth.uid()` を見るので、anon では常に false を返す。
revoke all on function public.owns_artwork(uuid) from public;
revoke all on function public.may_submit_artwork(uuid, uuid) from public;
revoke all on function public.artwork_submitted_to_my_room(uuid) from public;
grant execute on function public.owns_artwork(uuid) to anon, authenticated, service_role;
grant execute on function public.may_submit_artwork(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.artwork_submitted_to_my_room(uuid) to anon, authenticated, service_role;

-- 作家: 自分の作品を、**受諾済みの招待がある部屋にだけ**出せる。
drop policy if exists "room_submissions_artist_insert" on public.room_submissions;
create policy "room_submissions_artist_insert"
  on public.room_submissions for insert
  with check (public.may_submit_artwork(gallery_id, artwork_id));

-- 作家: 自分が出したものは**いつでも引っ込められる**（招待の受諾と対称）。
-- 招待の状態は見ない — 辞退したあとに取り下げられないと、行が残り続ける。
drop policy if exists "room_submissions_artist_delete" on public.room_submissions;
create policy "room_submissions_artist_delete"
  on public.room_submissions for delete using (public.owns_artwork(artwork_id));

drop policy if exists "room_submissions_artist_read" on public.room_submissions;
create policy "room_submissions_artist_read"
  on public.room_submissions for select using (public.owns_artwork(artwork_id));

-- 部屋の所有者: 自分の部屋への提出を見る。**書けない**（提出は作家の意思表示なので、
-- 主催者が代わりに出せてはいけない ── 0037 で status を主催者に触らせなかったのと同じ）。
-- `galleries` は `room_submissions` を読まないので、ここは環にならず直接書ける。
drop policy if exists "room_submissions_owner_read" on public.room_submissions;
create policy "room_submissions_owner_read"
  on public.room_submissions for select using (
    exists (
      select 1 from public.galleries g
       where g.id = gallery_id and g.owner_id = (select auth.uid())
    )
  );

/* ================= 1.5 招かれた作家が「どの展示か」を読める ================= */
-- `galleries` の select は 0001 で **所有者 or `is_public`** だけ。合同展示は**非公開の
-- あいだに準備する**のが普通なので、招かれた作家は招待の行は見えても
-- **部屋のタイトルも主催者も読めない** ＝「何に招かれたのか」が表示できない。
--
-- これも `security definer` 経由にする。`room_invites` のポリシーが `galleries` を読む
-- ので、`galleries` のポリシーに `room_invites` を直接書くと今度はそこで環になる。
create or replace function public.invited_to_room(p_gallery uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_invites i
     where i.gallery_id = p_gallery and i.artist_id = (select auth.uid())
  );
$$;

-- `anon` にも渡す（下の `galleries_select_invited` は `galleries` に載るので、
-- **未ログインの来場者が公開ギャラリーを開くだけでこの関数を通る**）。上の
-- `artwork_submitted_to_my_room` と同じ理由。anon では常に false。
revoke all on function public.invited_to_room(uuid) from public;
grant execute on function public.invited_to_room(uuid) to anon, authenticated, service_role;

-- 辞退したあとも読めるままにする（受諾し直せるわけではないが、履歴として
-- 「辞退した展示」を出せないと、受信箱から行が消えて何が起きたのか分からなくなる）。
drop policy if exists "galleries_select_invited" on public.galleries;
create policy "galleries_select_invited"
  on public.galleries for select using (public.invited_to_room(id));

/* ================= 2. 主催者が提出された作品を読める ================= */
-- これが無いと、提出の行は見えても**作品の中身（画像・タイトル・寸法）が読めない**ので
-- 選ぶ画面が描けない。範囲は「提出された作品」だけ ── 招待した作家の全作品ではない。
drop policy if exists "artworks_select_submitted_to_my_room" on public.artworks;
create policy "artworks_select_submitted_to_my_room"
  on public.artworks for select using (public.artwork_submitted_to_my_room(id));

/* ================= 3. 掛けてよいかの述語を締める ================= */
-- 0037 の②「受諾済み招待がある」に、**提出済み**を足す。①（自分の作品）は変えない
-- ので、合同展示より前の全ケースは今までどおり。
create or replace function public.may_place_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- ① 部屋の所有者が、その作品の所有者でもある（今までの全ケースがこれ）
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
     where g.id = p_gallery and a.owner_id = g.owner_id
  ) or exists (
    -- ② 作品の所有者がこの部屋への招待を受諾しており、かつ**その作品を出している**
    select 1
      from public.artworks a
      join public.room_invites i
        on i.gallery_id = p_gallery and i.artist_id = a.owner_id and i.status = 'accepted'
      join public.room_submissions s
        on s.gallery_id = p_gallery and s.artwork_id = a.id
     where a.id = p_artwork
  );
$$;

revoke all on function public.may_place_artwork(uuid, uuid) from public;
grant execute on function public.may_place_artwork(uuid, uuid) to authenticated, service_role;

/* ================= 4. 取り下げたら壁から下りる ================= */
-- 0037 が招待に対してやっていることを、提出に対してもやる。引っ込めたのに掛かったまま
-- なら、提出を選べる意味が無い。**その1点だけ**を外す（招待の取り下げは作家の作品を
-- まとめて外すが、こちらは作品単位）。
create or replace function public.drop_placement_on_unsubmit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 部屋の所有者自身の作品は①で許されているので触らない（提出の行があっても、
  -- それは主催者が自分の部屋に自分の作品を出したケースで、外す理由が無い）。
  delete from public.placements p
   where p.gallery_id = old.gallery_id
     and p.artwork_id = old.artwork_id
     and exists (
       select 1 from public.artworks a
        where a.id = old.artwork_id
          and a.owner_id <> (select g.owner_id from public.galleries g where g.id = old.gallery_id)
     );
  return old;
end;
$$;

drop trigger if exists room_submissions_unsubmit on public.room_submissions;
create trigger room_submissions_unsubmit
  after delete on public.room_submissions
  for each row execute function public.drop_placement_on_unsubmit();

/* ================= 5. 招待を取り下げたら提出も消える ================= */
-- 0037 の `drop_placements_on_revoke` は placement だけを消していた。提出の行が残ると、
-- **辞退したのに主催者からは作品が見えたまま**になる（2の select ポリシーは招待を見ない）。
-- 招待が消えた／辞退に変わった時点で、その作家のその部屋への提出も引き上げる。
create or replace function public.drop_placements_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_gallery := old.gallery_id; v_artist := old.artist_id;
  else
    -- 受諾のままなら何もしない
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_gallery := new.gallery_id; v_artist := new.artist_id;
  end if;

  -- その部屋に掛かっている「この作家の作品」だけを外す。部屋の所有者自身の作品は
  -- ①で許されているので触らない。
  delete from public.placements p
   where p.gallery_id = v_gallery
     and exists (
       select 1 from public.artworks a
        where a.id = p.artwork_id
          and a.owner_id = v_artist
          and a.owner_id <> (select g.owner_id from public.galleries g where g.id = v_gallery)
     );

  -- 提出も引き上げる（上で placement は消えているので、トリガの二重発火は無害）。
  delete from public.room_submissions s
   where s.gallery_id = v_gallery
     and exists (
       select 1 from public.artworks a
        where a.id = s.artwork_id and a.owner_id = v_artist
     );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

/* ================= 6. @ハンドルで招く ================= */
-- 招待は**ハンドルで指定する**（ユーザー承認 2026-08-09）。メールは持っていない相手も
-- 招けるが、**アカウントの有無を問い合わせられる**ようになってしまう（総当たりで
-- 「このメールは登録済み」が引ける）。ハンドルは `/@名前` として既に公開されている。
--
-- 関数にしたのは、`profiles` の select が `using (true)` でもクライアントから
-- 「ハンドル → id」を引いて insert する2往復になり、その間に相手がハンドルを変えると
-- 別人を招く事故が起きるため。1文で解決して入れる。
create or replace function public.invite_artist_by_handle(p_gallery uuid, p_handle text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_owner uuid;
  v_clean text;
  v_id uuid;
begin
  select g.owner_id into v_owner from public.galleries g where g.id = p_gallery;
  if v_owner is null then
    raise exception 'no such room';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your room';
  end if;

  -- `@` 付きで貼られても受ける（画面の見本が `@handle` なので必ず起きる）。
  v_clean := lower(trim(coalesce(p_handle, '')));
  v_clean := regexp_replace(v_clean, '^@+', '');
  if v_clean = '' then
    raise exception 'no handle given';
  end if;

  select p.id into v_artist from public.profiles p where lower(p.username) = v_clean;
  if v_artist is null then
    raise exception 'no such artist: %', p_handle;
  end if;
  if v_artist = v_owner then
    -- 自分の作品は①で掛かるので招待は不要。招くと「参加者に自分が並ぶ」ことになる。
    raise exception 'cannot invite yourself';
  end if;

  insert into public.room_invites (gallery_id, artist_id, status)
  values (p_gallery, v_artist, 'pending')
  -- **受諾済みは絶対に巻き戻さない**（pending に戻すと 0041 のトリガが提出も掛かって
  -- いる作品も引き上げる＝招き直しただけで展示が壊れる）。
  -- ただし**辞退された相手は招き直せる**必要がある: `do nothing` だけにすると、
  -- 一度断られた相手に声をかけ直す道が無く、**エラーも出ないまま何も起きない**
  -- （行は declined のまま、`may_submit_artwork` も false のまま。別視点レビュー指摘）。
  on conflict (gallery_id, artist_id) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.room_invites.status = 'declined'
  returning id into v_id;

  if v_id is null then
    -- `do update` の where が false（＝pending か accepted のまま）。既存の行を返す。
    select i.id into v_id from public.room_invites i
     where i.gallery_id = p_gallery and i.artist_id = v_artist;
  end if;
  return v_id;
end;
$$;

revoke all on function public.invite_artist_by_handle(uuid, text) from public;
revoke all on function public.invite_artist_by_handle(uuid, text) from anon;
grant execute on function public.invite_artist_by_handle(uuid, text) to authenticated;

/* ================= 7. 既存データの点検 ================= */
-- 3で述語を締めたので、**0037 の緩い条件で入っていた placement** が居ると次の再公開で
-- 弾かれる。0037 の時点では「受諾済み招待」だけで通っていたので、招待UIが無かった
-- 今日までは0件のはずだが、数えて報告する（本番に無いことを動作確認では出せない）。
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
    join public.artworks a on a.id = p.artwork_id
   where a.owner_id <> g.owner_id
     and not public.may_place_artwork(p.gallery_id, p.artwork_id);
  if v_bad > 0 then
    raise warning '0041: % placements would now fail the tightened consent check (accepted invite but the work was never submitted). They stay visible but will be rejected on the next republish — review them.', v_bad;
  else
    raise notice '0041: no placements affected by the tightened check (expected).';
  end if;
end $$;


-- # 0042_notifications.sql
-- 通知（ユーザー指示 2026-08-09「通知は作ろう / 招待もそうですが、いいねやゲストブックの
-- 書き込み、あとは新テーマ追加のお知らせなどですかね」）
--
-- 直接のきっかけは 0041 の招待に**気づく経路が無かった**こと。主催者は「送った」と
-- 思っているのに、相手はダッシュボードを開くまで知らない。
--
-- 設計の要点:
--   ①**行はDBが書く**（トリガ、`security definer`）。クライアントに insert を許すと
--     「他人に偽の通知を送る」経路になる。RLS の insert ポリシーは**1つも作らない**。
--   ②**中身は書いた時点の値を焼き込む**（`title`）。部屋名を変えたり作品を消したりした
--     あとでも、通知は「そのとき何が起きたか」の記録として読めなければ意味が無い。
--   ③**いいねは作品ごと・1日1件にまとめる**（`count`）。匿名なので1件ずつだと同じ文面が
--     並ぶだけで、伸びた作品が通知欄を埋めて招待や芳名帳が埋もれる。
--   ④**自分の行動では通知しない**（自分の作品に自分でいいね、自分の芳名帳に自分で記帳）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. 0041 の事故の修理（先に流す） ================= */
-- **0041 を適用済みの環境は、未ログインの来場者から公開サイトが見えなくなっている。**
-- 0041 が足した2つのポリシー（`galleries_select_invited` /
-- `artworks_select_submitted_to_my_room`）が呼ぶ関数の execute を `authenticated`
-- だけに渡していたため、`anon` が `galleries` や `artworks` を読むだけで
-- `permission denied for function invited_to_room` で落ちる。
--
-- **RLS のポリシーは問い合わせたロールとして評価される**（OR で並んでいても評価は
-- スキップされない）ので、**そのテーブルに到達できる全ロールに execute が要る**。
-- 渡しても漏れない: どれも `auth.uid()` を見るので anon では常に false。
--
-- 0041 のファイル自体も直したので、これから新しい環境に流す人には二重に効く（冪等）。
-- 実測で見つけた: 0041 のテスト35項目が**全部 `authenticated` で走っていた**
-- （LESSONS 2026-08-09）。
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'invited_to_room') then
    execute 'grant execute on function public.invited_to_room(uuid) to anon, authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'artwork_submitted_to_my_room') then
    execute 'grant execute on function public.artwork_submitted_to_my_room(uuid) to anon, authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'owns_artwork') then
    execute 'grant execute on function public.owns_artwork(uuid) to anon, authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'may_submit_artwork') then
    execute 'grant execute on function public.may_submit_artwork(uuid, uuid) to anon, authenticated, service_role';
  end if;
end $$;

/* ================= 1. 表 ================= */
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- 受け取る人。宛先であって「起こした人」ではない。
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('invite', 'invite_reply', 'submission', 'like', 'guestbook', 'announce')),
  -- 文脈。source が消えても通知は残るので **null 許容**（`on delete set null`）。
  gallery_id uuid references public.galleries (id) on delete set null,
  artwork_id uuid references public.artworks (id) on delete set null,
  /** 書いた時点の見出し（部屋名・作品名・お知らせのタイトル）。source を消しても
   *  読めるように焼き込む。 */
  title text not null default '',
  /** 本文。芳名帳のメッセージ、お知らせの本文。 */
  body text not null default '',
  /** 起こした人の表示名。芳名帳の署名や招待した作家など**すでに本人が名乗っている
   *  場面だけ**。いいねは匿名なので常に null（likes 表に user_id が無い＝そもそも
   *  持っていない）。 */
  actor_name text,
  /** まとめた件数（いいね・提出）。1件ずつのものは 1。 */
  count int not null default 1 check (count > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ベルが引く向き: 自分の新しい順。未読数は同じ索引で数えられる。
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
-- いいね・提出のまとめ先を探す向き（未読の同じ作品／同じ作家を1日単位で拾う）。
create index if not exists notifications_rollup_idx
  on public.notifications (user_id, kind, artwork_id, gallery_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- 本人だけが読む。
drop policy if exists "notifications_own_read" on public.notifications;
create policy "notifications_own_read"
  on public.notifications for select using (user_id = (select auth.uid()));

-- 既読にする・消す。**insert のポリシーは作らない** — 行を書くのはトリガと
-- 管理者RPC（どちらも definer）だけ。クライアントに insert を許すと、他人の宛先で
-- 偽の通知を作れる（「Xibit360からのお知らせ」を騙れる）。
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update"
  on public.notifications for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "notifications_own_delete" on public.notifications;
create policy "notifications_own_delete"
  on public.notifications for delete using (user_id = (select auth.uid()));

/* ================= 2. 書き込みの共通部 ================= */
-- 1件足す。`security definer` なので RLS を通らない（＝insert ポリシー無しで書ける）。
create or replace function public.push_notification(
  p_user uuid,
  p_kind text,
  p_gallery uuid,
  p_artwork uuid,
  p_title text,
  p_body text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 宛先が居ない（プロフィールが消えた等）なら黙って何もしない。通知の失敗で
  -- **本来の操作（いいね・記帳・招待）を失敗させてはいけない**。
  if p_user is null then return; end if;
  insert into public.notifications (user_id, kind, gallery_id, artwork_id, title, body, actor_name)
  values (p_user, p_kind, p_gallery, p_artwork, coalesce(p_title, ''), coalesce(p_body, ''), p_actor);
end;
$$;

revoke all on function public.push_notification(uuid, text, uuid, uuid, text, text, text) from public, anon, authenticated;

-- まとめて足す（いいね・提出）。**未読で・同じ種類・同じ対象・同じ日**の行があれば
-- 数を足して今の時刻に持ち上げ、無ければ1件作る。既読の行には足さない（読んだあとの
-- 新しい動きは新しい通知として出るべき）。
-- まとめの鍵は (宛先, 種類, 部屋, 作品, **起こした人**, その日)。`actor` も鍵に入れる
-- のが要点: 提出を部屋だけでまとめると、同じ日に2人が出したときに1件に畳まれて
-- **誰が出したのか分からなくなる**（主催者にとっては、それが一番知りたい部分）。
create or replace function public.push_notification_rollup(
  p_user uuid,
  p_kind text,
  p_gallery uuid,
  p_artwork uuid,
  p_title text,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null then return; end if;

  select n.id into v_id
    from public.notifications n
   where n.user_id = p_user
     and n.kind = p_kind
     and n.read_at is null
     and n.artwork_id is not distinct from p_artwork
     and n.gallery_id is not distinct from p_gallery
     and n.actor_name is not distinct from p_actor
     and n.created_at >= date_trunc('day', now())
   order by n.created_at desc
   limit 1;

  if v_id is null then
    insert into public.notifications (user_id, kind, gallery_id, artwork_id, title, actor_name)
    values (p_user, p_kind, p_gallery, p_artwork, coalesce(p_title, ''), p_actor);
  else
    update public.notifications
       set count = count + 1, created_at = now()
     where id = v_id;
  end if;
end;
$$;

revoke all on function public.push_notification_rollup(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
-- 0042 の途中で引数を足したので、5引数版が残っていれば消す（同名の別シグネチャが
-- 並ぶと `perform` がどちらを呼ぶか曖昧になる）。
drop function if exists public.push_notification_rollup(uuid, text, uuid, uuid, text);

/* ================= 3. いいね ================= */
-- 宛先は**作品の所有者**（部屋の所有者ではない）。合同展示では他人の部屋に掛かって
-- いても「あなたの作品がいいねされた」のは作家本人の話。部屋の側の数字は
-- ダッシュボードのメーターが持っている。
create or replace function public.notify_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
begin
  select a.owner_id, a.title into v_owner, v_title
    from public.artworks a where a.id = new.artwork_id;

  -- 自分の作品に自分でいいねしたときは通知しない。likes は匿名（user_id が無い）ので
  -- 「押した人」は分からないが、**ログイン中の本人**なら auth.uid() で分かる。
  if v_owner is not null and v_owner is distinct from (select auth.uid()) then
    perform public.push_notification_rollup(v_owner, 'like', new.gallery_id, new.artwork_id, v_title);
  end if;
  return new;
end;
$$;

drop trigger if exists likes_notify on public.likes;
create trigger likes_notify
  after insert on public.likes
  for each row execute function public.notify_like();

/* ================= 4. 芳名帳 ================= */
-- 1件ずつ通知する（数が少なく、1件ごとに読む価値のある本文がある）。署名は来場者が
-- 自分で名乗った名前で、**公開ページに既に出ている**ので通知に載せてよい。
create or replace function public.notify_guestbook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
begin
  select g.owner_id, g.title into v_owner, v_title
    from public.galleries g where g.id = new.gallery_id;

  if v_owner is not null and v_owner is distinct from (select auth.uid()) then
    perform public.push_notification(
      v_owner, 'guestbook', new.gallery_id, null, v_title, new.message,
      nullif(new.name, '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists guestbook_notify on public.guestbook;
create trigger guestbook_notify
  after insert on public.guestbook
  for each row execute function public.notify_guestbook();

/* ================= 5. 招待（0037/0041） ================= */
-- 招かれた作家へ。**これが今回の発端** — 0041 まで、招待に気づく経路が無かった。
create or replace function public.notify_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room text;
  v_owner uuid;
  v_organizer text;
begin
  select g.title, g.owner_id into v_room, v_owner
    from public.galleries g where g.id = new.gallery_id;
  select coalesce(p.display_name, p.username) into v_organizer
    from public.profiles p where p.id = v_owner;

  perform public.push_notification(
    new.artist_id, 'invite', new.gallery_id, null, coalesce(v_room, ''), '', v_organizer
  );
  return new;
end;
$$;

drop trigger if exists room_invites_notify on public.room_invites;
create trigger room_invites_notify
  after insert on public.room_invites
  for each row execute function public.notify_invite();

-- 受諾・辞退を**主催者へ**返す。招いたまま返事を待つ側にも通知が要る（辞退は特に:
-- 気づかないと空いた枠を埋め直せない）。
create or replace function public.notify_invite_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room text;
  v_owner uuid;
  v_artist text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted', 'declined') then return new; end if;

  select g.title, g.owner_id into v_room, v_owner
    from public.galleries g where g.id = new.gallery_id;
  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = new.artist_id;

  -- 本文に状態を入れる（`accepted` / `declined`）。表示側が文言を選ぶための値で、
  -- 画面に出す英語ではない。
  perform public.push_notification(
    v_owner, 'invite_reply', new.gallery_id, null, coalesce(v_room, ''), new.status, v_artist
  );
  return new;
end;
$$;

drop trigger if exists room_invites_reply_notify on public.room_invites;
create trigger room_invites_reply_notify
  after update of status on public.room_invites
  for each row execute function public.notify_invite_reply();

/* ================= 6. 提出（0041） ================= */
-- 主催者へ。作家は複数点まとめて出すので**作家ごと・1日1件にまとめる**。
create or replace function public.notify_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_room text;
  v_artist_id uuid;
  v_artist text;
begin
  select g.owner_id, g.title into v_owner, v_room
    from public.galleries g where g.id = new.gallery_id;
  select a.owner_id into v_artist_id
    from public.artworks a where a.id = new.artwork_id;

  -- 部屋の所有者が自分の作品を出した（自分の部屋への提出）ときは通知しない。
  if v_owner is null or v_owner is not distinct from v_artist_id then return new; end if;

  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = v_artist_id;

  -- まとめの鍵は (部屋, 作家)。作家は `actor_name` で持つので、同じ日に2人が出しても
  -- 2件に分かれる（1件に畳むと誰が出したのか分からなくなる）。
  perform public.push_notification_rollup(
    v_owner, 'submission', new.gallery_id, null, coalesce(v_room, ''), v_artist
  );
  return new;
end;
$$;

drop trigger if exists room_submissions_notify on public.room_submissions;
create trigger room_submissions_notify
  after insert on public.room_submissions
  for each row execute function public.notify_submission();

/* ================= 7. お知らせ（管理者） ================= */
-- 新しいテーマの追加など。**全員に1行ずつ配る**（fan-out）。
--
-- 「お知らせ表 + profiles.announcements_seen_at」でも作れて行数は1件で済むが、
-- 未読の数え方が2系統に分かれる（配られた通知と、まだ読んでいないお知らせ）。
-- 利用者数がまだ小さいので、**1つの通知欄・1つの未読数**を保つ方を採る。
-- 効いてくるのは利用者が数万人になったときで、そのときは配るのをやめて
-- seen_at 方式に寄せる（この関数の中だけを書き換えれば済む）。
--
-- 文面は**書いた言語のまま全員に出る**。お知らせはUI文言ではなく「中身」なので、
-- 記事（/articles）と同じ扱い＝`check:i18n` の対象外。
create or replace function public.broadcast_announcement(p_title text, p_body text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'title required';
  end if;

  insert into public.notifications (user_id, kind, title, body)
  select p.id, 'announce', trim(p_title), coalesce(p_body, '')
    from public.profiles p;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.broadcast_announcement(text, text) from public, anon;
grant execute on function public.broadcast_announcement(text, text) to authenticated;

/* ================= 8. 既読 ================= */
-- 1件ずつ update するより、開いたときに**まとめて既読**にしたい。RLS の update
-- ポリシーで本人の行だけに絞れているので、これは利便のための関数。
create or replace function public.mark_notifications_read()
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where user_id = (select auth.uid()) and read_at is null;
$$;

grant execute on function public.mark_notifications_read() to authenticated;


-- # 0043_admin_add_room.sql — 管理者の「展示室を追加」で部屋を実際に作る(ユーザー指示 2026-08-09)
-- 管理者が「展示室を追加」したら**部屋が実際に増える**ようにする
-- （ユーザー指示 2026-08-09「adminで展示室追加は、部屋がちゃんと追加されるようにして欲しい」）。
--
-- これまでの `grant_entitlement(kind => 'room')` は購入台帳に1行入れるだけで、
-- **枠が開くが部屋はできない**（作るのは本人が /me で「新しい部屋をつくる」を押したとき）。
-- 管理者から見ると「追加したのに増えない」ので、台帳と部屋を1回で作る RPC を用意する。
--
-- 設計:
--   ・**台帳→部屋の順で、1トランザクション**（関数呼び出しは暗黙に1トランザクション）。
--     逆順だと 0038 の `enforce_room_allowance` が「購入が無いのに部屋が増えた」と
--     判断して弾く。
--   ・部屋は**有料等級**（`slots_included = true` / `work_cap = 15`）で作る。$25 の部屋
--     購入と同じものを配るため。0038 の `guard_room_grade` は作成後の書き換えを禁じるので、
--     **insert の時点で正しく置く**しかない。
--   ・slug は空いている名前を選ぶ（`room-2`, `room-3`, …）。`unique (owner_id, slug)` に
--     ぶつかると失敗するので、既にある番号は飛ばす。
--   ・**冪等にしない**。「もう1室ふやす」は押した回数だけ増えるのが期待どおりで、
--     `on conflict do nothing` にすると2回目が黙って無視される。台帳の `item_key` は
--     毎回ちがう値にする。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.admin_add_room(p_user uuid, p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_n int;
  v_id uuid;
  v_title text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such profile';
  end if;

  -- ① 台帳に1行。**部屋を作る前**に入れる（0038 の番人が購入数を数えるので、
  --    順番が逆だと自分の insert が弾かれる）。`item_key` は毎回ちがう値にして、
  --    0034 の `on conflict (user_id, kind, item_key)` で2回目が消えないようにする。
  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy)
  values (p_user, 'room', 'admin-' || gen_random_uuid()::text, 'admin_grant', null);

  -- ② 空いている slug を探す。`room-2` から順に見る（1室目は `main` など既存の名前）。
  v_n := 2;
  loop
    v_slug := 'room-' || v_n;
    exit when not exists (
      select 1 from public.galleries g where g.owner_id = p_user and g.slug = v_slug
    );
    v_n := v_n + 1;
    if v_n > 100 then
      raise exception 'could not find a free slug for this owner';
    end if;
  end loop;

  v_title := nullif(trim(coalesce(p_title, '')), '');

  -- ③ 部屋。**有料等級で作る**（`slots_included = true` / `work_cap = 15`）。
  --    あとから引き上げる経路は 0038 の番人が閉じているので、ここで正しく置く。
  insert into public.galleries (owner_id, slug, title, slots_included, work_cap)
  --    題名の既定は `'My Gallery'`。アプリの `isPlaceholderTitle()` がこれを「未命名」と
  --    見るので、ダッシュボードのタブには題名ではなく slug（`room-2`）が出る ──
  --    **管理者が付けた仮の名前が作家の展示名として公開されるのを避ける**。日本語の
  --    既定値を入れないのも同じ理由（利用者の言語は分からない）。
  values (p_user, v_slug, coalesce(v_title, 'My Gallery'), true, 15)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_add_room(uuid, text) from public, anon;
grant execute on function public.admin_add_room(uuid, text) to authenticated;


-- # 0044_expos.sql — 合同展示(Expo)の土台。会期・場所代・独立URL(ユーザー決定 2026-08-09)
-- 合同展示（Expo）の土台（ユーザー決定 2026-08-09。DECISIONS 2026-08-09 に全文）
--
-- 形: **通常展示と完全に別の実体**。`xibit360.art/expo/{name}` で開き、**会期**があり、
-- **主催者が公開時に場所代を払う**（7日 $15 / 14日 $25 / 30日 $40）。参加作家は無料。
--
-- 部屋（`galleries`）とは別の表にしたのは、会期・支払い・参加者が「展示全体」の属性で
-- 1つの部屋の属性ではないから。合同展示は部屋を1つ以上ぶら下げる。
--
-- 設計の要点（どれも過去に踏んだ失敗から来ている）:
--   ①**見える/見えないは日付から導出する。** 旗を別に持つと、削除ジョブが止まったときに
--     会期切れが公開され続ける。`is_public` のような自由な旗を置かない。
--   ②**公開と支払いは同じ1つの操作**（`record_expo_purchase`）。分けると「払ったのに
--     公開されていない」「公開されたのに払っていない」の窓ができる。クライアントから
--     公開できる経路は作らない ── 0036 で「上限の材料をクライアントが渡していた」のと
--     同じ失敗を繰り返さない。
--   ③**合同展示の部屋は主催者の部屋枠（$25）を消費しない。** 場所代で払っているので
--     二重取りになる。0038 の番人を「合同展示の部屋は数えない」に差し替える。
--   ④**猶予が過ぎたら行ごと消す**（ユーザー判断）。消えれば名前も空くので、同じURLで
--     次の会期を立てられる。消えるのは展示・部屋・配置だけで、**参加作家の作品は
--     各自のライブラリに残る**（`placements` は作品を参照するだけ）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 会期の長さ（値はここが正） ================= */
-- lib/pricing の PRICE_USD_CENTS.expo* と対で保つ。DBを正にしているのは、
-- **価格と会期をクライアントに決めさせない**ため（②の理由）。
create or replace function public.expo_days_allowed(p_days int)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_days in (7, 14, 30) $$;

/* ================= 2. 表 ================= */
create table if not exists public.expos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  /** URL の名前。`/expo/{slug}` で開く。部屋の slug と同じ文字種。 */
  slug text not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  title text not null default '',
  statement text not null default '',
  /** 会期の長さ。支払い時に確定する（それまでは主催者が選び直せる）。 */
  duration_days int not null default 14 check (public.expo_days_allowed(duration_days)),
  /**
   * 会期の開始。**支払いが通った瞬間に入る**（`record_expo_purchase`）。
   * null = まだ公開していない下書き。
   */
  starts_at timestamptz,
  /**
   * 会期の終わり。**開始と長さから導出**され、手で動かせない（下の
   * `expos_set_ends` トリガが insert/update のたびに無条件で上書きする）。
   *
   * 生成列（`generated always as`）にしたかったが、`timestamptz + interval` は
   * immutable ではない（タイムゾーン設定に依る）ので Postgres が拒否する。
   * トリガで**必ず上書きする**なら、誰がどんな値を入れても残らないので同じ性質になる。
   */
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- 名前は**生きている展示のあいだだけ**一意。猶予後に行を消すと自動で空くので、
-- 同じ名前で次の会期を立てられる（ユーザー要望）。大文字小文字は区別しない。
create unique index if not exists expos_slug_key on public.expos (lower(slug));
create index if not exists expos_owner_idx on public.expos (owner_id, created_at desc);
-- 掃除ジョブが引く向き（終わった会期を古い順に）。
create index if not exists expos_ends_idx on public.expos (ends_at) where starts_at is not null;

/* ================= 3. 部屋を紐づける ================= */
alter table public.galleries add column if not exists expo_id uuid
  references public.expos (id) on delete cascade;
create index if not exists galleries_expo_idx on public.galleries (expo_id) where expo_id is not null;

-- 会期の終わりを常に導出する。**無条件に上書き**するので、クライアントが値を入れても
-- 主催者が update しても残らない（生成列の代わり）。
create or replace function public.expos_set_ends()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.ends_at := new.starts_at + make_interval(days => new.duration_days);
  return new;
end;
$$;

drop trigger if exists expos_set_ends on public.expos;
create trigger expos_set_ends
  before insert or update on public.expos
  for each row execute function public.expos_set_ends();

/* ================= 4. 猶予（会期後もURLが生きている日数） ================= */
create or replace function public.expo_grace_days()
returns int
language sql
immutable
set search_path = ''
as $$ select 7 $$;

/**
 * その展示が**いま来場者に見えるか**。日付だけから決まる（旗を見ない）。
 * 会期中は本編、会期後の猶予中も true（表示側が「終了しました」と出す）。
 */
create or replace function public.expo_is_live(p_starts timestamptz, p_ends timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_starts is not null
     and now() >= p_starts
     and now() < p_ends + make_interval(days => public.expo_grace_days())
$$;

/** 会期が終わっているか（猶予中はこれが true で、まだ見える）。 */
create or replace function public.expo_has_ended(p_ends timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$ select p_ends is not null and now() >= p_ends $$;

/* ================= 5. RLS ================= */
alter table public.expos enable row level security;

-- 主催者は自分の展示を全部触れる（題名・名前・会期の選び直しなど）。
drop policy if exists "expos_owner_all" on public.expos;
create policy "expos_owner_all"
  on public.expos for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 来場者は**見えている展示だけ**読める。未公開の下書きは他人から見えない。
drop policy if exists "expos_select_live" on public.expos;
create policy "expos_select_live"
  on public.expos for select
  using (public.expo_is_live(starts_at, ends_at));

drop policy if exists "expos_select_admin" on public.expos;
create policy "expos_select_admin"
  on public.expos for select using (public.is_admin());

/* ================= 6. お金と日付は本人にも書かせない ================= */
-- `expos_owner_all` は列を絞れないので、**追加のトリガで金額に関わる列を守る**
-- （work_cap / slots_included と同じ作法）。`security invoker` にして呼び手のロールを
-- 見る ── definer にすると current_user が常に所有者になり素通りする（0036 で実際に
-- やってしまった。LESSONS 2026-08-09）。
create or replace function public.guard_expo_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- 開始日は支払いが決める。ここを書けると**無料で公開できる**。
    if new.starts_at is distinct from old.starts_at then
      raise exception 'starts_at is set by the payment' using errcode = 'check_violation';
    end if;
    -- 会期の長さは**公開後は動かせない**（払った長さと違う会期になる）。公開前は自由。
    if old.starts_at is not null and new.duration_days is distinct from old.duration_days then
      raise exception 'duration cannot change once the run has started' using errcode = 'check_violation';
    end if;
    -- 名前も公開後は動かせない（配ったURLが死ぬ）。
    if old.starts_at is not null and new.slug is distinct from old.slug then
      raise exception 'slug cannot change once the run has started' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expos_guard_run on public.expos;
create trigger expos_guard_run
  before update on public.expos
  for each row execute function public.guard_expo_run();

/* ================= 7. 部屋枠を消費しない ================= */
-- 0038 の `enforce_room_allowance` を差し替える。差分は**合同展示の部屋を数えない**
-- 1点だけ（`where expo_id is null` と、insert が expo の部屋なら素通り）。
-- 場所代を払っているのに $25 の枠まで減るのは二重取り。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_purchased int;
begin
  -- **合同展示の部屋は勘定の外**。会期の場所代で払っている。
  if new.expo_id is not null then
    return new;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = new.owner_id
     and expo_id is null;

  select count(*) into v_purchased
    from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    if v_paid >= v_purchased then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_purchased
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
  else
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

/* ================= 8. 台帳が 'expo' を受ける ================= */
-- 0034 の版に 'expo' を足した全文（`check` は差分更新できないので毎回書き直す）。
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check
  check (kind in ('theme', 'layout', 'frame', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room', 'expo'));

/* ================= 9. 支払い＝公開（service role だけ） ================= */
/**
 * 場所代の記録と公開を**1つの操作**で行う。Stripe webhook からだけ呼ぶ。
 *
 * 分けない理由: 「払ったのに公開されていない」「公開されたのに払っていない」の窓を
 * 作らないため。**クライアントから公開できる経路は存在しない**（`guard_expo_run` が
 * `starts_at` を守り、この関数は service role にしか渡していない）。
 *
 * 会期の長さは**引数で受けて上書きする** — 決済セッションを作った時点の長さが正で、
 * その間に主催者が選び直していても、払った長さで会期を切る。
 *
 * 同じセッションidで2回来ても1回しか効かない（webhook の再送はふつうに起きる）。
 */
create or replace function public.record_expo_purchase(
  p_session text,
  p_user uuid,
  p_expo uuid,
  p_days int,
  p_amount int,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.expo_days_allowed(p_days) then
    raise exception 'unsupported run length: % days', p_days;
  end if;

  select owner_id into v_owner from public.expos where id = p_expo;
  if v_owner is null then
    raise exception 'no such expo';
  end if;
  if v_owner is distinct from p_user then
    raise exception 'expo does not belong to this user';
  end if;

  -- 再送で2回入らないように、セッションidを鍵にする（0019/0031 と同じ作法）。
  if exists (select 1 from public.purchases where kind = 'expo' and sku = p_session) then
    return;
  end if;

  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency)
  values (p_user, 'expo', p_expo::text, p_session, p_amount, p_currency);

  -- **ここで初めて公開される。** すでに会期が始まっていれば触らない（延長は別の話）。
  update public.expos
     set duration_days = p_days,
         starts_at = now()
   where id = p_expo and starts_at is null;
end;
$$;

revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text) from public;
revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text) from anon;
revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text) from authenticated;
grant execute on function public.record_expo_purchase(text, uuid, uuid, int, int, text) to service_role;

/* ================= 10. 猶予後の掃除 ================= */
/**
 * 会期＋猶予を過ぎた展示を消す。**部屋と配置は cascade で一緒に消え、作品は残る**
 * （`placements` は作品を参照するだけなので、参加作家のライブラリは無傷）。
 *
 * 下書き（`starts_at is null`）は消さない。主催者のものだし、公開していないので
 * 誰にも見えていない。
 *
 * 戻り値は消した件数。
 */
create or replace function public.purge_expired_expos()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.expos
   where starts_at is not null
     and now() >= ends_at + make_interval(days => public.expo_grace_days());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_expired_expos() from public, anon, authenticated;
grant execute on function public.purge_expired_expos() to service_role;

-- 毎日1回。**pg_cron が有効でなければ何もしない**（migration を失敗させない）。
-- 有効化は Supabase の Dashboard → Database → Extensions で `pg_cron` を on にする
-- 1回だけの作業。まだなら下の NOTICE が出るので、有効にしてからこの本を流し直す。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-expos')
      where exists (select 1 from cron.job where jobname = 'purge-expired-expos');
    perform cron.schedule('purge-expired-expos', '17 3 * * *', 'select public.purge_expired_expos()');
  else
    raise notice 'pg_cron が無効なので掃除ジョブを登録していません。Dashboard → Database → Extensions で有効にしてから、この migration を流し直してください（それまで期限切れの展示は日付で非表示になるだけで、行は残ります）。';
  end if;
end $$;


-- # 0045_expo_public_read.sql — 合同展示を会期のあいだだけ専用URLで見せる(ユーザー決定 2026-08-09)
-- 合同展示を「会期のあいだだけ、専用URLでだけ」見せる（ユーザー決定 2026-08-09 の続き）
--
-- 0044 で `expos` と `galleries.expo_id` を作ったが、**公開の読み経路が足りていなかった**。
-- 合同展示の部屋は主催者が所有する `galleries` の行なので、既存のポリシー
-- （`galleries_select_public` = `using (is_public)`）のままだと2つ問題が起きる:
--
--   ①**会期の外・支払い前でも見えてしまう。** 主催者が部屋の公開スイッチを入れれば、
--     場所代を払う前から誰でも読める（そして `/@ハンドル/{slug}` と `/explore` にも出る）。
--     ＝「会期のあいだだけ公開」という約束が守られない。
--   ②**合同展示が主催者の個人展示に混ざる。** 「通常の展示とは完全に別」という要件に反する。
--
-- 直し方:
--   ・`galleries_select_public` を `is_public and expo_id is null` に締める
--     （＝**合同展示の部屋は通常の公開経路から出さない**）
--   ・合同展示の部屋は「その展示の会期が生きているか」だけで決める新しいポリシーで開ける
--   ・作品と配置も同じ条件で開ける（既存のポリシーは `is_public` しか見ていない）
--
-- **`anon` に execute を渡すのを忘れないこと。** ポリシーの中で呼ぶ関数の実行権限を
-- `authenticated` だけにすると、未ログインの来場者が読むだけで
-- `permission denied for function` になり**公開サイトが全滅する**（0041 で実際にやった。
-- LESSONS 2026-08-09）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. ポリシーで使う述語の実行権限 ================= */
-- 0044 で作った関数。**ポリシーから呼ぶので anon にも渡す**（渡しても漏れない:
-- 引数の日付だけで決まり、行は読まない）。
grant execute on function public.expo_is_live(timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.expo_has_ended(timestamptz) to anon, authenticated, service_role;
grant execute on function public.expo_grace_days() to anon, authenticated, service_role;

/**
 * その部屋が「会期の生きている合同展示の部屋」か。
 *
 * `security definer` にしてあるのは、来場者が `expos` を直接読めなくても判定できるように
 * するため（`expos` の RLS は「見えている展示だけ」なので今回は等価だが、あとで
 * `expos` 側を締めてもこの判定は壊れない）。**読むのは会期の日付だけ**で、行の中身は返さない。
 */
create or replace function public.gallery_in_live_expo(p_gallery uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.galleries g
      join public.expos x on x.id = g.expo_id
     where g.id = p_gallery
       and public.expo_is_live(x.starts_at, x.ends_at)
  )
$$;

revoke all on function public.gallery_in_live_expo(uuid) from public;
grant execute on function public.gallery_in_live_expo(uuid) to anon, authenticated, service_role;

/* ================= 1. 部屋 ================= */
-- **合同展示の部屋は `is_public` を持てない。** 見え方を決めるのは会期だけ。
--
-- なぜポリシーだけでは足りないか: RLS のポリシーは OR で足されるので、会期中は
-- `galleries_select_expo_live` が読ませる。そのうえで**アプリ側が `.eq('is_public', true)`
-- で絞る問い合わせ**（`/explore` の一覧、作家プロフィール、sitemap）は、`is_public` が
-- true のままの合同展示の部屋を**拾ってしまう** ── ポリシーを締めても、絞り込みの
-- 条件に合致すれば出てくる（実測 2026-08-09。テストが検出した）。
--
-- 全クエリを監査して `expo_id is null` を足すより、**値そのものを持たせない**方が確実。
-- `expos_set_ends` と同じ作法で、insert/update のたびに無条件で false にする。
create or replace function public.galleries_expo_never_public()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expo_id is not null then
    new.is_public := false;
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_expo_never_public on public.galleries;
create trigger galleries_expo_never_public
  before insert or update on public.galleries
  for each row execute function public.galleries_expo_never_public();

-- 既にある行を直す（0045 より前に作られた合同展示の部屋）。
update public.galleries set is_public = false where expo_id is not null and is_public;

-- **合同展示の部屋を通常の公開経路から外す。** これが無いと、主催者が部屋の公開スイッチを
-- 入れただけで（＝場所代を払う前に）`/@ハンドル/{slug}` と `/explore` に出てしまう。
drop policy if exists "galleries_select_public" on public.galleries;
create policy "galleries_select_public"
  on public.galleries for select using (is_public and expo_id is null);

-- 合同展示の部屋は**会期だけで**開く（`is_public` は見ない）。主催者が押すスイッチではなく、
-- 支払いで始まった会期が見せ方を決める。
drop policy if exists "galleries_select_expo_live" on public.galleries;
create policy "galleries_select_expo_live"
  on public.galleries for select
  using (expo_id is not null and public.gallery_in_live_expo(id));

/* ================= 2. 配置 ================= */
drop policy if exists "placements_select_expo_live" on public.placements;
create policy "placements_select_expo_live"
  on public.placements for select
  using (public.gallery_in_live_expo(gallery_id));

/* ================= 3. 作品 ================= */
-- 会期中の合同展示に掛かっている作品は、**誰の作品でも**来場者に見える（それが展示だから）。
-- 会期が終わって猶予も切れれば、この経路は閉じる（展示の行が消えるので `gallery_in_live_expo`
-- が false になる）。作品そのものは各作家のライブラリに残る。
drop policy if exists "artworks_select_in_live_expo" on public.artworks;
create policy "artworks_select_in_live_expo"
  on public.artworks for select
  using (
    exists (
      select 1
        from public.placements p
       where p.artwork_id = artworks.id
         and public.gallery_in_live_expo(p.gallery_id)
    )
  );

/* ================= 4. 名前の取り合いを塞ぐ ================= */
-- `/expo/{name}` には**2つの住人**が居る:
--   ・`profiles.expo_slug`（0040。管理者が付けるアカウントの別名）
--   ・`expos.slug`（0044。合同展示）
-- 一意制約は別々なので、**同じ名前が両方に存在できてしまい**、どちらを開くかは
-- 解決の順番次第になる（＝先に登録した人の展示が、あとから同名を取った人に隠される）。
-- 新しく取る側を互いに弾いて、これから増えないようにする。既存の重複は下の NOTICE で知らせる。
create or replace function public.guard_expo_slug_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is null then return new; end if;
  if exists (select 1 from public.profiles p where lower(p.expo_slug) = lower(new.slug)) then
    raise exception 'that URL name is already used by an exhibition alias'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists expos_guard_slug_unique on public.expos;
create trigger expos_guard_slug_unique
  before insert or update of slug on public.expos
  for each row execute function public.guard_expo_slug_unique();

-- 逆向き: アカウントの別名を付けるときに、合同展示の名前とぶつからないようにする。
-- 0040 の `set_expo_slug` に一行足した全文（`create or replace` なので置き換わる）。
create or replace function public.set_expo_slug(p_user uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  v_clean := nullif(lower(trim(coalesce(p_slug, ''))), '');
  if v_clean is not null and v_clean !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'invalid slug: %', p_slug;
  end if;

  -- **合同展示の名前とぶつけない**（`/expo/{name}` を取り合うので、先に居る方を守る）。
  if v_clean is not null and exists (select 1 from public.expos x where lower(x.slug) = v_clean) then
    raise exception 'that URL name is already used by a joint exhibition'
      using errcode = 'unique_violation';
  end if;

  update public.profiles set expo_slug = v_clean where id = p_user;
  if not found then
    raise exception 'no such profile';
  end if;
end;
$$;

revoke all on function public.set_expo_slug(uuid, text) from public, anon;
grant execute on function public.set_expo_slug(uuid, text) to authenticated;

-- 既にぶつかっているものがあれば知らせる（勝手に直さない — どちらを残すかは人が決める）。
do $$
declare
  v_dupes text;
begin
  select string_agg(x.slug, ', ') into v_dupes
    from public.expos x
   where exists (select 1 from public.profiles p where lower(p.expo_slug) = lower(x.slug));
  if v_dupes is not null then
    raise notice '同じ URL 名が合同展示とアカウント別名の両方にあります: %。/expo/ はどちらか一方しか開けないので、どちらを残すか決めてください。', v_dupes;
  end if;
end $$;


-- # 0046_expo_engagement.sql — 合同展示でも来場・芳名帳・いいねが動くようにする(0045 の続き)
-- 合同展示でも「来場・芳名帳・いいね」が動くようにする（0045 の続き。③公開ページの検証で発覚）
--
-- 0045 で合同展示の部屋は **`is_public` を持てない**ようにした（会期だけが見え方を決める）。
-- ところが来場者の関わり方を許すポリシーは**全部 `is_public` を見ている**:
--
--   ・`visits_insert_public`            — 来場の記録（3Dの人影＝過去の来場者）
--   ・`guestbook_insert_public` (0033)  — 芳名帳に書く
--   ・`guestbook_select_public_or_own`  — 芳名帳を読む
--   ・`likes_insert_public`             — いいね
--   ・`likes_select_public_or_own`      — いいねを読む
--   ・`public_visit_count()` (0024)     — 人影の数
--
-- つまり**会期中の合同展示では、芳名帳のフォームは出るのに書けず**（RLSが拒否＝来場者には
-- ただのエラー）、いいねも押せず、人影も出ない。**場所代を払った展示でだけ体験が欠けている**
-- という、いちばん出てはいけない形の欠落。
--
-- 直し方: ポリシーは **OR で足される**ので、既存のものは触らず「会期の生きている合同展示なら
-- 通す」ポリシーを並べて足す（`is_public` 側の意味を1文字も変えないので、通常展示への回帰が
-- 原理的に起きない）。関数だけは足せないので `public_visit_count` は全文を置き換える。
--
-- 述語は 0045 の `gallery_in_live_expo(uuid)` をそのまま使う（`security definer`・anon に
-- grant 済み・読むのは会期の日付だけ）。**猶予中（会期は終わったがURLは生きている）も
-- 通す**のは、そこがまだ本物のページだから ── 閉幕直後に届いた記帳を黙って捨てるより、
-- 受け取るほうがよい。消えるのは猶予明けに行ごと（`purge_expired_expos`）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. 前提（0045 未適用だと足せない） ================= */
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'gallery_in_live_expo'
  ) then
    raise exception '0045_expo_public_read.sql を先に適用してください（gallery_in_live_expo が無い）';
  end if;
end $$;

/* ================= 1. 来場の記録 ================= */
-- 3Dの人影（§11.19）の材料。読めるのは今までどおり部屋の持ち主だけ（`visits_select_own`）。
drop policy if exists "visits_insert_expo_live" on public.visits;
create policy "visits_insert_expo_live"
  on public.visits for insert
  with check (public.gallery_in_live_expo(gallery_id));

/* ================= 2. 芳名帳 ================= */
-- **`guestbook_enabled` は尊重する。** 合同展示の部屋もふつうの部屋なので、主催者が
-- 閉じていれば閉じたまま（0033 が守っているのと同じ約束）。
drop policy if exists "guestbook_insert_expo_live" on public.guestbook;
create policy "guestbook_insert_expo_live"
  on public.guestbook for insert
  with check (
    exists (
      select 1 from public.galleries g
       where g.id = gallery_id
         and g.guestbook_enabled
         and public.gallery_in_live_expo(g.id)
    )
  );

drop policy if exists "guestbook_select_expo_live" on public.guestbook;
create policy "guestbook_select_expo_live"
  on public.guestbook for select
  using (public.gallery_in_live_expo(gallery_id));

/* ================= 3. いいね ================= */
-- 通知の宛先は**作品の所有者**なので（0042 の `notify_like`）、合同展示で他人の壁に
-- 掛かっていても「あなたの作品がいいねされた」は作家本人に届く。ここは経路を開けるだけ。
drop policy if exists "likes_insert_expo_live" on public.likes;
create policy "likes_insert_expo_live"
  on public.likes for insert
  with check (public.gallery_in_live_expo(gallery_id));

drop policy if exists "likes_select_expo_live" on public.likes;
create policy "likes_select_expo_live"
  on public.likes for select
  using (public.gallery_in_live_expo(gallery_id));

/* ================= 4. 人影の数 ================= */
-- 0024 の全文に「会期の生きている合同展示なら数える」を足したもの（関数は OR で足せない
-- ので置き換える）。**返すのは合計だけ**で、行も時刻も返さないのは 0024 のまま。
create or replace function public.public_visit_count(p_gallery uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(count(*), 0)::int
  from public.visits v
  where v.gallery_id = p_gallery
    and (
      exists (select 1 from public.galleries g where g.id = p_gallery and g.is_public)
      or public.gallery_in_live_expo(p_gallery)
    );
$$;

revoke all on function public.public_visit_count(uuid) from public;
grant execute on function public.public_visit_count(uuid) to anon, authenticated, service_role;


-- # 0047_expo_invites.sql — 招待を合同展示のものにする(部屋への招待を撤去。ユーザー選択A)
-- 招待を合同展示（`expos`）のものにする ── 部屋への招待を撤去する（ユーザー選択A 2026-08-09）
--
-- 0037/0041 では招待と提出が**部屋（`galleries`）単位**だった。0044 で合同展示が
-- 独立した実体になり「招待は合同展示だけの機能にする」と決まった（ユーザー選択A）ので、
-- 単位を合わせる。
--
-- **なぜ部屋単位ではいけないか**: 合同展示は部屋を複数ぶら下げられる（0044）。部屋単位の
-- ままだと、主催者が2室目を作った瞬間に**同じ作家をもう一度招き直さないと掛けられない**。
-- 招待は「この展示に参加しますか」という1回の話であって、部屋の数だけ繰り返す話ではない。
--
-- **提出も展示単位にする。** 作家は「この展示に出す作品」を選び、**どの部屋に掛けるかは
-- 主催者が決める**。作家に部屋を選ばせると、主催者が構成を変えるたびに作家の同意が
-- 迷子になる（部屋を消すと提出も消える＝出したはずの作品が黙って引き上がる）。
-- 同意の中身は「この展示に、この作品を出す」で閉じている。
--
-- 引き継ぐもの（0037/0041 で血を流して決めた形は変えない）:
--   ・**作家が出す（push）**。主催者は相手のライブラリを見ない ── 見える範囲＝出すと決めた範囲。
--   ・**同意は作品単位**。「受諾済み」だけでは掛けられず、その作品が提出されていること。
--   ・**辞退・取り下げでその場で壁から下りる。**
--   ・**述語は `security definer` の関数に出す。** ポリシーの中に直接書くと
--     `submissions` ⇄ `artworks` で **RLS が無限再帰**して全部落ちる（0041 で実測）。
--   ・**ポリシーが呼ぶ関数は `anon` にも grant する。** `artworks` に載るポリシーは
--     未ログインの来場者が公開ページを開くだけで評価されるので、渡し忘れると
--     `permission denied for function` で**公開サイトが全滅する**（0041 で実際にやった）。
--     渡しても漏れない ── どれも `auth.uid()` を見るので anon では常に false。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
--
-- **この migration は `room_invites` / `room_submissions` を落とす。** 招待UIが動いて
-- いたのは今日までで、本番に行があれば下の 0 節が件数を報告してから消す（招待は
-- まだ誰も使っていないはずだが、動作確認では「無いこと」を示せない）。

/* ================= 0. 何を捨てるかを先に数える ================= */
do $$
declare
  v_inv int := 0;
  v_sub int := 0;
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'room_invites') then
    execute 'select count(*) from public.room_invites' into v_inv;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'room_submissions') then
    execute 'select count(*) from public.room_submissions' into v_sub;
  end if;
  if v_inv > 0 or v_sub > 0 then
    raise warning '0047: 部屋への招待 % 件・提出 % 件を捨てます（合同展示への招待に載せ替えたので、必要なら主催者が招き直してください）。掛かっている placement は下の 8 節で外れます。', v_inv, v_sub;
  else
    raise notice '0047: 捨てる部屋への招待・提出はありません（想定どおり）。';
  end if;
end $$;

/* ================= 1. 招待（主催者 → 作家。展示単位） ================= */
create table if not exists public.expo_invites (
  id uuid primary key default gen_random_uuid(),
  expo_id uuid not null references public.expos (id) on delete cascade,
  /** 招かれた作家。この人が出した作品が、この展示の部屋に掛けられるようになる。 */
  artist_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (expo_id, artist_id)
);

-- 受信箱が引く向き（自分宛の招待）と、主催者の参加者一覧が引く向き。
create index if not exists expo_invites_artist_idx on public.expo_invites (artist_id, status);
create index if not exists expo_invites_expo_idx on public.expo_invites (expo_id, created_at);

alter table public.expo_invites enable row level security;

/* 主催者: 出す・見る・取り下げる。**status は自分では動かせない**（受諾は作家の
 * 意思表示なので、招いた側が勝手に 'accepted' にできてはいけない）。update を
 * 持つのは下の作家向けポリシーだけ。 */
drop policy if exists "expo_invites_owner_read" on public.expo_invites;
create policy "expo_invites_owner_read"
  on public.expo_invites for select using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

drop policy if exists "expo_invites_owner_insert" on public.expo_invites;
create policy "expo_invites_owner_insert"
  on public.expo_invites for insert with check (
    status = 'pending'
    and exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

drop policy if exists "expo_invites_owner_delete" on public.expo_invites;
create policy "expo_invites_owner_delete"
  on public.expo_invites for delete using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

-- 作家: 自分宛の招待を見る／受諾・辞退する（＝いつでも取り下げられる）。
drop policy if exists "expo_invites_artist_read" on public.expo_invites;
create policy "expo_invites_artist_read"
  on public.expo_invites for select using (artist_id = (select auth.uid()));

drop policy if exists "expo_invites_artist_respond" on public.expo_invites;
create policy "expo_invites_artist_respond"
  on public.expo_invites for update
  using (artist_id = (select auth.uid()))
  with check (artist_id = (select auth.uid()) and status in ('accepted', 'declined'));

/* ================= 2. 招かれた作家が「何に招かれたのか」を読める ================= */
-- `expos` の select は 0044 で **所有者 or 会期が生きている or 管理者**。合同展示は
-- **会期前（下書き）に準備する**のがふつうなので、これが無いと招かれた作家に
-- 展示の題名も主催者も読めない ＝ 受信箱に「何かに招かれました」しか出せない。
--
-- `security definer` にするのは、`expo_invites` のポリシーが `expos` を読むため
-- （`expos` のポリシーに `expo_invites` を直接書くと環になる。0041 と同じ形）。
create or replace function public.invited_to_expo(p_expo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expo_invites i
     where i.expo_id = p_expo and i.artist_id = (select auth.uid())
  );
$$;

revoke all on function public.invited_to_expo(uuid) from public;
grant execute on function public.invited_to_expo(uuid) to anon, authenticated, service_role;

-- 辞退したあとも読めるままにする（受諾し直せるわけではないが、履歴として
-- 「辞退した展示」を出せないと、受信箱から行が消えて何が起きたのか分からなくなる）。
drop policy if exists "expos_select_invited" on public.expos;
create policy "expos_select_invited"
  on public.expos for select using (public.invited_to_expo(id));

/* ================= 3. 提出（作家 → 展示） ================= */
create table if not exists public.expo_submissions (
  id uuid primary key default gen_random_uuid(),
  expo_id uuid not null references public.expos (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (expo_id, artwork_id)
);

-- 主催者の配置画面が「この展示への提出」を引く向き。
create index if not exists expo_submissions_expo_idx
  on public.expo_submissions (expo_id, created_at);

alter table public.expo_submissions enable row level security;

-- 自分の作品を、受諾済みの招待がある展示に出せるか。辞退したあとは false に戻るので、
-- **辞退後に出し直すことはできない**。
create or replace function public.may_submit_to_expo(p_expo uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_artwork(p_artwork) and exists (
    select 1 from public.expo_invites i
     where i.expo_id = p_expo
       and i.artist_id = (select auth.uid())
       and i.status = 'accepted'
  );
$$;

-- その作品が「自分が主催する展示に提出されている」か（下の artworks の select 用）。
create or replace function public.artwork_submitted_to_my_expo(p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.expo_submissions s
      join public.expos x on x.id = s.expo_id
     where s.artwork_id = p_artwork
       and x.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.may_submit_to_expo(uuid, uuid) from public;
revoke all on function public.artwork_submitted_to_my_expo(uuid) from public;
grant execute on function public.may_submit_to_expo(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.artwork_submitted_to_my_expo(uuid) to anon, authenticated, service_role;

-- 作家: 自分の作品を、**受諾済みの招待がある展示にだけ**出せる。
drop policy if exists "expo_submissions_artist_insert" on public.expo_submissions;
create policy "expo_submissions_artist_insert"
  on public.expo_submissions for insert
  with check (public.may_submit_to_expo(expo_id, artwork_id));

-- 作家: 出したものは**いつでも引っ込められる**（招待の受諾と対称）。招待の状態は見ない
-- ── 辞退したあとに取り下げられないと、行が残り続ける。
drop policy if exists "expo_submissions_artist_delete" on public.expo_submissions;
create policy "expo_submissions_artist_delete"
  on public.expo_submissions for delete using (public.owns_artwork(artwork_id));

drop policy if exists "expo_submissions_artist_read" on public.expo_submissions;
create policy "expo_submissions_artist_read"
  on public.expo_submissions for select using (public.owns_artwork(artwork_id));

-- 主催者: 自分の展示への提出を見る。**書けない**（提出は作家の意思表示なので、
-- 主催者が代わりに出せてはいけない ── status を主催者に触らせないのと同じ理由）。
-- `expos` は `expo_submissions` を読まないので、ここは環にならず直接書ける。
drop policy if exists "expo_submissions_owner_read" on public.expo_submissions;
create policy "expo_submissions_owner_read"
  on public.expo_submissions for select using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

/* ================= 4. 主催者が提出された作品を読める ================= */
-- これが無いと、提出の行は見えても**作品の中身（画像・タイトル・寸法）が読めない**ので
-- 選ぶ画面が描けない。範囲は「提出された作品」だけ ── 招待した作家の全作品ではない。
drop policy if exists "artworks_select_submitted_to_my_expo" on public.artworks;
create policy "artworks_select_submitted_to_my_expo"
  on public.artworks for select using (public.artwork_submitted_to_my_expo(id));

/* ================= 5. 掛けてよいかの述語（部屋 → 展示に読み替え） ================= */
-- ①（自分の作品）は 0037 から変えない。②を「その部屋が属する展示への受諾済み招待が
-- あり、かつその作品がその展示に提出されている」にする。
--
-- **`expo_id is null` の部屋（通常展示）では②が絶対に成立しない**ので、通常展示に
-- 他人の作品が入る道は無い（0037 で塞いだ穴は塞がったまま）。
create or replace function public.may_place_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- ① 部屋の所有者が、その作品の所有者でもある（通常展示の全ケースがこれ）
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
     where g.id = p_gallery and a.owner_id = g.owner_id
  ) or exists (
    -- ② 合同展示の部屋で、作品の所有者がその展示への招待を受諾しており、
    --    かつ**その作品をその展示に出している**
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
      join public.expo_invites i
        on i.expo_id = g.expo_id and i.artist_id = a.owner_id and i.status = 'accepted'
      join public.expo_submissions s
        on s.expo_id = g.expo_id and s.artwork_id = a.id
     where g.id = p_gallery and g.expo_id is not null
  );
$$;

revoke all on function public.may_place_artwork(uuid, uuid) from public;
grant execute on function public.may_place_artwork(uuid, uuid) to authenticated, service_role;

/* ================= 6. 取り下げたら壁から下りる（作品単位） ================= */
-- 引っ込めたのに掛かったままなら、提出を選べる意味が無い。**その展示の全部屋**から
-- 外す（提出は展示単位なので、どの部屋に掛かっているかは主催者しか知らない）。
create or replace function public.drop_placements_on_unsubmit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.placements p
   using public.galleries g, public.artworks a
   where p.gallery_id = g.id
     and g.expo_id = old.expo_id
     and p.artwork_id = old.artwork_id
     and a.id = old.artwork_id
     -- 主催者自身の作品は①で許されているので触らない。
     and a.owner_id <> g.owner_id;
  return old;
end;
$$;

drop trigger if exists expo_submissions_unsubmit on public.expo_submissions;
create trigger expo_submissions_unsubmit
  after delete on public.expo_submissions
  for each row execute function public.drop_placements_on_unsubmit();

/* ================= 7. 辞退・取り下げで作家ごと下りる ================= */
-- 受諾を取り消した（辞退に変えた・招待が消えた）のに作品が掛かったままなら、同意の
-- 意味が無い。**その展示の全部屋**からその作家の作品を外し、提出も引き上げる
-- （提出が残ると、辞退したのに主催者からは作品が見えたまま＝4の select は招待を見ない）。
create or replace function public.drop_placements_on_expo_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expo uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_expo := old.expo_id; v_artist := old.artist_id;
  else
    -- 受諾のままなら何もしない
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_expo := new.expo_id; v_artist := new.artist_id;
  end if;

  delete from public.placements p
   using public.galleries g, public.artworks a
   where p.gallery_id = g.id
     and g.expo_id = v_expo
     and a.id = p.artwork_id
     and a.owner_id = v_artist
     -- 主催者自身の作品は①で許されているので触らない。
     and a.owner_id <> g.owner_id;

  -- 提出も引き上げる（上で placement は消えているので、6のトリガの二重発火は無害）。
  delete from public.expo_submissions s
   using public.artworks a
   where s.expo_id = v_expo
     and a.id = s.artwork_id
     and a.owner_id = v_artist;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists expo_invites_revoke on public.expo_invites;
create trigger expo_invites_revoke
  after update or delete on public.expo_invites
  for each row execute function public.drop_placements_on_expo_revoke();

/* ================= 8. @ハンドルで招く ================= */
-- ハンドルで指定する（ユーザー承認 2026-08-09）。メールだと**アカウントの有無を
-- 問い合わせられる**ようになる（総当たりで「このメールは登録済み」が引ける）。
-- ハンドルは `/@名前` として既に公開されている。
--
-- 関数にしたのは、クライアントから「ハンドル → id」を引いて insert する2往復のあいだに
-- 相手がハンドルを変えると**別人を招く**事故が起きるため。1文で解決して入れる。
create or replace function public.invite_artist_to_expo(p_expo uuid, p_handle text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_owner uuid;
  v_clean text;
  v_id uuid;
begin
  select x.owner_id into v_owner from public.expos x where x.id = p_expo;
  if v_owner is null then
    raise exception 'no such exhibition';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your exhibition';
  end if;

  -- `@` 付きで貼られても受ける（画面の見本が `@handle` なので必ず起きる）。
  v_clean := lower(trim(coalesce(p_handle, '')));
  v_clean := regexp_replace(v_clean, '^@+', '');
  if v_clean = '' then
    raise exception 'no handle given';
  end if;

  select p.id into v_artist from public.profiles p where lower(p.username) = v_clean;
  if v_artist is null then
    raise exception 'no such artist: %', p_handle;
  end if;
  if v_artist = v_owner then
    -- 主催者の作品は①で掛かるので招待は不要。招くと「参加者に自分が並ぶ」ことになる。
    raise exception 'cannot invite yourself';
  end if;

  insert into public.expo_invites (expo_id, artist_id, status)
  values (p_expo, v_artist, 'pending')
  -- **受諾済みは絶対に巻き戻さない**（pending に戻すと7のトリガが提出も掛かっている
  -- 作品も引き上げる＝招き直しただけで展示が壊れる）。ただし**辞退された相手は
  -- 招き直せる**必要がある: `do nothing` だけにすると、一度断られた相手に声をかけ直す
  -- 道が無く、**エラーも出ないまま何も起きない**（0041 の別視点レビュー指摘）。
  on conflict (expo_id, artist_id) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.expo_invites.status = 'declined'
  returning id into v_id;

  if v_id is null then
    -- `do update` の where が false（＝pending か accepted のまま）。既存の行を返す。
    select i.id into v_id from public.expo_invites i
     where i.expo_id = p_expo and i.artist_id = v_artist;
  end if;
  return v_id;
end;
$$;

revoke all on function public.invite_artist_to_expo(uuid, text) from public, anon;
grant execute on function public.invite_artist_to_expo(uuid, text) to authenticated;

/* ================= 9. 通知の宛先を展示に付け替える（0042） ================= */
-- 0042 の3本は `room_invites` / `room_submissions` に載っていた。表を落とすとトリガも
-- 一緒に消えるので、**同じ意味のものを新しい表に作り直す**（作らないと招待に気づく
-- 経路が無くなる＝0042 を作った理由そのものが消える）。
--
-- `notifications.gallery_id` は**入れない**（合同展示に対応する部屋は1つに決まらない）。
-- 見出しは展示の題名を焼き込む ── source が消えても読めるようにするのが 0042 の作法。

create or replace function public.notify_expo_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
  v_organizer text;
begin
  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;
  select coalesce(p.display_name, p.username) into v_organizer
    from public.profiles p where p.id = v_owner;

  perform public.push_notification(
    new.artist_id, 'invite', null, null, coalesce(v_title, ''), '', v_organizer
  );
  return new;
end;
$$;

drop trigger if exists expo_invites_notify on public.expo_invites;
create trigger expo_invites_notify
  after insert on public.expo_invites
  for each row execute function public.notify_expo_invite();

-- 受諾・辞退を**主催者へ**返す。招いたまま返事を待つ側にも通知が要る（辞退は特に:
-- 気づかないと空いた枠を埋め直せない）。
create or replace function public.notify_expo_invite_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
  v_artist text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted', 'declined') then return new; end if;

  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;
  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = new.artist_id;

  -- 本文に状態を入れる（`accepted` / `declined`）。表示側が文言を選ぶための値で、
  -- 画面に出す英語ではない。
  perform public.push_notification(
    v_owner, 'invite_reply', null, null, coalesce(v_title, ''), new.status, v_artist
  );
  return new;
end;
$$;

drop trigger if exists expo_invites_reply_notify on public.expo_invites;
create trigger expo_invites_reply_notify
  after update of status on public.expo_invites
  for each row execute function public.notify_expo_invite_reply();

-- 提出を**主催者へ**。作家は複数点まとめて出すので**作家ごと・1日1件にまとめる**。
create or replace function public.notify_expo_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
  v_artist_id uuid;
  v_artist text;
begin
  select x.owner_id, x.title into v_owner, v_title
    from public.expos x where x.id = new.expo_id;
  select a.owner_id into v_artist_id
    from public.artworks a where a.id = new.artwork_id;

  -- 主催者が自分の作品を出したときは通知しない。
  if v_owner is null or v_owner is not distinct from v_artist_id then return new; end if;

  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = v_artist_id;

  -- まとめの鍵は (展示, 作家)。作家は `actor_name` で持つので、同じ日に2人が出しても
  -- 2件に分かれる（1件に畳むと誰が出したのか分からなくなる）。
  -- `p_gallery` は null なので、まとめは「同じ kind・同じ actor・未読・同日」で当たる。
  perform public.push_notification_rollup(
    v_owner, 'submission', null, null, coalesce(v_title, ''), v_artist
  );
  return new;
end;
$$;

drop trigger if exists expo_submissions_notify on public.expo_submissions;
create trigger expo_submissions_notify
  after insert on public.expo_submissions
  for each row execute function public.notify_expo_submission();

/* ================= 10. 部屋への招待を撤去する ================= */
-- **ここから下は 0037/0041 の取り壊し。** 表を落とせばポリシーとトリガは一緒に消えるので、
-- 残るのは「どこからも呼ばれなくなった関数」と、`galleries` に載っていたポリシー1本。
--
-- 順序が要る: `may_place_artwork` は 5 で**もう書き換えてある**（`room_invites` を
-- 参照しない版になっている）。先に表を落とすと、書き換える前の版が壊れた関数として
-- 残る瞬間ができる ── だから**書き換えてから落とす**。

-- 招かれた作家に部屋を読ませていたポリシー（0041 の 1.5）。招待は展示単位になったので、
-- 読ませる先は `expos`（上の 2）に移った。
drop policy if exists "galleries_select_invited" on public.galleries;

-- 0041 が `artworks` に載せていた select（部屋への提出）。4 で展示版に置き換えたので落とす。
-- **表を落としてもポリシーは残る**（`artworks` は消えていないので）ため、明示的に消す
-- ── 残ると `artwork_submitted_to_my_room` を呼び続けて `artworks` の select が全部落ちる。
--
-- **関数より先に落とす。** ポリシーは関数への依存として登録されるので、順番を逆にすると
-- `drop function` が `cannot drop function … because other objects depend on it` で落ちる
-- （実測 2026-08-10。しかもハーネスが psql の失敗を握り潰していたので、表だけ消えて
-- 関数とポリシーが残った半端なDBを相手に検査していた）。
drop policy if exists "artworks_select_submitted_to_my_room" on public.artworks;

drop table if exists public.room_submissions cascade;
drop table if exists public.room_invites cascade;

-- 参照先が消えて使えなくなった関数。**残すと「まだ部屋への招待がある」と読める**ので消す。
drop function if exists public.invited_to_room(uuid);
drop function if exists public.may_submit_artwork(uuid, uuid);
drop function if exists public.artwork_submitted_to_my_room(uuid);
drop function if exists public.invite_artist_by_handle(uuid, text);
drop function if exists public.drop_placement_on_unsubmit();
drop function if exists public.drop_placements_on_revoke();
drop function if exists public.notify_invite();
drop function if exists public.notify_invite_reply();
drop function if exists public.notify_submission();

/* ================= 11. 締めた述語で弾かれる placement を数える ================= */
-- 5 で②の条件が「部屋への招待」から「展示への招待」に変わったので、**部屋への招待で
-- 入っていた placement** は次の再公開で弾かれる。7 のトリガは表を落とす前には走らない
-- （`drop table` はトリガを発火させない）ので、ここで数えて報告する。
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
    join public.artworks a on a.id = p.artwork_id
   where a.owner_id <> g.owner_id
     and not public.may_place_artwork(p.gallery_id, p.artwork_id);
  if v_bad > 0 then
    raise warning '0047: % 件の placement が新しい同意の条件を満たしません（部屋への招待で入っていたもの）。表示は残りますが次の再公開で弾かれます ── 主催者が合同展示として招き直してください。', v_bad;
  else
    raise notice '0047: 影響を受ける placement はありません（想定どおり）。';
  end if;
end $$;


-- # 0048_expo_invite_links.sql — 招待リンク（参加希望→主催者が承認。ユーザー決定 2026-08-10）
-- 招待リンク（ユーザー決定 2026-08-10）— 「配れるURL」で参加希望を集め、主催者が承認する
--
-- 0047 で招待は `@ハンドル` を打つ経路だけになった。主催者が10人に声をかけるには10回
-- ハンドルを聞き出す必要があり、**相手のハンドルを知らないと招けない**（SNSのDMで
-- 「ハンドル教えて」から始まる）。配れるURLがあれば、主催者は1本貼るだけで済む。
--
-- ユーザー決定（2026-08-10）:
--   ・**リンクはログイン済みの誰でも使える**（人数上限は付けない）。流出しても実害は
--     「承認待ちが増える」だけ ── **承認するまで何も公開されないし、何も掛からない**。
--     効かなくしたいときは主催者が**無効化**する（下の `revoked_at`）。
--   ・**未登録の人には先に展示を見せる**（題名・主催者・会期）。そのうえで登録を促す。
--     何に誘われたのか分からないまま登録を求めない。
--   ・**参加希望は通知でも伝える**（`invite_request`）＋参加者一覧に「承認待ち」で並ぶ。
--
-- 形（0047 の状態機械に1つ足すだけ）:
--   `pending`   — **主催者が招いた**。作家の返事待ち
--   `requested` — **作家が希望を出した**。主催者の承認待ち  ← 今回追加
--   `accepted`  — 参加確定。ここから作品を出せる
--   `declined`  — 辞退（または希望の取り下げ）
--
-- **`requested` は何の権限も与えない。** `may_submit_to_expo` は `accepted` しか見ないので、
-- 承認前の作家は1点も出せず、掛けることもできない（0047 のまま）。
--
-- **作家が自分で `requested` → `accepted` にできてはいけない。** 0047 の
-- `expo_invites_artist_respond` は「自分の行を accepted/declined にできる」なので、
-- そのままだと**希望を出した本人が自分を承認できてしまう**＝承認の意味が消える。
-- 下の 4 のガードで塞ぐ（ポリシーの `with check` からは OLD が見えないのでトリガでやる）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. 状態を1つ増やす ================= */
-- `check` は差分更新できないので毎回書き直す（0044 の `purchases_kind_check` と同じ作法）。
alter table public.expo_invites drop constraint if exists expo_invites_status_check;
alter table public.expo_invites add constraint expo_invites_status_check
  check (status in ('pending', 'requested', 'accepted', 'declined'));

-- 通知の種類も2つ増やす（**主催者へ**「希望が来た」・**作家へ**「承認された」）。
-- 1つの種類に畳まないのは、宛先も文面も逆向きだから。
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'like', 'guestbook', 'announce'));

/* ================= 1. リンク ================= */
create table if not exists public.expo_invite_links (
  id uuid primary key default gen_random_uuid(),
  expo_id uuid not null references public.expos (id) on delete cascade,
  /**
   * URL に載る文字列。**サーバが作る**（下の `create_expo_invite_link`）ので、
   * クライアントが弱い値を選べない。当てずっぽうで当たらない長さがあれば、
   * 「知っている人だけが使える」という性質はこれ1本で足りる。
   */
  token text not null unique,
  /** 無効化した時刻。**行は消さない** — 「あのリンクはいつ止めたか」を残す。 */
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists expo_invite_links_expo_idx
  on public.expo_invite_links (expo_id, created_at desc);

alter table public.expo_invite_links enable row level security;

-- 主催者だけが自分の展示のリンクを読める・無効化できる。**anon にも authenticated にも
-- select を開けない** ── 開けると表を1回読むだけで**全部のトークンが手に入る**
-- （招待リンクは「知っていること」が唯一の鍵なので、一覧できたら鍵ではなくなる）。
-- リンクを踏んだ人が展示を引く経路は、下の 3 の `security definer` 関数だけ。
drop policy if exists "expo_invite_links_owner_all" on public.expo_invite_links;
create policy "expo_invite_links_owner_all"
  on public.expo_invite_links for all
  using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

/* ================= 2. リンクを作る（トークンはサーバが決める） ================= */
create or replace function public.create_expo_invite_link(p_expo uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token text;
begin
  select x.owner_id into v_owner from public.expos x where x.id = p_expo;
  if v_owner is null then
    raise exception 'no such exhibition';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your exhibition';
  end if;

  -- v4 UUID 2本＝64文字の16進（約244ビット）。**`gen_random_bytes` は使わない** ──
  -- あれは pgcrypto の関数で、Supabase では `extensions` スキーマに入るので
  -- `set search_path = ''` のこの関数からは `public.` でも `extensions.` でも
  -- 環境次第で解決できない。`gen_random_uuid()` は Postgres 13 以降の組み込み
  -- （`pg_catalog`＝search_path を空にしても常に見える）なので、どの環境でも動く。
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.expo_invite_links (expo_id, token) values (p_expo, v_token);
  return v_token;
end;
$$;

revoke all on function public.create_expo_invite_link(uuid) from public, anon;
grant execute on function public.create_expo_invite_link(uuid) to authenticated;

/* ================= 3. リンクを踏んだ人が展示を引く ================= */
/**
 * トークンから展示の**表に出せる情報だけ**を返す。`security definer` なのは、
 * リンクを踏んだ人が（まだ招かれてもいないし、会期も始まっていないので）`expos` を
 * 読めないから。**返すのは題名・主催者・会期だけ**で、部屋も作品も返さない
 * ── リンクは「参加しませんか」の案内で、展示の中身の先行公開ではない。
 *
 * 無効化されたリンク・存在しないトークンは**0行**（「無効です」と「そんなリンクは無い」を
 * 区別しない ── 区別すると総当たりで有効なトークンを探せる）。
 *
 * `my_status` は呼び手自身の招待の状態（未ログインなら null）。画面が
 * 「もう希望を出しています」「すでに参加しています」を出し分けるために使う。
 */
create or replace function public.expo_by_invite_token(p_token text)
returns table (
  expo_id uuid,
  slug text,
  title text,
  statement text,
  starts_at timestamptz,
  ends_at timestamptz,
  organizer_name text,
  organizer_username text,
  my_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id,
         x.slug,
         x.title,
         x.statement,
         x.starts_at,
         x.ends_at,
         coalesce(p.display_name, p.username, ''),
         p.username,
         (select i.status from public.expo_invites i
           where i.expo_id = x.id and i.artist_id = (select auth.uid()))
    from public.expo_invite_links l
    join public.expos x on x.id = l.expo_id
    left join public.profiles p on p.id = x.owner_id
   where l.token = p_token
     and l.revoked_at is null;
$$;

revoke all on function public.expo_by_invite_token(text) from public;
grant execute on function public.expo_by_invite_token(text) to anon, authenticated, service_role;

/* ================= 4. 参加希望を出す ================= */
/**
 * リンクから「参加したい」を出す。**これは権限を1つも増やさない** — 主催者が承認する
 * まで `accepted` にならず、`may_submit_to_expo` は `accepted` しか見ない。
 *
 * 既にある行の扱い:
 *   `accepted`  → そのまま（もう参加している）
 *   `pending`   → **`accepted` にする。** 主催者が既に招いていて、本人がリンクから
 *                 「参加したい」と言った ── 受信箱の［受ける］と同じ意思表示なので、
 *                 承認を待たせる理由が無い（待たせると「招いたのに入れない」になる）
 *   `declined`  → `requested`（気が変わった。主催者の承認からやり直す）
 *   `requested` → そのまま（二度押し）
 *
 * 返すのは結果の状態。画面がそのまま文言を選べる。
 */
create or replace function public.request_expo_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expo uuid;
  v_owner uuid;
  v_me uuid := (select auth.uid());
  v_status text;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select x.id, x.owner_id into v_expo, v_owner
    from public.expo_invite_links l
    join public.expos x on x.id = l.expo_id
   where l.token = p_token and l.revoked_at is null;
  if v_expo is null then
    raise exception 'link not found';
  end if;
  if v_owner = v_me then
    -- 主催者の作品は招待なしで掛かる。自分の展示に希望を出すと参加者に自分が並ぶ。
    raise exception 'this is your own exhibition';
  end if;

  select i.status into v_status from public.expo_invites i
   where i.expo_id = v_expo and i.artist_id = v_me;

  if v_status is null then
    insert into public.expo_invites (expo_id, artist_id, status)
    values (v_expo, v_me, 'requested');
    return 'requested';
  end if;

  if v_status = 'accepted' then
    return 'accepted';
  end if;

  if v_status = 'pending' then
    -- 主催者は既に招いている。リンクを踏んだのは本人なので、これは受諾。
    update public.expo_invites
       set status = 'accepted', responded_at = now()
     where expo_id = v_expo and artist_id = v_me;
    return 'accepted';
  end if;

  if v_status = 'declined' then
    update public.expo_invites
       set status = 'requested', created_at = now(), responded_at = null
     where expo_id = v_expo and artist_id = v_me;
    return 'requested';
  end if;

  return v_status; -- 'requested' のまま
end;
$$;

revoke all on function public.request_expo_invite(text) from public, anon;
grant execute on function public.request_expo_invite(text) to authenticated;

/* ================= 5. 自分で自分を承認できないようにする ================= */
-- 0047 の `expo_invites_artist_respond` は「自分の行を accepted/declined にできる」。
-- `requested`（自分が出した希望）にもそれが当たるので、**希望を出した本人が自分を
-- 承認できてしまう** ＝ 承認の意味が消える。ポリシーの `with check` からは OLD が
-- 見えないので、トリガで塞ぐ。
--
-- `security invoker` にするのが要点 ── definer にすると `current_user` が常に関数の
-- 所有者になり、クライアント経由かどうかの区別がつかず素通りする（0036 で実際にやった）。
-- 下の `approve_expo_request` は definer なので `current_user` が変わり、ここを通れる。
create or replace function public.guard_expo_invite_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.status = 'requested' and new.status = 'accepted' then
      raise exception 'a request must be approved by the organizer'
        using errcode = 'check_violation';
    end if;
    -- 希望を「招待」に見せかける経路も塞ぐ（作家側から pending は作れない）。
    if old.status is distinct from 'pending' and new.status = 'pending' then
      raise exception 'cannot move an invitation back to pending'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expo_invites_guard_approval on public.expo_invites;
create trigger expo_invites_guard_approval
  before update of status on public.expo_invites
  for each row execute function public.guard_expo_invite_approval();

/* ================= 6. 主催者が承認する ================= */
/**
 * 参加希望を承認する。**主催者に update ポリシーを与えない**まま実現するために関数に
 * している（0047 の「status は主催者が動かせない」を保ったまま、`requested` だけを
 * 例外にする ── その行は**作家自身が出した意思表示**なので、承認しても勝手に参加させた
 * ことにはならない）。
 *
 * 断るときは招待を消す（0047 の `expo_invites_owner_delete` がそのまま使える）。
 */
create or replace function public.approve_expo_request(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select x.owner_id, i.status into v_owner, v_status
    from public.expo_invites i
    join public.expos x on x.id = i.expo_id
   where i.id = p_invite;
  if v_owner is null then
    raise exception 'no such invitation';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your exhibition';
  end if;
  if v_status <> 'requested' then
    -- 承認できるのは希望だけ。招待（pending）を主催者が受諾するのは別の話で、
    -- それは作家の意思表示なので主催者にはできない（0047）。
    raise exception 'only a request can be approved';
  end if;

  update public.expo_invites
     set status = 'accepted', responded_at = now()
   where id = p_invite;
end;
$$;

revoke all on function public.approve_expo_request(uuid) from public, anon;
grant execute on function public.approve_expo_request(uuid) to authenticated;

/* ================= 7. 通知 ================= */
-- 0047 の3本のうち2本を差し替える。**`requested` の行は宛先が逆**（作家が起こしたので
-- 主催者へ）なので、insert の通知を状態で分岐させる。
create or replace function public.notify_expo_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
  v_organizer text;
  v_artist text;
begin
  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;

  if new.status = 'requested' then
    -- 作家が希望を出した → **主催者へ**。
    select coalesce(p.display_name, p.username) into v_artist
      from public.profiles p where p.id = new.artist_id;
    perform public.push_notification(
      v_owner, 'invite_request', null, null, coalesce(v_title, ''), '', v_artist
    );
    return new;
  end if;

  -- 主催者が招いた → **作家へ**（0047 のまま）。
  select coalesce(p.display_name, p.username) into v_organizer
    from public.profiles p where p.id = v_owner;
  perform public.push_notification(
    new.artist_id, 'invite', null, null, coalesce(v_title, ''), '', v_organizer
  );
  return new;
end;
$$;

-- 返事の通知。**承認（`requested` → `accepted`）は作家へ**、それ以外（受諾・辞退）は
-- 主催者へ。分けないと、主催者が自分で押した承認の通知が自分に届く。
create or replace function public.notify_expo_invite_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
  v_artist text;
  v_organizer text;
begin
  if new.status is not distinct from old.status then return new; end if;

  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;

  if old.status = 'requested' and new.status = 'accepted' then
    select coalesce(p.display_name, p.username) into v_organizer
      from public.profiles p where p.id = v_owner;
    perform public.push_notification(
      new.artist_id, 'invite_approved', null, null, coalesce(v_title, ''), '', v_organizer
    );
    return new;
  end if;

  if new.status not in ('accepted', 'declined') then return new; end if;

  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = new.artist_id;

  -- 本文に状態を入れる（`accepted` / `declined`）。表示側が文言を選ぶための値で、
  -- 画面に出す英語ではない。
  perform public.push_notification(
    v_owner, 'invite_reply', null, null, coalesce(v_title, ''), new.status, v_artist
  );
  return new;
end;
$$;

-- # 0049_expo_launch_guard_fix.sql — 合同展示の確定バグ2件を塞ぐ(別視点レビュー 2026-08-10)
-- 合同展示の確定バグ2件を塞ぐ（別視点レビュー 2026-08-10、PR #8 マージ前に発見）
--
-- どちらも「クライアントから公開できる経路は存在しない」（0044 のコメント）という
-- 設計の前提が、実際には破れていた。素のPostgresで実際に再現して確認済み。
--
-- ================= バグ①: INSERTでは starts_at のガードが効いていなかった =================
-- 0044 の `guard_expo_run` は `before update on public.expos` にしか付けておらず、
-- INSERT には効かない。`expos_owner_all` は owner_id 一致しか見ないので、
-- authenticated が
--   insert into expos(owner_id, slug, title, duration_days, starts_at) values (self, ..., now())
-- を直接送ると、**決済を一度も通さずに即座に公開状態**（`expo_is_live` = true）になる。
-- 実際に検証DBで再現した（30日ぶん・$0）。
--
-- ================= バグ②: 合同展示の部屋が「誰の展示か」を確認していなかった =================
-- 0044 の `enforce_room_allowance` は `new.expo_id is not null` ならすぐ return し、
-- ①その expo_id が new.owner_id の展示かを確認しない ②work_cap の上限チェックも
-- 一切通さない（15枠上限のチェックはこの early return の後ろにしか書かれておらず、
-- 到達しない）。実際に検証DBで再現した — **他人の展示のIDを付けるだけで、
-- work_cap=999999 の部屋が無料で作れ、しかもその部屋は他人の展示に紐づいた**。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. INSERTでも starts_at を守る ================= */
create or replace function public.guard_expo_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- 作成時に starts_at を自分で入れられると、決済を一度も通さずに公開できる。
      if new.starts_at is not null then
        raise exception 'starts_at is set by the payment' using errcode = 'check_violation';
      end if;
      return new;
    end if;

    -- 開始日は支払いが決める。ここを書けると無料で公開できる。
    if new.starts_at is distinct from old.starts_at then
      raise exception 'starts_at is set by the payment' using errcode = 'check_violation';
    end if;
    -- 会期の長さは公開後は動かせない（払った長さと違う会期になる）。公開前は自由。
    if old.starts_at is not null and new.duration_days is distinct from old.duration_days then
      raise exception 'duration cannot change once the run has started' using errcode = 'check_violation';
    end if;
    -- 名前も公開後は動かせない（配ったURLが死ぬ）。
    if old.starts_at is not null and new.slug is distinct from old.slug then
      raise exception 'slug cannot change once the run has started' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expos_guard_run on public.expos;
create trigger expos_guard_run
  before insert or update on public.expos
  for each row execute function public.guard_expo_run();

/* ================= 2. 合同展示の部屋は「自分の展示か」を確認し、上限も見る ================= */
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_purchased int;
  v_expo_owner uuid;
begin
  if new.expo_id is not null then
    -- **これが無いと、他人の展示のIDを付けるだけで無料・無制限の部屋が作れる**
    -- （実際に再現した）。owner_id は galleries_owner_all の with check で
    -- auth.uid() と一致済みなので、ここは「その展示が new.owner_id のものか」だけ見ればよい。
    select owner_id into v_expo_owner from public.expos where id = new.expo_id;
    if v_expo_owner is distinct from new.owner_id then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    -- 場所代に部屋の上限チェックは含まれない。物理上限は有料部屋と同じ15枠まで
    -- （**early return の後ろにしか書いていなかったので、これまで一切効いていなかった**）。
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = new.owner_id
     and expo_id is null;

  select count(*) into v_purchased
    from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    if v_paid >= v_purchased then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_purchased
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
  else
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- # 0050_room_expo_toggle.sql — 部屋を「通常展示↔合同展示」に切り替える(ユーザー指示 2026-08-10)
-- 部屋を「通常展示 ↔ 合同展示」に切り替える（ユーザー指示 2026-08-10）
--
-- 背景: `galleries.expo_id` は**作成時にしか設定できなかった**（0044/0038のトリガは
-- `before insert` だけ）。ユーザーから「部屋を用意したら、右上のボタンで通常展示⇄合同展示
-- を切り替えられると良い」と要望されたが、後から expo_id を書き換える経路は無く、
-- もし単純な UPDATE を許すと今日塞いだ 0049 と同型の抜け穴が再び開く
-- （所有者チェックなし・work_cap上限なし・他人の展示への無断ただ乗り）。
--
-- **範囲はユーザー選択で「作成直後・空の部屋だけ」に絞った**（作品を置いた後の部屋を
-- 動かすと、参加作家の同意・配置・購入の巻き戻しが要る本格的な工事になるため）。
-- 「空」の定義は日付ではなく**そのroomのplacementsが0件であること**（時刻は改ざん
-- できるが、placementsの有無はDBが数えられる唯一の実測値）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 直接のUPDATEを塞ぐ ================= */
-- `galleries_owner_all` は列を絞れないので、`enforce_room_allowance`（work_cap/等級と
-- 同じ作法）と同様に追加のトリガで守る。`security invoker` にして呼び手のロールを見る
-- ── definer だと current_user が常に所有者になり素通りする（0036 で実際にやった）。
create or replace function public.guard_room_expo_switch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.expo_id is distinct from old.expo_id then
    raise exception 'switch a room''s exhibition via switch_room_expo()' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_guard_expo_switch on public.galleries;
create trigger galleries_guard_expo_switch
  before update of expo_id on public.galleries
  for each row execute function public.guard_room_expo_switch();

/* ================= 2. 切替の本体（唯一の書き込み経路） ================= */
/**
 * 部屋を合同展示に入れる（`p_expo` を指定）／通常展示に戻す（`p_expo` を null）。
 *
 * 守ること:
 *   ①呼び手がその部屋の所有者であること
 *   ②その部屋が**空**（placementsが0件）であること — 参加作家の同意や配置を
 *     巻き戻す工事はまだ無いので、何か置かれていたら拒否する
 *   ③合同展示に入れるときは、その展示が呼び手自身のものであること（他人の展示への
 *     ただ乗りは0049で塞いだのと同じ理由で禁止）
 *   ④通常展示に戻すときは、**戻した先の等級**（無料1室 or 購入済みの有料室）を
 *     この部屋を除いた台帳で判定する。空きが無ければ拒否する（「先に部屋を購入」と
 *     案内できるように、無言で変な状態にはしない）
 *
 * 場所代に含まれる部屋は物理上限まで使える設計（0044のコメント）なので、合同展示に
 * 入れるときは `addExpoRoom()` と同じ等級（work_cap=15・slots_included=true）に揃える。
 */
create or replace function public.switch_room_expo(p_gallery uuid, p_expo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_room_owner uuid;
  v_room_expo uuid;
  v_expo_owner uuid;
  v_placements int;
  v_free int;
  v_paid int;
  v_purchased int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_room_owner, v_room_expo
    from public.galleries where id = p_gallery;
  if v_room_owner is null then
    raise exception 'no such room';
  end if;
  if v_room_owner <> v_me then
    raise exception 'not your room';
  end if;

  -- 変化が無いなら何もしない（ボタンの二度押しでエラーにしない）。
  if v_room_expo is not distinct from p_expo then
    return;
  end if;

  select count(*) into v_placements from public.placements where gallery_id = p_gallery;
  if v_placements > 0 then
    raise exception 'room is not empty' using errcode = 'check_violation';
  end if;

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    -- **通常展示が0室になってはいけない。** `/@handle` が描く部屋（`mainRoomOf`。
    -- 旗が無ければ最古の部屋にフォールバックする）は「通常展示」の中から選ばれる。
    -- 唯一の部屋をここで合同展示に持っていくと、フォールバック先が無くなって
    -- 公開ページが誰も描けなくなる（削除していないのに削除したのと同じ結果）。
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    update public.galleries
       set expo_id = p_expo, slots_included = true, work_cap = 15
     where id = p_gallery;
    return;
  end if;

  -- 通常展示に戻す。**この部屋自身を除いて**数える（自分がこれから空ける枠に、
  -- 自分自身がまだ居座っているせいで弾かれては困る）。
  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = v_me and expo_id is null and id <> p_gallery;
  select count(*) into v_purchased from public.purchases
   where user_id = v_me and kind = 'room';

  if v_free = 0 then
    update public.galleries set expo_id = null, slots_included = false, work_cap = 5
     where id = p_gallery;
  elsif v_paid < v_purchased then
    update public.galleries set expo_id = null, slots_included = true, work_cap = 15
     where id = p_gallery;
  else
    raise exception 'no unused room purchase: buy a room first' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.switch_room_expo(uuid, uuid) from public, anon;
grant execute on function public.switch_room_expo(uuid, uuid) to authenticated;

-- # 0051_expo_schedule.sql — 合同展示の公開日時を予約できるようにする(ユーザー指示 2026-08-10)
-- 合同展示の公開日時を予約できるようにする（ユーザー指示 2026-08-10）
--
-- これまで `record_expo_purchase` は「支払いが通った瞬間」に無条件で `starts_at = now()`
-- にしていた。**支払いと公開を同じ操作にする**という0044の設計は変えない — 公開できる
-- 経路は依然この関数だけで、クライアントから直接 `starts_at` を書く経路は無い（0049）。
-- 変えるのは「いつから見せるか」を主催者が選べるようにするだけ:
--   ・省略（null）= 従来どおり支払い完了と同時に公開
--   ・指定した未来の日時 = その日時になるまで `expo_is_live()` が false を返す
--     （0044の判定式は `starts_at` と `now()` の比較そのものなので、DB側のロジックは
--     1行も変えなくてよい ── 「まだ始まっていない」を最初から表現できていた）
--   ・指定した日時が既に過去（決済に時間がかかった等）= 支払い完了と同時に公開
--     （clampしない。「その時刻には公開されていてほしい」という意思をそのまま尊重する）
--
-- 上限は無し（ユーザー選択 2026-08-10）。何年先でも選べる。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.record_expo_purchase(
  p_session text,
  p_user uuid,
  p_expo uuid,
  p_days int,
  p_amount int,
  p_currency text,
  p_starts_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.expo_days_allowed(p_days) then
    raise exception 'unsupported run length: % days', p_days;
  end if;

  select owner_id into v_owner from public.expos where id = p_expo;
  if v_owner is null then
    raise exception 'no such expo';
  end if;
  if v_owner is distinct from p_user then
    raise exception 'expo does not belong to this user';
  end if;

  -- 再送で2回入らないように。**セッションidだけでなく、この展示への支払いが
  -- 既にあるかも見る**（本ファイルで実際に再現した抜け穴: `checkout` ルートは
  -- 「まだ会期が始まっていない展示」にしか決済を許さないが、2つのチェックアウトを
  -- 並行して開き両方で支払いを終える競合状態では両方が別セッションidを持つまま
  -- webhookに届く。セッションidだけで判定すると2件目が
  -- `purchases (user_id, kind, item_key)` の一意制約に落ちてクラッシュし、
  -- Stripeが延々と再送する状態になっていた）。同じ展示への2件目は「もう払われている」
  -- として黙って抜ける — 先勝ちのまま台帳が1本になる。
  if exists (
    select 1 from public.purchases
     where kind = 'expo' and (sku = p_session or item_key = p_expo::text)
  ) then
    return;
  end if;

  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency)
  values (p_user, 'expo', p_expo::text, p_session, p_amount, p_currency);

  -- **ここで初めて公開される。** すでに会期が始まっていれば触らない（延長は別の話）。
  -- `p_starts_at` を省略したときは従来どおり即時。
  update public.expos
     set duration_days = p_days,
         starts_at = coalesce(p_starts_at, now())
   where id = p_expo and starts_at is null;
end;
$$;

-- 旧6引数版はもう呼ばれない（webhookは7引数で呼ぶ）。残すと「日時を選べない経路が
-- まだある」と誤解されるので落とす。
drop function if exists public.record_expo_purchase(text, uuid, uuid, int, int, text);

revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text, timestamptz) from public;
revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text, timestamptz) from anon;
revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text, timestamptz) from authenticated;
grant execute on function public.record_expo_purchase(text, uuid, uuid, int, int, text, timestamptz) to service_role;

-- # 0052_room_capacity_transfer.sql — 作品スロットを部屋間で移動する(ユーザー指示 2026-08-10)
create or replace function public.transfer_room_capacity(p_from uuid, p_to uuid, p_amount int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_from_owner uuid;
  v_to_owner uuid;
  v_from_cap int;
  v_to_cap int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  if p_from = p_to then
    raise exception 'cannot transfer to the same room' using errcode = 'check_violation';
  end if;

  select owner_id, work_cap into v_from_owner, v_from_cap
    from public.galleries where id = p_from;
  select owner_id, work_cap into v_to_owner, v_to_cap
    from public.galleries where id = p_to;

  if v_from_owner is null or v_to_owner is null then
    raise exception 'no such room';
  end if;
  if v_from_owner <> v_me or v_to_owner <> v_me then
    raise exception 'not your room';
  end if;

  if v_from_cap - p_amount < 1 then
    raise exception 'source room must keep at least 1 slot' using errcode = 'check_violation';
  end if;

  if v_to_cap + p_amount > 15 then
    raise exception 'destination room cannot exceed 15 slots' using errcode = 'check_violation';
  end if;

  update public.galleries set work_cap = work_cap - p_amount where id = p_from;
  update public.galleries set work_cap = work_cap + p_amount where id = p_to;
end;
$$;

revoke all on function public.transfer_room_capacity(uuid, uuid, int) from public, anon;
grant execute on function public.transfer_room_capacity(uuid, uuid, int) to authenticated;

-- # 0053_drop_room_capacity_transfer.sql — 0052の「部屋間で枠を移動」を撤回する(ユーザー指摘 2026-08-11)
drop function if exists public.transfer_room_capacity(uuid, uuid, int);

-- # 0054_crop_align.sql — 作品画像のトリミング位置(ユーザー指示 2026-08-12)
alter table public.artworks
  add column if not exists crop_align text not null default 'center'
  check (crop_align in ('start', 'center', 'end'));

-- # 0055_artwork_purchase_links.sql — 購入リンクを複数化する(ユーザー指示 2026-08-12)
alter table public.artworks
  add column if not exists purchase_links jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artworks' and column_name = 'purchase_url'
  ) then
    execute $q$
      update public.artworks
      set purchase_links = jsonb_build_array(jsonb_build_object('label', '', 'url', purchase_url))
      where purchase_url is not null and purchase_url <> '' and purchase_links = '[]'::jsonb
    $q$;
  end if;
end $$;

alter table public.artworks drop column if exists purchase_url;

-- # 0056_report_dmca.sql — 通報にDMCA §512(c)(3)の法定要件を記録する(ユーザー決定 2026-08-12)
alter table public.reports
  add column if not exists kind text not null default 'other',
  add column if not exists claimant text not null default '' check (char_length(claimant) <= 200),
  add column if not exists work_identified text not null default '' check (char_length(work_identified) <= 1000),
  add column if not exists sworn boolean not null default false;
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports
  add constraint reports_kind_check
  check (kind in ('copyright', 'harassment', 'illegal', 'other'));
alter table public.reports drop constraint if exists reports_dmca_complete;
alter table public.reports
  add constraint reports_dmca_complete
  check (
    kind <> 'copyright'
    or (sworn and char_length(claimant) > 0 and char_length(work_identified) > 0)
  ) not valid;

-- # 0057_notify_unsubmit.sql — 会期中の取り下げを主催者に知らせる(ユーザー指示 2026-08-12)
/* ================= 1. 種別を1つ増やす ================= */
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'unsubmit', 'like', 'guestbook', 'announce'));
/* ================= 2. 取り下げを主催者に知らせる ================= */
create or replace function public.notify_expo_unsubmit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_artist_id uuid;
  v_artist text;
begin
  select x.owner_id, x.title, x.starts_at, x.ends_at
    into v_owner, v_title, v_starts, v_ends
    from public.expos x where x.id = old.expo_id;
  if v_owner is null then return old; end if;
  if v_starts is null or v_ends is null or now() >= v_ends then return old; end if;
  select a.owner_id into v_artist_id from public.artworks a where a.id = old.artwork_id;
  if v_artist_id is not null and v_owner is not distinct from v_artist_id then return old; end if;
  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = v_artist_id;
  perform public.push_notification_rollup(
    v_owner, 'unsubmit', null, null, coalesce(v_title, ''), v_artist
  );
  return old;
end;
$$;
revoke all on function public.notify_expo_unsubmit() from public, anon, authenticated;
drop trigger if exists expo_submissions_unsubmit_notify on public.expo_submissions;
create trigger expo_submissions_unsubmit_notify
  after delete on public.expo_submissions
  for each row execute function public.notify_expo_unsubmit();

-- # 0058_replace_placements.sql — 配置の書き換えを1トランザクションにする(ユーザー決定 2026-08-12・B案の前提工事)
-- 振る舞いは変えない。次の工程(枠の上限をDB側で強制する)の土台。
-- 旧経路は upsert と trim が別リクエストで、あいだの状態(枠を移す瞬間に上限+1行)が
-- コミットされていた。件数を数えるトリガはそこで正常な操作を拒否してしまう。
-- **security definer にしない** — placements の RLS(0037 placements_owner_all)を
-- そのまま効かせて、権限と同意の判定をこの関数に写さない。
create or replace function public.replace_placements(p_gallery uuid, p_rows jsonb)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  if not exists (
    select 1 from public.galleries g
     where g.id = p_gallery and g.owner_id = (select auth.uid())
  ) then
    raise exception 'replace_placements: not the owner of room %', p_gallery
      using errcode = '42501';
  end if;

  delete from public.placements where gallery_id = p_gallery;

  if p_rows is not null and jsonb_typeof(p_rows) = 'array' then
    insert into public.placements (
      gallery_id, artwork_id, slot_index,
      frame_override, mat_override, hanging_override, caption_override, light_override
    )
    select p_gallery,
           (r->>'artwork_id')::uuid,
           (r->>'slot_index')::int,
           r->>'frame_override',
           r->>'mat_override',
           r->>'hanging_override',
           r->>'caption_override',
           r->>'light_override'
      from jsonb_array_elements(p_rows) as r;
  end if;

  select count(*) into v_count from public.placements where gallery_id = p_gallery;
  return v_count;
end;
$$;

-- **service_role には渡さない** — この関数は auth.uid() が部屋の所有者であることを
-- 要求するので、service_role(claim 無し=null)ではどう呼んでも落ちる。渡しておくと
-- 「サーバ側から書ける」と読めてしまう(別視点レビュー指摘)。
revoke all on function public.replace_placements(uuid, jsonb) from public, anon, service_role;
grant execute on function public.replace_placements(uuid, jsonb) to authenticated;

-- # 0059_pool_limits.sql — 作品枠の上限をDB側で強制する(ユーザー選択 2026-08-12・B案の第2段)
-- 上限はこれまでブラウザの中だけで守られていた(アップロードAPIは容量300MBのみ・
-- artworks に件数のトリガ無し・placements のトリガは同意取り消し専用)。
-- 数える単位は口座全体(lib/limits.poolCapacityOf と同じ意味)。
-- 判定の材料は work_slot_pool / placement_pool_used の2つだけ(同じ意味の値を2か所で
-- 計算しない = DECISIONS 絶対ルール 2026-08-12)。
-- 「すでに超過している部屋」を閉じ込めないため、配置の側は「操作前より増やしていない
-- こと」も許す(枠は部屋の削除や合同展示からの離脱で普通に減る)。
-- UPDATE は物理上限だけ見る(RLSが移動元も移動先も所有者に限るので口座の合計は動かない)。
-- 遷移表は複数イベントのトリガに付けられないので、placements は insert 用と update 用の
-- 2本に分けて同じ関数を呼ぶ。
/* ================= 1. 判定の材料（この2つだけが権威） ================= */

-- 口座が持っている作品枠の合計。`lib/limits.poolCapacityOf` と同じ意味。
-- 下限を `5`（= `PLAN.worksPerGallery`。0038 が無料部屋の上限として使っている数字と同じ）
-- にしてあるのは、**部屋を1つも作っていない口座を締め出さないため**。`getMyGalleryRow`
-- は部屋が無ければ null を返す＝合計0になる口座が実在しうるので、素の合計で縛ると
-- 「招待されたので作品を上げたいが、部屋を作っていないので1点も上げられない」が起きる。
create or replace function public.work_slot_pool(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(g.work_cap), 0), 5)::int
    from public.galleries g
   where g.owner_id = p_owner;
$$;

-- 口座が**今**使っている配置の点数。同じ作品を2部屋に掛けたら2点として数える
-- （`lib/galleries.elsewherePlacedCount` が作品idで重複排除しないのと同じ理由 —
-- 消費するのは枠であって作品ではない）。
create or replace function public.placement_pool_used(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
   where g.owner_id = p_owner;
$$;

-- どちらも**トリガと `replace_placements` の中だけで使う**。誰にも grant しない
-- （`security definer` の関数は定義者の権限で走るので、トリガ経路には grant が要らない）。
-- 他人の口座の枠数や使用点数を問い合わせられるようにする理由が無い。
--
-- **`from public` だけでは外れない。** Supabase は `alter default privileges ... grant
-- execute on functions to anon, authenticated, service_role` を設定してあるので、
-- `public` スキーマに作った関数には**3ロールぶんの明示的な grant が最初から付く**
-- （`revoke ... from public` が消すのは PUBLIC の暗黙の grant だけ）。ロール名を並べて
-- 明示的に revoke する。※この穴は 0059 のSQLテスト22が実際に検出した。
revoke all on function public.work_slot_pool(uuid) from public, anon, authenticated, service_role;
revoke all on function public.placement_pool_used(uuid) from public, anon, authenticated, service_role;

-- 「操作前の使用点数」を申告する入口。**呼び手自身の分しか見ない**ので、これだけは
-- `authenticated` に開ける（引数が無いので他人の口座を指定できない）。
--
-- なぜ関数が要るか: `replace_placements` は `security definer` に**しない**設計
-- （0058 の要点。placements の RLS をそのまま効かせるため）なので、呼び手の権限で走る。
-- つまり上で revoke した `placement_pool_used` を直接は呼べない。数え方を
-- `replace_placements` の中に書き写せば呼べるが、それは同じ意味の値が2か所になる
-- （DECISIONS【絶対ルール】2026-08-12）。definer の入口を1つ挟むのが、数え方を1か所に
-- 保ったまま権限を閉じる唯一の形。
create or replace function public.note_placement_baseline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config(
    'xibit.placement_baseline',
    public.placement_pool_used((select auth.uid()))::text,
    true  -- このトランザクション限り
  );
end;
$$;

revoke all on function public.note_placement_baseline() from public, anon, service_role;
grant execute on function public.note_placement_baseline() to authenticated;

/* ================= 2. 作品の点数 ================= */

create or replace function public.enforce_artwork_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_used int;
  v_pool int;
begin
  -- 1文で複数人ぶんが入ることは今の経路では無い（`insertArtworkRow` は1行ずつ）が、
  -- 所有者ごとに数えておけば将来の一括 insert でも正しい。
  for r in select distinct n.owner_id from new_rows n loop
    select count(*)::int into v_used from public.artworks a where a.owner_id = r.owner_id;
    v_pool := public.work_slot_pool(r.owner_id);
    if v_used > v_pool then
      raise exception 'work slot pool exceeded: % works for a pool of %', v_used, v_pool;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_artwork_pool() from public, anon, authenticated, service_role;

-- **statement 単位 + 遷移表**にしてある。行単位のトリガだと、1文で複数行入るときに
-- 「同じ文で入った行が見えるか」が直感に反しやすく、数え方が状況で変わる。
-- statement 単位なら文が終わった後の確定した状態を1回数えるだけで、安いし曖昧さが無い。
drop trigger if exists artworks_pool_limit on public.artworks;
create trigger artworks_pool_limit
  after insert on public.artworks
  referencing new table as new_rows
  for each statement execute function public.enforce_artwork_pool();

/* ================= 3. 配置の点数 ================= */

create or replace function public.enforce_placement_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_in_room int;
  v_used int;
  v_pool int;
  v_baseline int;
begin
  -- ① 1部屋の物理上限。どの間取りも 15 枠しか持たない（0038 が work_cap の上限として
  --    使っている数字と同じ）。これを超えた分は描画されないので実害は薄いが、
  --    「掛かっているのに見えない」行をDBに溜めない。
  for r in select distinct n.gallery_id from new_rows n loop
    select count(*)::int into v_in_room
      from public.placements p where p.gallery_id = r.gallery_id;
    if v_in_room > 15 then
      raise exception 'room slot limit exceeded: % placements in one room (max 15)', v_in_room;
    end if;
  end loop;

  -- ② 口座全体。冒頭の注記どおり「悪くしていないこと」で判定する。
  --
  -- **UPDATE では見ない。** `update placements set gallery_id = …` は行を部屋のあいだで
  -- 動かすだけで、RLS（0037）が移動元も移動先も所有者に限っているので**口座の合計は
  -- 動かせない**（他人の部屋へは移せない）。つまりここで見ても得るものが無く、
  -- 「既に超過している口座がまったく無害な UPDATE で拒否される」誤拒否だけが増える。
  -- 一方 ① の物理上限は UPDATE で破れる（別視点レビュー指摘 2026-08-13: A室の 0..14 と
  -- B室の 15 を B室へ寄せると16行になる）ので、そちらは UPDATE でも見る。
  if tg_op <> 'INSERT' then
    return null;
  end if;
  v_baseline := coalesce(nullif(current_setting('xibit.placement_baseline', true), ''), '0')::int;
  for r in
    select distinct g.owner_id
      from new_rows n join public.galleries g on g.id = n.gallery_id
  loop
    v_used := public.placement_pool_used(r.owner_id);
    v_pool := public.work_slot_pool(r.owner_id);
    if v_used > v_pool and v_used > v_baseline then
      raise exception 'work slot pool exceeded: % placements for a pool of %', v_used, v_pool;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_placement_pool() from public, anon, authenticated, service_role;

-- **UPDATE も見る**（物理上限だけ。理由は関数の中の注記）。アプリは `placements` を
-- 1か所も update していない（全部 select と、RPCの delete+insert）ので、これで拒否される
-- 正常な経路は無い。
--
-- **トリガは2本に分ける。** Postgres は「遷移表（`referencing new table`）は複数イベントの
-- トリガには付けられない」（`transition tables cannot be specified for triggers with more
-- than one event`）。関数は共有し、中で `tg_op` を見て役割を分ける。
drop trigger if exists placements_pool_limit on public.placements;
create trigger placements_pool_limit
  after insert on public.placements
  referencing new table as new_rows
  for each statement execute function public.enforce_placement_pool();

drop trigger if exists placements_room_limit_update on public.placements;
create trigger placements_room_limit_update
  after update on public.placements
  referencing new table as new_rows
  for each statement execute function public.enforce_placement_pool();

/* ================= 4. 操作前の点数を記録する（0058 の関数を置き換え） ================= */
-- 0058 との差は `set_config` の1文だけ。**判定はしない** — ここで数えたら、上の
-- トリガと合わせて規則が2か所になる（絶対ルール違反）。ここがやるのは「事実の申告」だけ。
create or replace function public.replace_placements(p_gallery uuid, p_rows jsonb)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  if not exists (
    select 1 from public.galleries g
     where g.id = p_gallery and g.owner_id = (select auth.uid())
  ) then
    raise exception 'replace_placements: not the owner of room %', p_gallery
      using errcode = '42501';
  end if;

  -- delete の**前**の点数を申告する（判定はトリガがやる）。
  perform public.note_placement_baseline();

  delete from public.placements where gallery_id = p_gallery;

  if p_rows is not null and jsonb_typeof(p_rows) = 'array' then
    insert into public.placements (
      gallery_id, artwork_id, slot_index,
      frame_override, mat_override, hanging_override, caption_override, light_override
    )
    select p_gallery,
           (r->>'artwork_id')::uuid,
           (r->>'slot_index')::int,
           r->>'frame_override',
           r->>'mat_override',
           r->>'hanging_override',
           r->>'caption_override',
           r->>'light_override'
      from jsonb_array_elements(p_rows) as r;
  end if;

  select count(*) into v_count from public.placements where gallery_id = p_gallery;
  return v_count;
end;
$$;

revoke all on function public.replace_placements(uuid, jsonb) from public, anon, service_role;
grant execute on function public.replace_placements(uuid, jsonb) to authenticated;

-- # 0060_profile_cv.sql — プロフィールに「来歴」を足す(ユーザー要望 2026-08-13)
-- 来歴（展示歴・受賞歴）は箇条書きで積み上がる記録で、読み物である自己紹介(bio)とは
-- 書き方も読まれ方も違う。別列にすれば 3D の情報パネルでタブに分けて出せる。
-- ※ 上の profiles の create table にも同じ列が入っている（新規環境はそこで作られる）。
alter table public.profiles add column if not exists cv text not null default '';

comment on column public.profiles.cv is
  '来歴（展示歴・受賞歴）。自己紹介(bio)とは別欄。公開ページと3Dの情報パネルで、自己紹介と並ぶタブとして出す。';

-- # 0061_expo_room_scope.sql — 合同展示を1展示1部屋にし、作品を専用プールへ分離する(ユーザー決定 2026-08-13)
-- 部屋を合同展示に切り替えると、口座全体の作品ライブラリ（他の通常展示の部屋とも共有）が
-- そのまま「作品」タブに並び、参加作家には「今まで使っている設定が反映されている」ように
-- 見えて混乱するという指摘があった。①合同展示は1展示につき1部屋までに制限する
-- ②合同展示の部屋は、口座の共有プールとは独立した作品プールにする（0から積む）。

alter table public.artworks
  add column if not exists gallery_id uuid references public.galleries (id) on delete cascade;

create index if not exists artworks_gallery_idx on public.artworks (gallery_id) where gallery_id is not null;

create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_purchased int;
  v_expo_owner uuid;
begin
  if new.expo_id is not null then
    select owner_id into v_expo_owner from public.expos where id = new.expo_id;
    if v_expo_owner is distinct from new.owner_id then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.galleries where expo_id = new.expo_id and id <> new.id
    ) then
      raise exception 'this exhibition already has a room' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = new.owner_id
     and expo_id is null;

  select count(*) into v_purchased
    from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    if v_paid >= v_purchased then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_purchased
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
  else
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.switch_room_expo(p_gallery uuid, p_expo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_room_owner uuid;
  v_room_expo uuid;
  v_expo_owner uuid;
  v_placements int;
  v_free int;
  v_paid int;
  v_purchased int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_room_owner, v_room_expo
    from public.galleries where id = p_gallery;
  if v_room_owner is null then
    raise exception 'no such room';
  end if;
  if v_room_owner <> v_me then
    raise exception 'not your room';
  end if;

  if v_room_expo is not distinct from p_expo then
    return;
  end if;

  select count(*) into v_placements from public.placements where gallery_id = p_gallery;
  if v_placements > 0 then
    raise exception 'room is not empty' using errcode = 'check_violation';
  end if;

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    -- 1展示1部屋（ユーザー決定 2026-08-13）。
    if exists (
      select 1 from public.galleries where expo_id = p_expo and id <> p_gallery
    ) then
      raise exception 'this exhibition already has a room' using errcode = 'check_violation';
    end if;
    update public.galleries
       set expo_id = p_expo, slots_included = true, work_cap = 15
     where id = p_gallery;
    return;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = v_me and expo_id is null and id <> p_gallery;
  select count(*) into v_purchased from public.purchases
   where user_id = v_me and kind = 'room';

  if v_free = 0 then
    update public.galleries set expo_id = null, slots_included = false, work_cap = 5
     where id = p_gallery;
  elsif v_paid < v_purchased then
    update public.galleries set expo_id = null, slots_included = true, work_cap = 15
     where id = p_gallery;
  else
    raise exception 'no unused room purchase: buy a room first' using errcode = 'check_violation';
  end if;

  -- この部屋はもう合同展示の部屋ではないので、専用プールに積んであった作品
  -- （`gallery_id = p_gallery`）は行き場を失う。空にする条件は「placementsが0件」
  -- だけ（上のチェック）で、**アップロード済みだが未配置の作品**は残っている
  -- ── そのまま `gallery_id` を残すとダッシュボードのどこからも見えなくなる
  -- （通常展示の共有プールは `gallery_id is null` だけを見るため）。共有プールへ
  -- 解放する（ユーザー決定 2026-08-13の専用プール化に伴う後始末）。
  update public.artworks set gallery_id = null where gallery_id = p_gallery;
end;
$$;

create or replace function public.work_slot_pool(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(g.work_cap), 0), 5)::int
    from public.galleries g
   where g.owner_id = p_owner
     and g.expo_id is null;
$$;

create or replace function public.placement_pool_used(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
   where g.owner_id = p_owner
     and g.expo_id is null;
$$;

create or replace function public.enforce_artwork_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_used int;
  v_pool int;
  g record;
  v_room_used int;
  v_room_cap int;
begin
  -- gallery_id を名乗った行は、その部屋が①呼び手自身の部屋で ②合同展示の部屋
  -- （expo_id が not null）であることを確認する。通常展示の部屋のidを付けて
  -- 共有プールの上限を回避する経路を防ぐ。
  for g in select distinct n.gallery_id, n.owner_id from new_rows n where n.gallery_id is not null loop
    if not exists (
      select 1 from public.galleries x
       where x.id = g.gallery_id and x.owner_id = g.owner_id and x.expo_id is not null
    ) then
      raise exception 'artworks.gallery_id must be one of your own joint-exhibition rooms';
    end if;
  end loop;

  -- ①通常展示の共有プール。
  for r in select distinct n.owner_id from new_rows n where n.gallery_id is null loop
    select count(*)::int into v_used
      from public.artworks a where a.owner_id = r.owner_id and a.gallery_id is null;
    v_pool := public.work_slot_pool(r.owner_id);
    if v_used > v_pool then
      raise exception 'work slot pool exceeded: % works for a pool of %', v_used, v_pool;
    end if;
  end loop;

  -- ②合同展示の部屋専用プール。口座の共有プールへは足さない・引かない ── その部屋
  -- 自身の work_cap（15）だけで完結させる。
  for g in select distinct n.gallery_id from new_rows n where n.gallery_id is not null loop
    select count(*)::int into v_room_used from public.artworks a where a.gallery_id = g.gallery_id;
    select work_cap into v_room_cap from public.galleries where id = g.gallery_id;
    if v_room_used > coalesce(v_room_cap, 0) then
      raise exception 'room work slot pool exceeded: % works for a room pool of %', v_room_used, v_room_cap;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_artwork_pool() from public, anon, authenticated, service_role;

-- # 0062_expo_participant_rooms.sql — 合同展示を「参加作家ごとに部屋」の形にする(ユーザー決定 2026-08-13)
-- 合同展示を「参加作家ごとに部屋」の形にする（ユーザー決定 2026-08-13）
--
-- 背景: 招待→承諾のあと作家が触るUIが「受信箱の中の作品トレイ」という特殊な形で、
-- 通常の部屋編集（作品／部屋／配置／公開のタブ）と見た目も操作感も違いすぎるという
-- 指摘があった。ユーザー決定は次のとおり:
--   ①合同展示は「1展示につき1部屋」ではなく「1展示・1作家につき1部屋」に直す
--     （主催者も招待作家も同じ部屋を1つずつ持つ。0061の「1展示1部屋」を一部訂正）
--   ②招待を承諾した瞬間に、その作家自身の部屋を自動で作る
--   ③作家はその部屋を、通常展示と同じ「作品／部屋／配置／公開」タブで編集する。
--     「公開」は主催者だけ会期を選んで決済する画面のまま、**作家側は「準備できた」
--     トグルにする**（オンにすると主催者に通知が飛ぶ）。「参加者」タブは主催者専用のまま。
--   ④これに伴い、旧来の「作家が出す作品を選ぶ→主催者が自分の壁に掛ける」仕組み
--     （expo_submissions・受信箱の作品トレイ）は完全に置き換える。作家は自分の部屋に
--     自分で掛けるので、主催者が代わりに掛ける必要がない。表・関数は消さない
--     （既存データを壊さない）が、アプリからは呼ばなくなる。
--
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。0044〜0061 を先に適用しておくこと。

/* ================= 1. artworks.gallery_id を安全な削除挙動にする ================= */
-- 0061 は `on delete cascade` にしていた。参加作家の部屋がこの先「招待が無くなれば
-- 自動で消える」対象になる（下の 5.）ため、部屋を消しても**アップロード済みの作品
-- そのものは失われない**よう `on delete set null` に変える（共有プールへ解放される、
-- `switch_room_expo` の「通常展示に戻す」と同じ考え方）。
alter table public.artworks drop constraint if exists artworks_gallery_id_fkey;
alter table public.artworks
  add constraint artworks_gallery_id_fkey
  foreign key (gallery_id) references public.galleries (id) on delete set null;

/* ================= 2. 通知の種類を1つ増やす ================= */
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'unsubmit', 'room_ready', 'like', 'guestbook', 'announce'));

/* ================= 3. 部屋の上限: 「1展示1部屋」→「1展示・1作家1部屋」 ================= */
-- ①新規の部屋（INSERT経路）。**所有者チェックも緩める**: 主催者本人だけでなく、
-- その展示に**承諾済みの招待がある作家**も自分の部屋を作れるようにする。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_purchased int;
  v_expo_owner uuid;
begin
  if new.expo_id is not null then
    select owner_id into v_expo_owner from public.expos where id = new.expo_id;
    if v_expo_owner is distinct from new.owner_id then
      if not exists (
        select 1 from public.expo_invites i
         where i.expo_id = new.expo_id and i.artist_id = new.owner_id and i.status = 'accepted'
      ) then
        raise exception 'expo does not belong to this user' using errcode = 'check_violation';
      end if;
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
    -- 1展示・1作家1部屋（migration 0062。0061の「1展示1部屋」を訂正）。
    if exists (
      select 1 from public.galleries
       where expo_id = new.expo_id and owner_id = new.owner_id and id <> new.id
    ) then
      raise exception 'you already have a room in this exhibition' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = new.owner_id
     and expo_id is null;

  select count(*) into v_purchased
    from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    if v_paid >= v_purchased then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_purchased
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
  else
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ②既存の部屋を合同展示へ切り替える経路（`switch_room_expo`）。同じ2点を緩める:
-- 承諾済みの招待があれば主催者以外でも入れる／上限は「自分がこの展示に持っている部屋」で見る。
create or replace function public.switch_room_expo(p_gallery uuid, p_expo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_room_owner uuid;
  v_room_expo uuid;
  v_expo_owner uuid;
  v_placements int;
  v_free int;
  v_paid int;
  v_purchased int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_room_owner, v_room_expo
    from public.galleries where id = p_gallery;
  if v_room_owner is null then
    raise exception 'no such room';
  end if;
  if v_room_owner <> v_me then
    raise exception 'not your room';
  end if;

  if v_room_expo is not distinct from p_expo then
    return;
  end if;

  select count(*) into v_placements from public.placements where gallery_id = p_gallery;
  if v_placements > 0 then
    raise exception 'room is not empty' using errcode = 'check_violation';
  end if;

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      if not exists (
        select 1 from public.expo_invites i
         where i.expo_id = p_expo and i.artist_id = v_me and i.status = 'accepted'
      ) then
        raise exception 'expo does not belong to this user' using errcode = 'check_violation';
      end if;
    end if;
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    -- 1展示・1作家1部屋（migration 0062）。
    if exists (
      select 1 from public.galleries where expo_id = p_expo and owner_id = v_me and id <> p_gallery
    ) then
      raise exception 'you already have a room in this exhibition' using errcode = 'check_violation';
    end if;
    update public.galleries
       set expo_id = p_expo, slots_included = true, work_cap = 15
     where id = p_gallery;
    return;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = v_me and expo_id is null and id <> p_gallery;
  select count(*) into v_purchased from public.purchases
   where user_id = v_me and kind = 'room';

  if v_free = 0 then
    update public.galleries set expo_id = null, slots_included = false, work_cap = 5
     where id = p_gallery;
  elsif v_paid < v_purchased then
    update public.galleries set expo_id = null, slots_included = true, work_cap = 15
     where id = p_gallery;
  else
    raise exception 'no unused room purchase: buy a room first' using errcode = 'check_violation';
  end if;

  update public.artworks set gallery_id = null where gallery_id = p_gallery;
end;
$$;

/* ================= 4. 承諾した瞬間に、その作家自身の部屋を自動で作る ================= */
-- `expo_invites` への insert/update（status列）で発火。呼び手は `respondToInvite`
-- （直接UPDATE）・`request_expo_invite`／`approve_expo_request`（RPC内部のUPDATE）の
-- どれでもよい ── トリガにしたのはこの3経路すべてを1か所で確実に拾うため。
create or replace function public.create_room_on_expo_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_n int := 1;
  v_title text;
begin
  if new.status <> 'accepted' then return new; end if;
  if exists (
    select 1 from public.galleries where expo_id = new.expo_id and owner_id = new.artist_id
  ) then
    return new; -- 既にある（招き直し等）。二重に作らない。
  end if;

  select coalesce(nullif(x.title, ''), x.slug) into v_title from public.expos x where x.id = new.expo_id;

  -- 一意制約は (owner_id, slug)。展示idの先頭8桁 + 連番で、この作家の他の部屋と
  -- ぶつからない名前にする。
  loop
    v_slug := 'expo-' || substr(new.expo_id::text, 1, 8) || '-' || v_n;
    exit when not exists (
      select 1 from public.galleries where owner_id = new.artist_id and slug = v_slug
    );
    v_n := v_n + 1;
  end loop;

  insert into public.galleries (owner_id, expo_id, slug, title, slots_included, work_cap)
  values (new.artist_id, new.expo_id, v_slug, coalesce(v_title, ''), true, 15);
  return new;
end;
$$;

revoke all on function public.create_room_on_expo_accept() from public, anon, authenticated, service_role;

drop trigger if exists expo_invites_create_room on public.expo_invites;
create trigger expo_invites_create_room
  after insert or update of status on public.expo_invites
  for each row execute function public.create_room_on_expo_accept();

/* ================= 5. 辞退・取り消しで、作家自身の部屋も一緒に消える ================= */
-- 0047 の `drop_placements_on_expo_revoke` を差し替える。旧経路（主催者の壁に掛けた分・
-- expo_submissions）の後始末はそのまま残し、末尾に「作家自身の部屋を消す」を足す。
-- その部屋は招待がきっかけで自動で作られたものなので、招待が無くなれば一緒に消える
-- のが自然（1.の`on delete set null`により、アップロード済みの作品自体は失われない）。
create or replace function public.drop_placements_on_expo_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expo uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_expo := old.expo_id; v_artist := old.artist_id;
  else
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_expo := new.expo_id; v_artist := new.artist_id;
  end if;

  -- 旧: 主催者の壁に掛かっていた分（提出モデル。後方互換のため経路は残す）。
  delete from public.placements p
   using public.galleries g, public.artworks a
   where p.gallery_id = g.id
     and g.expo_id = v_expo
     and a.id = p.artwork_id
     and a.owner_id = v_artist
     and a.owner_id <> g.owner_id;

  delete from public.expo_submissions s
   using public.artworks a
   where s.expo_id = v_expo
     and a.id = s.artwork_id
     and a.owner_id = v_artist;

  -- 新: 作家自身の部屋（migration 0062）。
  delete from public.galleries where expo_id = v_expo and owner_id = v_artist;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

/* ================= 6. 「準備できた」トグル（作家→主催者への通知） ================= */
alter table public.galleries add column if not exists expo_ready_at timestamptz;

create or replace function public.set_expo_room_ready(p_gallery uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
  v_expo uuid;
  v_expo_owner uuid;
  v_expo_title text;
  v_artist text;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_owner, v_expo from public.galleries where id = p_gallery;
  if v_owner is null then
    raise exception 'no such room';
  end if;
  if v_owner <> v_me then
    raise exception 'not your room';
  end if;
  if v_expo is null then
    raise exception 'not a joint-exhibition room' using errcode = 'check_violation';
  end if;

  update public.galleries
     set expo_ready_at = case when p_ready then now() else null end
   where id = p_gallery;

  if not p_ready then return; end if;

  select owner_id, title into v_expo_owner, v_expo_title from public.expos where id = v_expo;
  -- 主催者自身の部屋なら、自分に通知しない。
  if v_expo_owner is null or v_expo_owner = v_me then return; end if;

  select coalesce(display_name, username) into v_artist from public.profiles where id = v_me;
  perform public.push_notification(
    v_expo_owner, 'room_ready', p_gallery, null, coalesce(v_expo_title, ''), '', v_artist
  );
end;
$$;

revoke all on function public.set_expo_room_ready(uuid, boolean) from public, anon;
grant execute on function public.set_expo_room_ready(uuid, boolean) to authenticated;

/* ================= 7. 主催者が、自分の展示に居る部屋を一覧できる ================= */
-- `galleries_owner_all` は自分の行にしか効かない。ExpoManagerで「誰の部屋が
-- できているか」を見せるには、**その展示の主催者に限って**他の作家の部屋を
-- 読めるようにする必要がある（書き込みはできない — 更新系ポリシーは触っていない）。
drop policy if exists "galleries_select_expo_owner" on public.galleries;
create policy "galleries_select_expo_owner"
  on public.galleries for select
  using (
    expo_id is not null
    and exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );
