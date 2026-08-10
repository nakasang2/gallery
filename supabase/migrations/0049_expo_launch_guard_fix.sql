-- 合同展示の確定バグ2件を塞ぐ（別視点レビュー 2026-08-10、PR #8 マージ前に発見）
--
-- どちらも「クライアントから公開できる経路は存在しない」（0044 のコメント）という
-- 設計の前提が、実際には破れていた。素のPostgresで実際に再現して確認済み。
--
-- ================= バグ①: INSERTでは starts_at のガードが効いていなかった =================
-- 0044 の `guard_expo_run` は `before update on public.expos` にしか付けておらず、
-- INSERT には効かない。`expos_owner_all` は owner_id 一致しか見ないので、
-- authenticated が
--   insert into expos(owner_id, slug, title, duration_days, starts_at) values (self, ..., now())
-- を直接送ると、**決済を一度も通さずに即座に公開状態**（`expo_is_live` = true）になる。
-- 実際に検証DBで再現した（30日ぶん・$0）。
--
-- ================= バグ②: 合同展示の部屋が「誰の展示か」を確認していなかった =================
-- 0044 の `enforce_room_allowance` は `new.expo_id is not null` ならすぐ return し、
-- ①その expo_id が new.owner_id の展示かを確認しない ②work_cap の上限チェックも
-- 一切通さない（15枠上限のチェックはこの early return の後ろにしか書かれておらず、
-- 到達しない）。実際に検証DBで再現した — **他人の展示のIDを付けるだけで、
-- work_cap=999999 の部屋が無料で作れ、しかもその部屋は他人の展示に紐づいた**。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. INSERTでも starts_at を守る ================= */
create or replace function public.guard_expo_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- 作成時に starts_at を自分で入れられると、決済を一度も通さずに公開できる。
      if new.starts_at is not null then
        raise exception 'starts_at is set by the payment' using errcode = 'check_violation';
      end if;
      return new;
    end if;

    -- 開始日は支払いが決める。ここを書けると無料で公開できる。
    if new.starts_at is distinct from old.starts_at then
      raise exception 'starts_at is set by the payment' using errcode = 'check_violation';
    end if;
    -- 会期の長さは公開後は動かせない（払った長さと違う会期になる）。公開前は自由。
    if old.starts_at is not null and new.duration_days is distinct from old.duration_days then
      raise exception 'duration cannot change once the run has started' using errcode = 'check_violation';
    end if;
    -- 名前も公開後は動かせない（配ったURLが死ぬ）。
    if old.starts_at is not null and new.slug is distinct from old.slug then
      raise exception 'slug cannot change once the run has started' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expos_guard_run on public.expos;
create trigger expos_guard_run
  before insert or update on public.expos
  for each row execute function public.guard_expo_run();

/* ================= 2. 合同展示の部屋は「自分の展示か」を確認し、上限も見る ================= */
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
    -- **これが無いと、他人の展示のIDを付けるだけで無料・無制限の部屋が作れる**
    -- （実際に再現した）。owner_id は galleries_owner_all の with check で
    -- auth.uid() と一致済みなので、ここは「その展示が new.owner_id のものか」だけ見ればよい。
    select owner_id into v_expo_owner from public.expos where id = new.expo_id;
    if v_expo_owner is distinct from new.owner_id then
      raise exception 'expo does not belong to this user' using errcode = 'check_violation';
    end if;
    -- 場所代に部屋の上限チェックは含まれない。物理上限は有料部屋と同じ15枠まで
    -- （**early return の後ろにしか書いていなかったので、これまで一切効いていなかった**）。
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
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
