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
