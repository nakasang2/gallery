-- 部屋を「通常展示 ↔ 合同展示」に切り替える（ユーザー指示 2026-08-10）
--
-- 背景: `galleries.expo_id` は**作成時にしか設定できなかった**（0044/0038のトリガは
-- `before insert` だけ）。ユーザーから「部屋を用意したら、右上のボタンで通常展示⇄合同展示
-- を切り替えられると良い」と要望されたが、後から expo_id を書き換える経路は無く、
-- もし単純な UPDATE を許すと今日塞いだ 0049 と同型の抜け穴が再び開く
-- （所有者チェックなし・work_cap上限なし・他人の展示への無断ただ乗り）。
--
-- **範囲はユーザー選択で「作成直後・空の部屋だけ」に絞った**（作品を置いた後の部屋を
-- 動かすと、参加作家の同意・配置・購入の巻き戻しが要る本格的な工事になるため）。
-- 「空」の定義は日付ではなく**そのroomのplacementsが0件であること**（時刻は改ざん
-- できるが、placementsの有無はDBが数えられる唯一の実測値）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 直接のUPDATEを塞ぐ ================= */
-- `galleries_owner_all` は列を絞れないので、`enforce_room_allowance`（work_cap/等級と
-- 同じ作法）と同様に追加のトリガで守る。`security invoker` にして呼び手のロールを見る
-- ── definer だと current_user が常に所有者になり素通りする（0036 で実際にやった）。
create or replace function public.guard_room_expo_switch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.expo_id is distinct from old.expo_id then
    raise exception 'switch a room''s exhibition via switch_room_expo()' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_guard_expo_switch on public.galleries;
create trigger galleries_guard_expo_switch
  before update of expo_id on public.galleries
  for each row execute function public.guard_room_expo_switch();

/* ================= 2. 切替の本体（唯一の書き込み経路） ================= */
/**
 * 部屋を合同展示に入れる（`p_expo` を指定）／通常展示に戻す（`p_expo` を null）。
 *
 * 守ること:
 *   ①呼び手がその部屋の所有者であること
 *   ②その部屋が**空**（placementsが0件）であること — 参加作家の同意や配置を
 *     巻き戻す工事はまだ無いので、何か置かれていたら拒否する
 *   ③合同展示に入れるときは、その展示が呼び手自身のものであること（他人の展示への
 *     ただ乗りは0049で塞いだのと同じ理由で禁止）
 *   ④通常展示に戻すときは、**戻した先の等級**（無料1室 or 購入済みの有料室）を
 *     この部屋を除いた台帳で判定する。空きが無ければ拒否する（「先に部屋を購入」と
 *     案内できるように、無言で変な状態にはしない）
 *
 * 場所代に含まれる部屋は物理上限まで使える設計（0044のコメント）なので、合同展示に
 * 入れるときは `addExpoRoom()` と同じ等級（work_cap=15・slots_included=true）に揃える。
 */
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

  -- 変化が無いなら何もしない（ボタンの二度押しでエラーにしない）。
  if v_room_expo is not distinct from p_expo then
    return;
  end if;

  select count(*) into v_placements from public.placements where gallery_id = p_gallery;
  if v_placements > 0 then
    raise exception 'room is not empty' using errcode = 'check_violation';
  end if;

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    -- **通常展示が0室になってはいけない。** `/@handle` が描く部屋（`mainRoomOf`。
    -- 旗が無ければ最古の部屋にフォールバックする）は「通常展示」の中から選ばれる。
    -- 唯一の部屋をここで合同展示に持っていくと、フォールバック先が無くなって
    -- 公開ページが誰も描けなくなる（削除していないのに削除したのと同じ結果）。
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    update public.galleries
       set expo_id = p_expo, slots_included = true, work_cap = 15
     where id = p_gallery;
    return;
  end if;

  -- 通常展示に戻す。**この部屋自身を除いて**数える（自分がこれから空ける枠に、
  -- 自分自身がまだ居座っているせいで弾かれては困る）。
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
end;
$$;

revoke all on function public.switch_room_expo(uuid, uuid) from public, anon;
grant execute on function public.switch_room_expo(uuid, uuid) to authenticated;
