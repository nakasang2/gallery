-- 作品スロットを部屋間で移動する（ユーザー指示 2026-08-10、DECISIONS 2026-08-10）
--
-- 背景: 無料ユーザーが合同展示の部屋を追加すると、元の個人部屋が5枠・新しい合同展示
-- 部屋が15枠と別々に固定され、合計20枠なのに配分を変えられない、との指摘。
-- 決定（案B）: `galleries.work_cap` の構造は変えず、口座内の合計は変えないまま
-- 部屋間で `work_cap` を移動できる経路を新設する（案A＝口座残高テーブルへの全面
-- 移行は却下。既存の等級ロジック・購入経路の大改修になるため）。
--
-- 守ること:
--   ①呼び手が移動元・移動先どちらの部屋も所有していること（他人の部屋を巻き込まない）
--   ②移動元は移動後も最低1枠残す（0枠の部屋を作らない）
--   ③移動先は物理上限（MAX_WORKS_PER_ROOM=15、lib/limits.ts）を超えない
--   ④合計は移動元から引いた分をそのまま移動先に足すだけ＝口座内の合計は変わらない
--
-- `work_cap` の直接UPDATEは`guard_work_cap_raise`（0036）が
-- 「authenticated/anonからの引き上げ」を拒否するので、`switch_room_expo`（0050）と
-- 同じ作法で`security definer`のRPCを経路として新設する（definer内では
-- current_userが関数所有者になり、guardの`in ('authenticated','anon')`判定を
-- 素通りできる ── LESSONS 2026-08-09 と同じ理屈）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.transfer_room_capacity(p_from uuid, p_to uuid, p_amount int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_from_owner uuid;
  v_to_owner uuid;
  v_from_cap int;
  v_to_cap int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  if p_from = p_to then
    raise exception 'cannot transfer to the same room' using errcode = 'check_violation';
  end if;

  select owner_id, work_cap into v_from_owner, v_from_cap
    from public.galleries where id = p_from;
  select owner_id, work_cap into v_to_owner, v_to_cap
    from public.galleries where id = p_to;

  if v_from_owner is null or v_to_owner is null then
    raise exception 'no such room';
  end if;
  if v_from_owner <> v_me or v_to_owner <> v_me then
    raise exception 'not your room';
  end if;

  -- ②移動元は最低1枠残す（0枠の部屋を作らない。既存の作品が上限を超える場合の
  -- 表示は既存の overflow 処理＝lib/roomPlan.overflowCount に委ねる）。
  if v_from_cap - p_amount < 1 then
    raise exception 'source room must keep at least 1 slot' using errcode = 'check_violation';
  end if;

  -- ③移動先は物理上限を超えない。15はMAX_WORKS_PER_ROOM（lib/limits.ts）と同じ値を
  -- ここにも直接書く（switch_room_expo 0050 / enforce_room_allowance 0044 と同じ作法。
  -- 変えるときは両方直す）。
  if v_to_cap + p_amount > 15 then
    raise exception 'destination room cannot exceed 15 slots' using errcode = 'check_violation';
  end if;

  update public.galleries set work_cap = work_cap - p_amount where id = p_from;
  update public.galleries set work_cap = work_cap + p_amount where id = p_to;
end;
$$;

revoke all on function public.transfer_room_capacity(uuid, uuid, int) from public, anon;
grant execute on function public.transfer_room_capacity(uuid, uuid, int) to authenticated;
