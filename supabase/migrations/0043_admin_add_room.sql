-- 管理者が「展示室を追加」したら**部屋が実際に増える**ようにする
-- （ユーザー指示 2026-08-09「adminで展示室追加は、部屋がちゃんと追加されるようにして欲しい」）。
--
-- これまでの `grant_entitlement(kind => 'room')` は購入台帳に1行入れるだけで、
-- **枠が開くが部屋はできない**（作るのは本人が /me で「新しい部屋をつくる」を押したとき）。
-- 管理者から見ると「追加したのに増えない」ので、台帳と部屋を1回で作る RPC を用意する。
--
-- 設計:
--   ・**台帳→部屋の順で、1トランザクション**（関数呼び出しは暗黙に1トランザクション）。
--     逆順だと 0038 の `enforce_room_allowance` が「購入が無いのに部屋が増えた」と
--     判断して弾く。
--   ・部屋は**有料等級**（`slots_included = true` / `work_cap = 15`）で作る。$25 の部屋
--     購入と同じものを配るため。0038 の `guard_room_grade` は作成後の書き換えを禁じるので、
--     **insert の時点で正しく置く**しかない。
--   ・slug は空いている名前を選ぶ（`room-2`, `room-3`, …）。`unique (owner_id, slug)` に
--     ぶつかると失敗するので、既にある番号は飛ばす。
--   ・**冪等にしない**。「もう1室ふやす」は押した回数だけ増えるのが期待どおりで、
--     `on conflict do nothing` にすると2回目が黙って無視される。台帳の `item_key` は
--     毎回ちがう値にする。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.admin_add_room(p_user uuid, p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_n int;
  v_id uuid;
  v_title text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such profile';
  end if;

  -- ① 台帳に1行。**部屋を作る前**に入れる（0038 の番人が購入数を数えるので、
  --    順番が逆だと自分の insert が弾かれる）。`item_key` は毎回ちがう値にして、
  --    0034 の `on conflict (user_id, kind, item_key)` で2回目が消えないようにする。
  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy)
  values (p_user, 'room', 'admin-' || gen_random_uuid()::text, 'admin_grant', null);

  -- ② 空いている slug を探す。`room-2` から順に見る（1室目は `main` など既存の名前）。
  v_n := 2;
  loop
    v_slug := 'room-' || v_n;
    exit when not exists (
      select 1 from public.galleries g where g.owner_id = p_user and g.slug = v_slug
    );
    v_n := v_n + 1;
    if v_n > 100 then
      raise exception 'could not find a free slug for this owner';
    end if;
  end loop;

  v_title := nullif(trim(coalesce(p_title, '')), '');

  -- ③ 部屋。**有料等級で作る**（`slots_included = true` / `work_cap = 15`）。
  --    あとから引き上げる経路は 0038 の番人が閉じているので、ここで正しく置く。
  insert into public.galleries (owner_id, slug, title, slots_included, work_cap)
  --    題名の既定は `'My Gallery'`。アプリの `isPlaceholderTitle()` がこれを「未命名」と
  --    見るので、ダッシュボードのタブには題名ではなく slug（`room-2`）が出る ──
  --    **管理者が付けた仮の名前が作家の展示名として公開されるのを避ける**。日本語の
  --    既定値を入れないのも同じ理由（利用者の言語は分からない）。
  values (p_user, v_slug, coalesce(v_title, 'My Gallery'), true, 15)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_add_room(uuid, text) from public, anon;
grant execute on function public.admin_add_room(uuid, text) to authenticated;
