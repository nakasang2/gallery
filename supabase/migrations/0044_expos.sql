-- 合同展示（Expo）の土台（ユーザー決定 2026-08-09。DECISIONS 2026-08-09 に全文）
--
-- 形: **通常展示と完全に別の実体**。`xibit360.art/expo/{name}` で開き、**会期**があり、
-- **主催者が公開時に場所代を払う**（7日 $15 / 14日 $25 / 30日 $40）。参加作家は無料。
--
-- 部屋（`galleries`）とは別の表にしたのは、会期・支払い・参加者が「展示全体」の属性で
-- 1つの部屋の属性ではないから。合同展示は部屋を1つ以上ぶら下げる。
--
-- 設計の要点（どれも過去に踏んだ失敗から来ている）:
--   ①**見える/見えないは日付から導出する。** 旗を別に持つと、削除ジョブが止まったときに
--     会期切れが公開され続ける。`is_public` のような自由な旗を置かない。
--   ②**公開と支払いは同じ1つの操作**（`record_expo_purchase`）。分けると「払ったのに
--     公開されていない」「公開されたのに払っていない」の窓ができる。クライアントから
--     公開できる経路は作らない ── 0036 で「上限の材料をクライアントが渡していた」のと
--     同じ失敗を繰り返さない。
--   ③**合同展示の部屋は主催者の部屋枠（$25）を消費しない。** 場所代で払っているので
--     二重取りになる。0038 の番人を「合同展示の部屋は数えない」に差し替える。
--   ④**猶予が過ぎたら行ごと消す**（ユーザー判断）。消えれば名前も空くので、同じURLで
--     次の会期を立てられる。消えるのは展示・部屋・配置だけで、**参加作家の作品は
--     各自のライブラリに残る**（`placements` は作品を参照するだけ）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 会期の長さ（値はここが正） ================= */
-- lib/pricing の PRICE_USD_CENTS.expo* と対で保つ。DBを正にしているのは、
-- **価格と会期をクライアントに決めさせない**ため（②の理由）。
create or replace function public.expo_days_allowed(p_days int)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_days in (7, 14, 30) $$;

/* ================= 2. 表 ================= */
create table if not exists public.expos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  /** URL の名前。`/expo/{slug}` で開く。部屋の slug と同じ文字種。 */
  slug text not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  title text not null default '',
  statement text not null default '',
  /** 会期の長さ。支払い時に確定する（それまでは主催者が選び直せる）。 */
  duration_days int not null default 14 check (public.expo_days_allowed(duration_days)),
  /**
   * 会期の開始。**支払いが通った瞬間に入る**（`record_expo_purchase`）。
   * null = まだ公開していない下書き。
   */
  starts_at timestamptz,
  /**
   * 会期の終わり。**開始と長さから導出**され、手で動かせない（下の
   * `expos_set_ends` トリガが insert/update のたびに無条件で上書きする）。
   *
   * 生成列（`generated always as`）にしたかったが、`timestamptz + interval` は
   * immutable ではない（タイムゾーン設定に依る）ので Postgres が拒否する。
   * トリガで**必ず上書きする**なら、誰がどんな値を入れても残らないので同じ性質になる。
   */
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- 名前は**生きている展示のあいだだけ**一意。猶予後に行を消すと自動で空くので、
-- 同じ名前で次の会期を立てられる（ユーザー要望）。大文字小文字は区別しない。
create unique index if not exists expos_slug_key on public.expos (lower(slug));
create index if not exists expos_owner_idx on public.expos (owner_id, created_at desc);
-- 掃除ジョブが引く向き（終わった会期を古い順に）。
create index if not exists expos_ends_idx on public.expos (ends_at) where starts_at is not null;

/* ================= 3. 部屋を紐づける ================= */
alter table public.galleries add column if not exists expo_id uuid
  references public.expos (id) on delete cascade;
create index if not exists galleries_expo_idx on public.galleries (expo_id) where expo_id is not null;

-- 会期の終わりを常に導出する。**無条件に上書き**するので、クライアントが値を入れても
-- 主催者が update しても残らない（生成列の代わり）。
create or replace function public.expos_set_ends()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.ends_at := new.starts_at + make_interval(days => new.duration_days);
  return new;
end;
$$;

drop trigger if exists expos_set_ends on public.expos;
create trigger expos_set_ends
  before insert or update on public.expos
  for each row execute function public.expos_set_ends();

/* ================= 4. 猶予（会期後もURLが生きている日数） ================= */
create or replace function public.expo_grace_days()
returns int
language sql
immutable
set search_path = ''
as $$ select 7 $$;

/**
 * その展示が**いま来場者に見えるか**。日付だけから決まる（旗を見ない）。
 * 会期中は本編、会期後の猶予中も true（表示側が「終了しました」と出す）。
 */
