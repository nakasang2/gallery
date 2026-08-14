-- 参加作家が合同展示から抜け落ちるのを塞ぐ（ユーザー決定 2026-08-14。DECISIONS に全文）
--
-- 背景: 本番で招待された作家が**合同展示から消える**事故が起きた。原因は
-- `switch_room_expo(部屋, null)`（画面では `RoomExpoBadge` の「通常展示に戻す」）が
-- **表示の切り替えではなく変換**で、参加作家が押すと自分の合同展示の部屋が通常展示の
-- 部屋に変わり、展示から居なくなること。招待は `accepted` のまま残るので 0062 の
-- `create_room_on_expo_accept` は二度と発火せず、**復帰する導線が1つも無い**状態になる。
-- 実データで確定: 残った部屋の `slug` が自動生成名 `expo-21f070ac-1` のまま `expo_id`
-- だけ null で、`created_at` が承認時刻とマイクロ秒まで一致していた。
--
-- ここで直すのは1つだけ ── `switch_room_expo` が、**その展示の主催者でない人**からの
-- 「通常展示に戻す」を拒否する。参加作家が降りる道は受信箱の「降りる」（招待を
-- `declined` にする＝0062 のトリガが部屋も片付ける）だけにする。画面側でもボタンを
-- 出さないが、**判断の権威はDBに置く**（DECISIONS【絶対ルール】2026-08-12）。
--
-- **「登録したら通常展示の部屋がある」はここでは実装しない**（同じ日の決定2）。
-- 一度この migration に `handle_new_user` での部屋の自動作成として書いたが、2つの
-- 理由で画面側（既存の `createGallery` を呼ぶ）に移した:
--   ①「最初の部屋の作り方」（無料テーマ `whitecube` / 無料間取り `corridor` / 5枠 /
--     無料等級）のレシピが `lib/entitlements` `lib/limits` `lib/galleries` と**SQLの
--     2か所**に増える ── DECISIONS【絶対ルール】2026-08-12 が禁じている形そのもの。
--   ②実測で **SQLテスト17ファイル中10ファイル**が「無料の部屋は既にある」で落ちた。
--     各テストは自分で無料の部屋を作って土台にしているため。修正自体は可能だが、
--     10ファイルの書き換えが今回の不具合修正に混ざると検証が成立しない。
--
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。0001〜0062 を先に適用しておくこと。

/* ================= 参加作家は「通常展示に戻す」で展示から抜けられない ================= */
-- 0062 の関数に**1つだけ**足す（それ以外は0062のまま）。`p_expo is null`（＝展示から
-- 外す向き）のとき、その部屋が属している展示の主催者が自分でなければ拒否する。
--
-- **主催者には残す。** 主催者にとってこの操作は「自分の展示から自分の部屋を外す」で、
-- `ExpoManager` の「部屋を追加」が再び出るので取り返しがつく。参加作家には取り返しが
-- 無い（招待が `accepted` のままなので部屋が再生成されない）のが今回の事故だった。
create or replace function public.switch_room_expo(p_gallery uuid, p_expo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_room_owner uuid;
  v_room_expo uuid;
  v_expo_owner uuid;
  v_placements int;
  v_free int;
  v_paid int;
  v_purchased int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_room_owner, v_room_expo
    from public.galleries where id = p_gallery;
  if v_room_owner is null then
    raise exception 'no such room';
  end if;
  if v_room_owner <> v_me then
    raise exception 'not your room';
  end if;

  if v_room_expo is not distinct from p_expo then
    return;
  end if;

  select count(*) into v_placements from public.placements where gallery_id = p_gallery;
  if v_placements > 0 then
    raise exception 'room is not empty' using errcode = 'check_violation';
  end if;

  -- ★ 0063 で足した1点。展示から外せるのはその展示の主催者だけ。
  if p_expo is null and v_room_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = v_room_expo;
    if v_expo_owner is distinct from v_me then
      raise exception 'leave the exhibition from your invitations, not by switching this room'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      if not exists (
        select 1 from public.expo_invites i
         where i.expo_id = p_expo and i.artist_id = v_me and i.status = 'accepted'
      ) then
        raise exception 'expo does not belong to this user' using errcode = 'check_violation';
      end if;
    end if;
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    -- 1展示・1作家1部屋（migration 0062）。
    if exists (
      select 1 from public.galleries where expo_id = p_expo and owner_id = v_me and id <> p_gallery
    ) then
      raise exception 'you already have a room in this exhibition' using errcode = 'check_violation';
    end if;
    update public.galleries
       set expo_id = p_expo, slots_included = true, work_cap = 15
     where id = p_gallery;
    return;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = v_me and expo_id is null and id <> p_gallery;
  select count(*) into v_purchased from public.purchases
   where user_id = v_me and kind = 'room';

  if v_free = 0 then
    update public.galleries set expo_id = null, slots_included = false, work_cap = 5
     where id = p_gallery;
  elsif v_paid < v_purchased then
    update public.galleries set expo_id = null, slots_included = true, work_cap = 15
     where id = p_gallery;
  else
    raise exception 'no unused room purchase: buy a room first' using errcode = 'check_violation';
  end if;

  update public.artworks set gallery_id = null where gallery_id = p_gallery;
end;
$$;

revoke all on function public.switch_room_expo(uuid, uuid) from public, anon;
grant execute on function public.switch_room_expo(uuid, uuid) to authenticated;
