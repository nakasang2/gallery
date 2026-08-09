-- 展示のURLをサブドメインからパスへ（ユーザー決定 2026-08-09）— `/expo/{slug}`
--
-- 0039 はサブドメイン（`tokyo-expo.xibit360.art`）を入れたが、**展示ごとに Vercel の
-- ドメイン追加と Cloudflare の CNAME を毎回手で足す**必要があり、Hobby の
-- 1プロジェクト50ドメインという上限もある。運用の手間が展示数に比例して増えるので、
-- 公開URLは `xibit360.art/expo/{slug}` に切り替える（追加作業ゼロ・上限なし）。
--
-- ルート直下（`xibit360.art/{slug}`）にしなかった理由: ルートには既にアプリのルート
-- 14個と言語コード11個が居て、将来のルートとも衝突する。得るのは1階層ぶんの短さだけ。
--
-- 列は**そのまま使える**（必要なのは「展示ごとにユニークな名前」で、まさにそれ）。
-- 名前だけ実態に合わせて変える — パスを駆動するものが `subdomain` という名前のままだと
-- 後で読む人が必ず誤解する。ホスト解析のコードは `NEXT_PUBLIC_EXPO_DOMAIN` 未設定で
-- 切れる形で残してあるので、将来サブドメインをやるなら環境変数とDNSだけで戻せる。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
-- ※ 0039 を適用済みでも未適用でも、番号順に流せば同じ結果になる。

/* ================= 1. 列・制約・索引の改名 ================= */
do $$
begin
  -- 0039 を適用済み: 改名する
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'subdomain')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'expo_slug')
  then
    alter table public.profiles rename column subdomain to expo_slug;
  end if;
end $$;

-- 0039 を飛ばした環境のために、無ければ作る（改名済みならこれは空振り）
alter table public.profiles add column if not exists expo_slug text;

alter table public.profiles drop constraint if exists profiles_subdomain_format;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_expo_slug_format') then
    alter table public.profiles add constraint profiles_expo_slug_format
      check (expo_slug is null or expo_slug ~ '^[a-z0-9-]{3,40}$');
  end if;
end $$;

-- 大文字小文字を区別せずユニーク。URLのパスは区別しうるが、**区別する運用にすると
-- `Expo` と `expo` が別の展示になり、どちらが正なのか誰にも分からなくなる**ので、
-- サブドメインのときと同じく1つに畳む。
drop index if exists public.profiles_subdomain_key;
create unique index if not exists profiles_expo_slug_key
  on public.profiles (lower(expo_slug)) where expo_slug is not null;

/* ================= 2. 本人は書き換えられない（0039 と同じ理由） ================= */
-- 行だけ先に入ると canonical が実在しないURLを指す。付与も剥奪も管理者経由に限る。
-- `security invoker` でなければ意味が無い（definer だと current_user が常に所有者に
-- なって素通りする — 0036 で実際にやった。LESSONS 2026-08-09）。
create or replace function public.guard_expo_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expo_slug is distinct from old.expo_slug
     and current_user in ('authenticated', 'anon') then
    raise exception 'expo_slug is assigned by an administrator'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_subdomain on public.profiles;
drop function if exists public.guard_subdomain();
drop trigger if exists profiles_guard_expo_slug on public.profiles;
create trigger profiles_guard_expo_slug
  before update of expo_slug on public.profiles
  for each row execute function public.guard_expo_slug();

/* ================= 3. 管理者による付与・剥奪 ================= */
create or replace function public.set_expo_slug(p_user uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  v_clean := nullif(lower(trim(coalesce(p_slug, ''))), '');
  if v_clean is not null and v_clean !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'invalid expo slug: %', p_slug;
  end if;

  update public.profiles set expo_slug = v_clean where id = p_user;
  if not found then
    raise exception 'no such profile';
  end if;
end;
$$;

revoke all on function public.set_expo_slug(uuid, text) from public;
revoke all on function public.set_expo_slug(uuid, text) from anon;
grant execute on function public.set_expo_slug(uuid, text) to authenticated;

-- 0039 の版は名前ごと退場（引数の型が同じなので置き換えではなく削除が必要）
drop function if exists public.set_expo_subdomain(uuid, text);
