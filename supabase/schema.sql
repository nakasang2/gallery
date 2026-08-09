-- ============================================================================
-- Xibit360 — 全スキーマ統合ファイル(schema.sql)
-- ============================================================================
-- これ1枚を Supabase の SQL Editor に貼り付けて Run すれば、必要なテーブル・
-- RLS・関数・Storage が一括で作成されます(migrations 0001〜0039 を統合)。
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
-- (owner's folder); this column just holds its public URL, mirroring
-- artworks.purchase_url (0015). No schema beyond one nullable column.

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
-- ============================================================================
-- `/@username` がどの部屋を描くかを DB に持たせる。サブ部屋は `/@username/[slug]`。
-- 既存行は所有者ごとに最古の1室をバックフィルして玄関にする。
alter table public.galleries add column if not exists is_main boolean not null default false;

create unique index if not exists galleries_one_main_per_owner
  on public.galleries (owner_id) where is_main;

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

-- 部分ユニーク索引があるので、玄関の付け替えは同一トランザクションで行う。
create or replace function public.set_main_room(p_gallery uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
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

-- ============================================================================
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
-- ============================================================================
-- `tokyo-expo.xibit360.art`。ワイルドカード証明書は Vercel が NS 完全移管を要求し、
-- このゾーンは R2 の cdn.xibit360.art があるため移管できないので、**1件ずつ実在の
-- ホストとして登録**する。サブドメインは任意の別名で、展示は常に /@ハンドル でも公開される。
/* ================= 1. profiles.subdomain ================= */
-- 展示（＝アカウント）1つにつき1つ。部屋はこの下のパスなので、多室でも1つで足りる。
-- 形式は部屋のパス（SLUG_RE）と同じ文字種で、3文字以上。lib/expoHost の
-- EXPO_SUBDOMAIN_RE と対で保つこと。
alter table public.profiles add column if not exists subdomain text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_subdomain_format'
  ) then
    alter table public.profiles add constraint profiles_subdomain_format
      check (subdomain is null or subdomain ~ '^[a-z0-9-]{3,40}$');
  end if;
end $$;

-- 大文字小文字を区別せずユニーク（DNS は区別しないので、`Expo` と `expo` を
-- 別物として持てると片方が届かない別名になる）。null は何行あってもよい。
create unique index if not exists profiles_subdomain_key
  on public.profiles (lower(subdomain)) where subdomain is not null;

/* ================= 2. 本人は書き換えられない ================= */
-- サブドメインは**DNSとVercelの登録が伴って初めて機能する**ので、行だけ先に書き換え
-- られると「DBには入っているが届かない別名」ができ、canonical がそこを指してしまう
-- （＝検索に載るURLが死ぬ）。付与も剥奪も管理者経由に限る。
--
-- 0001 の `profiles_update_own` は列を絞っていないため、これは**そのポリシーの穴を
-- 塞ぐ追加のトリガ**。work_cap / slots_included と同じ作法で、`security invoker` に
-- して呼び手のロールを見る（definer にすると current_user が常に所有者になり素通りする
-- ── 実際に 0036 でやってしまった。LESSONS 2026-08-09）。
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

drop trigger if exists profiles_guard_subdomain on public.profiles;
create trigger profiles_guard_subdomain
  before update of subdomain on public.profiles
  for each row execute function public.guard_subdomain();

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

