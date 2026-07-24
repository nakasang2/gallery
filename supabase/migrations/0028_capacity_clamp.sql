-- Clamp capacity purchases to the room's physical max (docs/DECISIONS 2026-07-24).
-- The checkout route already clamps quantity against work_cap read at session
-- creation, but two in-flight checkouts on the same room could each pass that
-- check and sum past the max. record_capacity_purchase adds unconditionally, so
-- we cap the result here — the single atomic, race-proof gate. 15 = every
-- layout's slot count (lib/limits MAX_WORKS_PER_ROOM); keep the two in step.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

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
