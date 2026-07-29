-- Frames become sellable (docs/DECISIONS 2026-07-29).
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
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. purchases.kind に 'frame' を足す ================= */
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check
  check (kind in ('theme', 'layout', 'frame', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room'));

/* ================= 2. 管理者の手動付与も 'frame' を受ける ================= */
-- Same body as 0022 with 'frame' added to the accepted kinds. Kept as a full
-- create-or-replace (not an ALTER) because that is the only way to change a
-- plpgsql function, and re-running it is safe.
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
