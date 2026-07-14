-- Stripe checkout support (REQUIREMENTS.md §11.7). Two pieces:
--   1. purchases.kind grows the values the webhook actually records
--      ('capacity' add-ons, future 'room' / 'theme_collection' rows).
--   2. An atomic capacity increment the webhook calls after a paid
--      "+N works" checkout — read-then-write from the client would race,
--      and RLS has no client-writable path to work_cap on purpose.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. purchases.kind の拡張 ================= */
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check
  check (kind in ('theme', 'layout', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room'));

/* ================= 2. キャパ加算RPC(webhook専用) ================= */
-- Runs as the function owner (postgres) so it can update galleries regardless
-- of RLS, but execution is granted to service_role ONLY — anon/authenticated
-- must not be able to raise their own cap for free. Returns the new cap, or
-- NULL when no row matched (wrong gallery id or not owned by p_owner).
create or replace function public.apply_capacity_addon(p_gallery uuid, p_owner uuid, p_amount int)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.galleries
     set work_cap = work_cap + p_amount
   where id = p_gallery
     and owner_id = p_owner
     and p_amount > 0
  returning work_cap;
$$;

revoke all on function public.apply_capacity_addon(uuid, uuid, int) from public;
revoke all on function public.apply_capacity_addon(uuid, uuid, int) from anon;
revoke all on function public.apply_capacity_addon(uuid, uuid, int) from authenticated;
grant execute on function public.apply_capacity_addon(uuid, uuid, int) to service_role;
