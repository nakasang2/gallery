-- 容量購入がクランプされて一部しか反映されなくても'applied'を返していた穴を塞ぐ
-- （リリース前監査で発見・2026-08-20）
--
-- 背景: `record_capacity_purchase`（0019→0028→0031）は
--   update galleries set work_cap = least(work_cap + p_amount, 15) where id=p_gallery
--   get diagnostics v_updated = row_count;
--   if v_updated = 0 then return 'no_gallery'; end if;
--   return 'applied';
-- `v_updated` は「行が更新されたか」（1件ヒットしたか）しか見ておらず、**実際の増分が
-- p_amount 未満でも 'applied' を返す**。work_cap=13 の部屋にほぼ同時に2件の
-- capacity_addon（各2枠）が届くと、1件目で15に到達・2件目は least(15+2,15)=15＝実増分0
-- でも 'applied' が返り、webhook 側は成功として扱う。**課金は成立したが枠は増えない
-- 事象が無検知になっていた。**
--
-- チェックアウト側（app/api/checkout/route.ts）で購入時点の残り枠に収まるよう
-- quantity をクランプしているが、それは**チェックアウトセッション作成時点**の値で、
-- 決済完了までの間に別のセッションが先に枠を埋めれば古くなる（TOCTOU）。DB側の
-- クランプ自体は正しい（物理上限を超えさせない）ので、直すのは**戻り値**の側。
--
-- 直し方: 更新前の work_cap を行ロックしながら読み、実際の増分と要求量を比較する。
-- 同じ部屋への並行呼び出しは直列化される（後続の呼び出しは先の呼び出しがコミット
-- するまで待ち、待った後の最新値を読む）ので、読み取りと書き込みの間に他の書き込みが
-- 割り込む余地が無い。**ロックは `for update` ではなく `for no key update`** ──
-- `galleries` は `artworks`/`placements` 等から外部キー参照されており、それらの
-- INSERT は親行に `for key share` を取る。`for update` はそれと衝突するため、
-- 作品アップロード中に容量購入が来ると待たされる（またはその逆）。`work_cap` は
-- キー列ではないので `for no key update` で同じ直列化効果を、副作用無しで得られる。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

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
  v_old_cap int;
  v_new_cap int;
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

  -- Locks the row for the rest of this transaction: a concurrent call for the same
  -- gallery waits here until this one commits, then reads the value THIS call just
  -- wrote — so two overlapping purchases can never both compute their clamp against
  -- the same stale work_cap. `for no key update` (not `for update`): work_cap isn't
  -- part of any key, and this weaker lock doesn't conflict with the `for key share`
  -- that child-table inserts (artworks, placements, ...) take on this row via FK.
  select work_cap into v_old_cap
    from public.galleries
   where id = p_gallery and owner_id = p_user
   for no key update;

  if v_old_cap is null then
    return 'no_gallery';
  end if;

  -- Same transaction as the insert. Clamp to 15 so concurrent checkouts can
  -- never raise the cap past what any layout can physically display.
  v_new_cap := least(v_old_cap + p_amount, 15);
  update public.galleries set work_cap = v_new_cap where id = p_gallery;

  if v_new_cap - v_old_cap < p_amount then
    -- Charge IS recorded (the insert above already committed to it); the room just
    -- couldn't take the full amount. The caller logs this for manual reconciliation
    -- (refund the shortfall, or grant it to another room) — see the webhook.
    return 'partial';
  end if;
  return 'applied';
end;
$$;

revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) from public;
revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) from anon;
revoke all on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) from authenticated;
grant execute on function public.record_capacity_purchase(text, uuid, uuid, int, int, text) to service_role;
