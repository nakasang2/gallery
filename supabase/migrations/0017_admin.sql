-- Admin role + read access for an in-app admin console (total revenue, owned
-- packages, every exhibition space). Until now the "admin" was whoever had the
-- Supabase SQL Editor / service-role key (see 0010_reports, 0016_purchases); this
-- adds a first-class admin identity in the DB and grants it cross-user SELECT via
-- RLS, so the /admin page can run on the same anon key + RLS model as the rest of
-- the app. There is deliberately no client-writable path to become an admin.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

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