create or replace function public.expo_is_live(p_starts timestamptz, p_ends timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_starts is not null
     and now() >= p_starts
     and now() < p_ends + make_interval(days => public.expo_grace_days())
$$;

/** 会期が終わっているか（猶予中はこれが true で、まだ見える）。 */
create or replace function public.expo_has_ended(p_ends timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$ select p_ends is not null and now() >= p_ends $$;

/* ================= 5. RLS ================= */
alter table public.expos enable row level security;

-- 主催者は自分の展示を全部触れる（題名・名前・会期の選び直しなど）。
drop policy if exists "expos_owner_all" on public.expos;
create policy "expos_owner_all"
  on public.expos for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 来場者は**見えている展示だけ**読める。未公開の下書きは他人から見えない。
drop policy if exists "expos_select_live" on public.expos;
create policy "expos_select_live"
  on public.expos for select
  using (public.expo_is_live(starts_at, ends_at));

drop policy if exists "expos_select_admin" on public.expos;
create policy "expos_select_admin"
  on public.expos for select using (public.is_admin());

/* ================= 6. お金と日付は本人にも書かせない ================= */
-- `expos_owner_all` は列を絞れないので、**追加のトリガで金額に関わる列を守る**
-- （work_cap / slots_included と同じ作法）。`security invoker` にして呼び手のロールを
-- 見る ── definer にすると current_user が常に所有者になり素通りする（0036 で実際に
-- やってしまった。LESSONS 2026-08-09）。
create or replace function public.guard_expo_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- 開始日は支払いが決める。ここを書けると**無料で公開できる**。
    if new.starts_at is distinct from old.starts_at then
      raise exception 'starts_at is set by the payment' using errcode = 'check_violation';
    end if;
    -- 会期の長さは**公開後は動かせない**（払った長さと違う会期になる）。公開前は自由。
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
  before update on public.expos
  for each row execute function public.guard_expo_run();

/* ================= 7. 部屋枠を消費しない ================= */
-- 0038 の `enforce_room_allowance` を差し替える。差分は**合同展示の部屋を数えない**
-- 1点だけ（`where expo_id is null` と、insert が expo の部屋なら素通り）。
-- 場所代を払っているのに $25 の枠まで減るのは二重取り。
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
begin
  -- **合同展示の部屋は勘定の外**。会期の場所代で払っている。
  if new.expo_id is not null then
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

/* ================= 8. 台帳が 'expo' を受ける ================= */
-- 0034 の版に 'expo' を足した全文（`check` は差分更新できないので毎回書き直す）。
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check
  check (kind in ('theme', 'layout', 'frame', 'theme_collection', 'design_tools', 'video_pass', 'capacity', 'room', 'expo'));

/* ================= 9. 支払い＝公開（service role だけ） ================= */
/**
 * 場所代の記録と公開を**1つの操作**で行う。Stripe webhook からだけ呼ぶ。
 *
 * 分けない理由: 「払ったのに公開されていない」「公開されたのに払っていない」の窓を
 * 作らないため。**クライアントから公開できる経路は存在しない**（`guard_expo_run` が
 * `starts_at` を守り、この関数は service role にしか渡していない）。
 *
 * 会期の長さは**引数で受けて上書きする** — 決済セッションを作った時点の長さが正で、
 * その間に主催者が選び直していても、払った長さで会期を切る。
 *
 * 同じセッションidで2回来ても1回しか効かない（webhook の再送はふつうに起きる）。
 */
create or replace function public.record_expo_purchase(
  p_session text,
  p_user uuid,
  p_expo uuid,
  p_days int,
  p_amount int,
  p_currency text
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

  -- 再送で2回入らないように、セッションidを鍵にする（0019/0031 と同じ作法）。
  if exists (select 1 from public.purchases where kind = 'expo' and sku = p_session) then
    return;
  end if;

  insert into public.purchases (user_id, kind, item_key, sku, amount_jpy, currency)
  values (p_user, 'expo', p_expo::text, p_session, p_amount, p_currency);

  -- **ここで初めて公開される。** すでに会期が始まっていれば触らない（延長は別の話）。
  update public.expos
     set duration_days = p_days,
         starts_at = now()
   where id = p_expo and starts_at is null;
end;
$$;

revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text) from public;
revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text) from anon;
revoke all on function public.record_expo_purchase(text, uuid, uuid, int, int, text) from authenticated;
grant execute on function public.record_expo_purchase(text, uuid, uuid, int, int, text) to service_role;

/* ================= 10. 猶予後の掃除 ================= */
/**
 * 会期＋猶予を過ぎた展示を消す。**部屋と配置は cascade で一緒に消え、作品は残る**
 * （`placements` は作品を参照するだけなので、参加作家のライブラリは無傷）。
 *
 * 下書き（`starts_at is null`）は消さない。主催者のものだし、公開していないので
 * 誰にも見えていない。
 *
 * 戻り値は消した件数。
 */
create or replace function public.purge_expired_expos()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.expos
   where starts_at is not null
     and now() >= ends_at + make_interval(days => public.expo_grace_days());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_expired_expos() from public, anon, authenticated;
grant execute on function public.purge_expired_expos() to service_role;

-- 毎日1回。**pg_cron が有効でなければ何もしない**（migration を失敗させない）。
-- 有効化は Supabase の Dashboard → Database → Extensions で `pg_cron` を on にする
-- 1回だけの作業。まだなら下の NOTICE が出るので、有効にしてからこの本を流し直す。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-expos')
      where exists (select 1 from cron.job where jobname = 'purge-expired-expos');
    perform cron.schedule('purge-expired-expos', '17 3 * * *', 'select public.purge_expired_expos()');
  else
    raise notice 'pg_cron が無効なので掃除ジョブを登録していません。Dashboard → Database → Extensions で有効にしてから、この migration を流し直してください（それまで期限切れの展示は日付で非表示になるだけで、行は残ります）。';
  end if;
end $$;
