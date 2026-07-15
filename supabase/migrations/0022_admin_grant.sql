-- Admin manual entitlement grants (unlock a paid item for a specific user).
-- The purchases ledger (0016) has NO client insert policy on purpose — only
-- server-side writes. These two SECURITY DEFINER functions add an admin-only
-- write path: they run as the owner (so they can write the ledger) but reject
-- any caller that isn't an admin (is_admin(), 0017). Granted rows carry
-- sku='admin_grant' and amount_jpy=NULL so they never count as revenue.
-- Item vocabulary is open (kind + item_key), so future paid themes/layouts work
-- with no schema change — the admin UI just lists whatever presets exist.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

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
