-- 合同展示の部屋を「1展示1部屋」にし、作品を専用プールへ分離する（ユーザー決定 2026-08-13）
--
-- 背景: 部屋を合同展示に切り替えると、`/me` の「作品」タブに口座全体の作品ライブラリ
-- （他の通常展示の部屋とも共有）がそのまま並び、参加作家には「今まで使っている設定が
-- 反映されている」ように見えて混乱するという指摘があった。ユーザー決定は2点:
--   ①合同展示は1展示につき1部屋までに制限する（`ExpoManager`の「部屋を追加」は
--     大きな展示で複数の物理部屋を持たせる用途を想定していたが、撤回する）
--   ②合同展示の部屋は、口座の共有プールとは独立した作品プールにする（0から積む）
--
-- ②は 2026-08-12 の決定（「作品スロットの合計は個人の部屋⇄合同展示の部屋の間でも
-- 成り立つ」＝0059）を一部戻す。合同展示の部屋の枠は、その部屋自身の work_cap
-- （15、`addExpoRoom`/`switch_room_expo`が固定で入れる）だけで完結させ、口座の
-- 共有プール（`work_slot_pool`）へは足さない・引かない。
--
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。0044〜0059 を先に適用しておくこと。

/* ================= 1. 作品に部屋を紐付ける列 ================= */
-- NULL = 通常展示の共有プール（従来どおり・既存の全行はNULLのまま）。値あり = その
-- 合同展示の部屋専用の作品。owner_id が一致する行にしか意味を持たせない設計なので、
-- 追加のRLSは要らない（既存の artworks 所有者ポリシーが owner_id で閉じている）。
-- 「どのgallery_idを名乗れるか」は下の 3. のトリガが検査する。
alter table public.artworks
  add column if not exists gallery_id uuid references public.galleries (id) on delete cascade;

create index if not exists artworks_gallery_idx on public.artworks (gallery_id) where gallery_id is not null;

/* ================= 2. 1展示1部屋 ================= */

-- ①新規の部屋（`addExpoRoom`のINSERT経路）。既存の関数をそのまま使い、末尾に
-- 「その展示に既に部屋がないか」を足す。INSERT では new.id はまだ表に無いので、
-- `id <> new.id` は「他の行だけを見る」＝そのまま「既にあるか」の判定になる。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_purchased int;
  v_expo_owner uuid;
begin
  if new.expo_id is not null then
    select owner_id into v_expo_owner from public.expos where id = new.expo_id;
    if v_expo_owner is distinct from new.owner_id then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.galleries where expo_id = new.expo_id and id <> new.id
    ) then
      raise exception 'this exhibition already has a room' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = new.owner_id
     and expo_id is null;

  select count(*) into v_purchased
    from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    if v_paid >= v_purchased then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_purchased
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
  else
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ②既存の部屋を合同展示へ切り替える経路（`switch_room_expo`、0050）。この関数は
-- `security definer` で `galleries_enforce_allowance`（before **insert** だけ）を
-- 経由しないUPDATEを自分の内側で完結させているので、①のトリガを直しただけでは
-- ここを通らない。同じ「既に部屋があるか」の検査をここにも足す。
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

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    -- 1展示1部屋（ユーザー決定 2026-08-13）。
    if exists (
      select 1 from public.galleries where expo_id = p_expo and id <> p_gallery
    ) then
      raise exception 'this exhibition already has a room' using errcode = 'check_violation';
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

  -- この部屋はもう合同展示の部屋ではないので、専用プールに積んであった作品
  -- （`gallery_id = p_gallery`）は行き場を失う。空にする条件は「placementsが0件」
  -- だけ（上のチェック）で、**アップロード済みだが未配置の作品**は残っている
  -- ── そのまま `gallery_id` を残すとダッシュボードのどこからも見えなくなる
  -- （通常展示の共有プールは `gallery_id is null` だけを見るため）。共有プールへ
  -- 解放する（ユーザー決定 2026-08-13の専用プール化に伴う後始末）。
  update public.artworks set gallery_id = null where gallery_id = p_gallery;
end;
$$;

/* ================= 3. 作品プールを分離する ================= */

-- 通常展示の共有プールから合同展示の部屋を除く（2026-08-12の決定の一部撤回）。
-- **下限5を保つ**理由は0059のコメントのまま（部屋を1つも作っていない口座を締め出さない）。
create or replace function public.work_slot_pool(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(g.work_cap), 0), 5)::int
    from public.galleries g
   where g.owner_id = p_owner
     and g.expo_id is null;
$$;

-- 使用点数も同じ理由で合同展示の部屋を除く。除かないと、work_slot_pool が
-- 縮んだ（合同展示ぶんを引いた）のに使用点数はまだ合同展示の分を含んだままになり、
-- 通常展示側だけの操作が「口座全体が超過している」と誤って拒否される。
create or replace function public.placement_pool_used(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
   where g.owner_id = p_owner
     and g.expo_id is null;
$$;

-- 作品の点数。①通常展示の共有プール（gallery_id が null の行だけを数える）と、
-- ②合同展示の部屋専用プール（gallery_id ごとに、その部屋自身の work_cap で独立に見る）
-- の2本立てにする。**gallery_id を名乗れる部屋も検査する** — 検査が無いと、
-- 通常展示の部屋のidを付けるだけで「その部屋専用プール」を新しく作れてしまい
-- （物理15枠までは共有プールの上限を無視して積める）、抜け穴になる。
create or replace function public.enforce_artwork_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_used int;
  v_pool int;
  g record;
  v_room_used int;
  v_room_cap int;
begin
  -- gallery_id を名乗った行は、その部屋が①呼び手自身の部屋で ②合同展示の部屋
  -- （expo_id が not null）であることを確認する。通常展示の部屋のidを付けて
  -- 共有プールの上限を回避する経路を防ぐ。
  for g in select distinct n.gallery_id, n.owner_id from new_rows n where n.gallery_id is not null loop
    if not exists (
      select 1 from public.galleries x
       where x.id = g.gallery_id and x.owner_id = g.owner_id and x.expo_id is not null
    ) then
      raise exception 'artworks.gallery_id must be one of your own joint-exhibition rooms';
    end if;
  end loop;

  -- ①通常展示の共有プール。
  for r in select distinct n.owner_id from new_rows n where n.gallery_id is null loop
    select count(*)::int into v_used
      from public.artworks a where a.owner_id = r.owner_id and a.gallery_id is null;
    v_pool := public.work_slot_pool(r.owner_id);
    if v_used > v_pool then
      raise exception 'work slot pool exceeded: % works for a pool of %', v_used, v_pool;
    end if;
  end loop;

  -- ②合同展示の部屋専用プール。口座の共有プールへは足さない・引かない ── その部屋
  -- 自身の work_cap（15）だけで完結させる。
  for g in select distinct n.gallery_id from new_rows n where n.gallery_id is not null loop
    select count(*)::int into v_room_used from public.artworks a where a.gallery_id = g.gallery_id;
    select work_cap into v_room_cap from public.galleries where id = g.gallery_id;
    if v_room_used > coalesce(v_room_cap, 0) then
      raise exception 'room work slot pool exceeded: % works for a room pool of %', v_room_used, v_room_cap;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_artwork_pool() from public, anon, authenticated, service_role;
