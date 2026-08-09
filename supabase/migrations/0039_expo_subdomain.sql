-- 展示ごとのサブドメイン（ユーザー決定 2026-08-09）— `tokyo-expo.xibit360.art`
--
-- ワイルドカードは使えない。Vercel は `*.domain` の証明書を「ネームサーバーを Vercel に
-- 完全移管した場合のみ」発行し、`_acme-challenge` だけを NS 委任する回避策は公式に
-- 非推奨（自動更新が保証されない）。このゾーンは `cdn.xibit360.art` が R2 のカスタム
-- ドメイン（＝ゾーンが Cloudflare にあることが必須）で、CORS を直す Transform Rule も
-- 載っているので移管はできない。よって**サブドメインは1件ずつ実在のホストとして登録**し、
-- 通常の HTTP-01 証明書を貰う（`www` と同じ更新経路）。
--
-- 設計上の要点: **サブドメインは任意の別名**。展示は常に `/@ハンドル` で公開され、
-- サブドメインは canonical と配る先だけを変える。Vercel の1プロジェクト50ドメインという
-- 上限は「別名の数」の天井であって展示数の天井ではない ── 尽きても新しい展示は
-- `/@ハンドル` で普通に公開できる。
--
-- **この本は 0040 に置き換えられている**（パス方式に切り替えたので `subdomain` →
-- `expo_slug` に改名された）。履歴として残しつつ、**0040 を適用済みの環境では丸ごと
-- 何もしない**ようにしてある。素の DDL を並べていた版は、貼り直すと 0040 が改名した
-- `subdomain` を作り直し、0040 の改名条件（`expo_slug` が無いこと）を偽にして改名を
-- 空振りさせ、**空の `subdomain` が残った**（schema.sql を2回流すだけで再現。実測
-- 2026-08-09）。**後の番号が消したものを、前の番号が復活させてはいけない。**
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 本人は書き換えられない ================= */
-- サブドメインは**DNSとVercelの登録が伴って初めて機能する**ので、行だけ先に書き換え
-- られると「DBには入っているが届かない別名」ができ、canonical がそこを指してしまう
-- （＝検索に載るURLが死ぬ）。付与も剥奪も管理者経由に限る。
--
-- 0001 の `profiles_update_own` は列を絞っていないため、これは**そのポリシーの穴を
-- 塞ぐ追加のトリガ**。work_cap / slots_included と同じ作法で、`security invoker` に
-- して呼び手のロールを見る（definer にすると current_user が常に所有者になり素通りする
-- ── 実際に 0036 でやってしまった。LESSONS 2026-08-09）。
--
-- 関数と RPC の本体は plpgsql なので、列が無くても作成時には検査されない（実行時に
-- 解決される）。だから下の DO ブロックの外に置いてよい ── 0040 がどちらも drop する。
create or replace function public.guard_subdomain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.subdomain is distinct from old.subdomain
     and current_user in ('authenticated', 'anon') then
    raise exception 'subdomain is assigned by an administrator'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

/* ================= 2. profiles.subdomain ================= */
-- 展示（＝アカウント）1つにつき1つ。部屋はこの下のパスなので、多室でも1つで足りる。
-- 形式は部屋のパス（SLUG_RE）と同じ文字種で、3文字以上。lib/expoHost の
-- EXPO_SUBDOMAIN_RE と対で保つこと。
--
-- 列に触る DDL は**まとめて1つの DO ブロックに入れ、動的SQLで撃つ**。`expo_slug` が
-- あれば（＝0040 済みなら）何もせず抜ける。素の DDL のままだと、制約・索引・トリガが
-- それぞれ「列が無い」で落ちる（列を作らないようにした結果、実際に落ちた）。
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'expo_slug') then
    -- 0040 で改名済み。この本の仕事は終わっている。
    return;
  end if;

  execute 'alter table public.profiles add column if not exists subdomain text';

  if not exists (select 1 from pg_constraint where conname = 'profiles_subdomain_format') then
    execute 'alter table public.profiles add constraint profiles_subdomain_format '
         || 'check (subdomain is null or subdomain ~ ''^[a-z0-9-]{3,40}$'')';
  end if;

  -- 大文字小文字を区別せずユニーク（DNS は区別しないので、`Expo` と `expo` を
  -- 別物として持てると片方が届かない別名になる）。null は何行あってもよい。
  execute 'create unique index if not exists profiles_subdomain_key '
       || 'on public.profiles (lower(subdomain)) where subdomain is not null';

  execute 'drop trigger if exists profiles_guard_subdomain on public.profiles';
  execute 'create trigger profiles_guard_subdomain '
       || 'before update of subdomain on public.profiles '
       || 'for each row execute function public.guard_subdomain()';
end $$;

/* ================= 3. 管理者による付与・剥奪 ================= */
-- 予約語はアプリ側（lib/expoHost の RESERVED）が持ち、ここは最低限の形式だけ見る。
-- 二重に持つと片方だけ更新されて食い違うので、**一覧の正はアプリ側**。
create or replace function public.set_expo_subdomain(p_user uuid, p_subdomain text)
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

  v_clean := nullif(lower(trim(coalesce(p_subdomain, ''))), '');
  if v_clean is not null and v_clean !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'invalid subdomain: %', p_subdomain;
  end if;

  update public.profiles set subdomain = v_clean where id = p_user;
  if not found then
    raise exception 'no such profile';
  end if;
end;
$$;

revoke all on function public.set_expo_subdomain(uuid, text) from public;
revoke all on function public.set_expo_subdomain(uuid, text) from anon;
grant execute on function public.set_expo_subdomain(uuid, text) to authenticated;
