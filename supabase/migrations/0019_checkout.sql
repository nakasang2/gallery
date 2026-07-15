-- Stripe checkout support (REQUIREMENTS.md §11.7). Two pieces:
--   1. purchases.kind grows the values the webhook actually records
--      ('capacity' add-ons, future 'room' / 'theme_collection' rows).
--   2. An atomic "record the payment AND bump the cap" function the webhook
--      calls after a paid "+N works" checkout. Doing both in one transaction,
--      keyed on the Stripe session id, means: retries are no-ops (the ledger
--      row dedupes), and a genuinely-charged purchase is ALWAYS recorded even
--      if the target room is gone — we never delete the record to force a retry.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

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
