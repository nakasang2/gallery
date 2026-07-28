-- Record WHICH currency each purchase was charged in.
--
-- Why this must land before the first sale: the ledger stores only
-- `amount_jpy` (a legacy column name that has held USD *cents* since the
-- 2026-07-24 USD switch), and the webhook throws `session.currency` away.
-- Stripe Managed Payments / Adaptive Pricing can present the buyer their local
-- currency, in which case `amount_total` comes back in THAT currency's smallest
-- unit — ¥500 and $5.00 both arrive as the integer 500. Mixed into one column
-- with no currency, the admin revenue total silently becomes meaningless, and
-- there is no way to separate the rows afterwards. With zero purchases on
-- record today, adding the column now costs nothing; after the first sale it is
-- unrecoverable.
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
-- 前提: 0019_checkout.sql と 0028_capacity_clamp.sql を先に適用しておくこと。

/* ================= 1. purchases.currency ================= */
-- ISO-4217, lowercase, as Stripe reports it. Existing rows (if any) predate
-- multi-currency and were all charged in USD.
alter table public.purchases
  add column if not exists currency text not null default 'usd';

/* ================= 2. RPC に通貨を通す ================= */
-- The 5-argument version is dropped rather than left alongside: an overload
-- that silently ignores the currency is exactly the bug this migration exists
-- to remove.
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
