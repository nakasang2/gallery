-- 「無料の1室を消して作り直すと5枠が15枠になる」ロンダリングを塞ぐ
-- （ユーザー指示 2026-08-09「ロンダリングは塞ぎたい」）。
--
-- 何が空いていたか: 0036 の番人は「部屋が1つも無ければ5枠、あれば15枠」という
-- **作成順の推定**でキャパを決めていた。行には「これが無料枠だった」という記録が無い。
-- なので 部屋を買う → 元の無料部屋を削除 → 作り直す と、作り直した部屋は
-- 「2室目以降」に見えて15枠で作られる。無料の5枠が15枠に化ける（$30相当・1回）。
--
-- 塞ぎ方: **等級を行に持つ**。`slots_included` = その部屋のキャパが部屋購入に
-- 含まれて来たか。これが無いと **「買った部屋」と「$3スロットで15枠まで育てた無料部屋」
-- を後から区別できない** — 既存行のキャパから推定する案が使えないのはそのため
-- （育てた無料部屋を「買った部屋」と誤認して、$25払った人に5枠の部屋を渡す事故になる）。
--
-- 数え方（lib/limits.gradeForNewRoom と同じ式）:
--   有料の部屋は「購入数 > 既存の有料部屋数」のあいだだけ作れる
--   無料の部屋は「まだ無料部屋を持っていない」ときだけ作れる
-- これで合計も自動的に 1 + 購入数 に収まるので、0036 の合計チェックは要らなくなる。
-- 購入した部屋を消しても購入は焼けない（有料の枠が空くだけ）。
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 等級の列 ================= */
alter table public.galleries add column if not exists slots_included boolean not null default false;

-- バックフィル: 所有者ごとに**最古の1室を無料枠**、それ以外を有料とする。0036〜0038 の
-- あいだに作られた部屋は「1室目=5枠 / 以降=15枠」で作られているので、作成順がその
-- ときの等級と一致する。既存の本番データは1人1室なので実質すべて無料枠になる。
update public.galleries g
   set slots_included = true
 where not g.slots_included
   and g.id <> (
     select g2.id from public.galleries g2
      where g2.owner_id = g.owner_id
      order by g2.created_at asc, g2.id asc
      limit 1
   );

/* ================= 2. 番人を等級ベースに差し替える ================= */
-- 0036 の enforce_room_allowance を置き換える（同名・同シグネチャなので、統合
-- ファイルでは 0036 の版がこれに置き換わり重複しない）。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_bought int;
begin
  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries where owner_id = new.owner_id;
  select count(*) into v_bought from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    -- 有料の部屋: 未使用の購入があるあいだだけ
    if v_paid >= v_bought then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_bought
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % exceeds the room maximum', new.work_cap
        using errcode = 'check_violation';
    end if;
  else
    -- 無料の部屋: 1人1つ
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    -- 無料枠は5枠から。ここを通せば「無料の1室目を15枠で insert する」で10枠が無料になる。
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- 0036 で作った before insert トリガをそのまま使う（関数の中身だけ差し替わる）。
drop trigger if exists galleries_enforce_allowance on public.galleries;
create trigger galleries_enforce_allowance
  before insert on public.galleries
  for each row execute function public.enforce_room_allowance();

/* ================= 3. 等級は後から書き換えられない ================= */
-- `slots_included` を false→true にできるなら、無料部屋を有料部屋に化かして
-- 購入枠を空け、もう1室作れてしまう。等級は作成時に決まったら固定。
-- work_cap と同じ作法で、購入経路（security definer）だけに許す。
create or replace function public.guard_room_grade()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slots_included is distinct from old.slots_included
     and current_user in ('authenticated', 'anon') then
    raise exception 'slots_included is fixed at creation'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_guard_grade on public.galleries;
create trigger galleries_guard_grade
  before update of slots_included on public.galleries
  for each row execute function public.guard_room_grade();
