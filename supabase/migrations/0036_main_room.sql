-- 複数展示室（ユーザー決定 2026-08-09）— どの部屋が `/@username` の玄関かを持たせる。
--
-- 追加料金($25・15枠込み)で部屋を増やせるようにしたので、1人が複数の galleries 行を
-- 持つようになる。`/@username` は「メイン部屋」を描き、サブ部屋は `/@username/[slug]`。
-- どれがメインかを DB に持たないと、部屋を増やした瞬間に玄関がどの部屋か決まらない。
--
-- 後方互換: 既存行は is_main=false で入るので、下のバックフィルで**所有者ごとに最古の
-- 1室**を玄関にする。アプリ側の `mainRoomOf()` も「フラグが無ければ最古」にフォール
-- バックするため、0036 未適用のDBでも今までと同じ部屋が `/@username` に出る。
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. galleries.is_main ================= */
alter table public.galleries add column if not exists is_main boolean not null default false;

-- 1人につき玄関は1つだけ。部分ユニークなので false は何行あってもよい。
create unique index if not exists galleries_one_main_per_owner
  on public.galleries (owner_id) where is_main;

-- バックフィル: まだ誰も玄関を持っていない所有者について、最古の1室を玄関にする。
-- 再実行安全(既に玄関がある所有者は not exists で除外される)。
update public.galleries g
   set is_main = true
 where not g.is_main
   and not exists (
     select 1 from public.galleries o where o.owner_id = g.owner_id and o.is_main
   )
   and g.id = (
     select g2.id
       from public.galleries g2
      where g2.owner_id = g.owner_id
      order by g2.created_at asc, g2.id asc
      limit 1
   );

/* ================= 2. 玄関の切り替え ================= */
-- 部分ユニーク索引があるので「古い玄関を消す」と「新しい玄関を立てる」は同一
-- トランザクションでなければならない。クライアントの2回 update では、間に落ちると
-- 玄関ゼロになるか、順序次第で索引違反で弾かれる。
create or replace function public.set_main_room(p_gallery uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  -- security invoker なので RLS がそのまま効く = 自分の部屋しか見えない。
  select owner_id into v_owner from public.galleries where id = p_gallery;
  if v_owner is null then
    raise exception 'set_main_room: no such room';
  end if;

  update public.galleries set is_main = false
   where owner_id = v_owner and is_main and id <> p_gallery;
  update public.galleries set is_main = true
   where id = p_gallery;
end;
$$;

revoke all on function public.set_main_room(uuid) from public;
grant execute on function public.set_main_room(uuid) to authenticated;

/* ================= 3. 部屋数と初期キャパをDBで強制する ================= */
-- ここが無いと課金が守られない。`galleries` の insert は RLS 経由でブラウザから
-- 直接行われ、`createGallery` の枚数チェックはクライアントが渡した購入数を信じる
-- だけなので、**細工したクライアントは購入ゼロで部屋を無限に作れる**（しかも
-- 2室目以降は work_cap=15 で作られるので $3×10 のスロットまで一緒に付いてくる）。
-- 数えるのは購入台帳（kind='room' の行数）で、これは webhook しか書けない。
--
-- 初期キャパも同じ理由で縛る: 無料の1室目に work_cap=15 を入れた insert を送れば
-- 10枠を無料で得られる。1室目は PLAN.worksPerGallery(5)、それ以降は
-- MAX_WORKS_PER_ROOM(15) まで。※ここは**INSERT時の初期値**の話で、あとから
-- スロットを買って上げるのは record_capacity_purchase（15でクランプ済み）の仕事。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rooms int;
  v_bought int;
begin
  select count(*) into v_rooms from public.galleries where owner_id = new.owner_id;
  select count(*) into v_bought from public.purchases
   where user_id = new.owner_id and kind = 'room';

  -- 無料1室 + 購入ぶん。lib/limits.roomAllowance() と同じ式。
  if v_rooms >= 1 + v_bought then
    raise exception 'room allowance exceeded: % rooms, % purchased', v_rooms, v_bought
      using errcode = 'check_violation';
  end if;

  -- 1室目(=まだ部屋が無い)は5枠、それ以降は15枠まで。
  if new.work_cap is not null and new.work_cap > (case when v_rooms = 0 then 5 else 15 end) then
    raise exception 'work_cap % not allowed for a new room', new.work_cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists galleries_enforce_allowance on public.galleries;
create trigger galleries_enforce_allowance
  before insert on public.galleries
  for each row execute function public.enforce_room_allowance();

-- work_cap の引き上げは購入経路(record_capacity_purchase / admin付与)だけに許す。
-- あの関数は security definer なので**その内側では current_user が所有者ロール**に
-- なり、PostgREST 経由の直接 update だけが 'authenticated' / 'anon' で入ってくる。
--
-- ※ この関数は **security invoker でなければ意味が無い**。definer にすると
-- current_user が常に自分の所有者になるので `in ('authenticated','anon')` が
-- 永久に偽＝番人が素通りする（実際に definer で書いてしまい、ローカルの
-- Postgres 16 で「authenticated が work_cap を 3→15 に上げられる」ことを実測して
-- 気づいた。LESSONS 2026-08-09）。
create or replace function public.guard_work_cap_raise()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.work_cap > old.work_cap and current_user in ('authenticated', 'anon') then
    raise exception 'work_cap is raised by purchase only'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_guard_work_cap on public.galleries;
create trigger galleries_guard_work_cap
  before update of work_cap on public.galleries
  for each row execute function public.guard_work_cap_raise();
