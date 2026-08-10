-- 合同展示を「会期のあいだだけ、専用URLでだけ」見せる（ユーザー決定 2026-08-09 の続き）
--
-- 0044 で `expos` と `galleries.expo_id` を作ったが、**公開の読み経路が足りていなかった**。
-- 合同展示の部屋は主催者が所有する `galleries` の行なので、既存のポリシー
-- （`galleries_select_public` = `using (is_public)`）のままだと2つ問題が起きる:
--
--   ①**会期の外・支払い前でも見えてしまう。** 主催者が部屋の公開スイッチを入れれば、
--     場所代を払う前から誰でも読める（そして `/@ハンドル/{slug}` と `/explore` にも出る）。
--     ＝「会期のあいだだけ公開」という約束が守られない。
--   ②**合同展示が主催者の個人展示に混ざる。** 「通常の展示とは完全に別」という要件に反する。
--
-- 直し方:
--   ・`galleries_select_public` を `is_public and expo_id is null` に締める
--     （＝**合同展示の部屋は通常の公開経路から出さない**）
--   ・合同展示の部屋は「その展示の会期が生きているか」だけで決める新しいポリシーで開ける
--   ・作品と配置も同じ条件で開ける（既存のポリシーは `is_public` しか見ていない）
--
-- **`anon` に execute を渡すのを忘れないこと。** ポリシーの中で呼ぶ関数の実行権限を
-- `authenticated` だけにすると、未ログインの来場者が読むだけで
-- `permission denied for function` になり**公開サイトが全滅する**（0041 で実際にやった。
-- LESSONS 2026-08-09）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. ポリシーで使う述語の実行権限 ================= */
-- 0044 で作った関数。**ポリシーから呼ぶので anon にも渡す**（渡しても漏れない:
-- 引数の日付だけで決まり、行は読まない）。
grant execute on function public.expo_is_live(timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.expo_has_ended(timestamptz) to anon, authenticated, service_role;
grant execute on function public.expo_grace_days() to anon, authenticated, service_role;

/**
 * その部屋が「会期の生きている合同展示の部屋」か。
 *
 * `security definer` にしてあるのは、来場者が `expos` を直接読めなくても判定できるように
 * するため（`expos` の RLS は「見えている展示だけ」なので今回は等価だが、あとで
 * `expos` 側を締めてもこの判定は壊れない）。**読むのは会期の日付だけ**で、行の中身は返さない。
 */
create or replace function public.gallery_in_live_expo(p_gallery uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.galleries g
      join public.expos x on x.id = g.expo_id
     where g.id = p_gallery
       and public.expo_is_live(x.starts_at, x.ends_at)
  )
$$;

revoke all on function public.gallery_in_live_expo(uuid) from public;
grant execute on function public.gallery_in_live_expo(uuid) to anon, authenticated, service_role;

/* ================= 1. 部屋 ================= */
-- **合同展示の部屋は `is_public` を持てない。** 見え方を決めるのは会期だけ。
--
-- なぜポリシーだけでは足りないか: RLS のポリシーは OR で足されるので、会期中は
-- `galleries_select_expo_live` が読ませる。そのうえで**アプリ側が `.eq('is_public', true)`
-- で絞る問い合わせ**（`/explore` の一覧、作家プロフィール、sitemap）は、`is_public` が
-- true のままの合同展示の部屋を**拾ってしまう** ── ポリシーを締めても、絞り込みの
-- 条件に合致すれば出てくる（実測 2026-08-09。テストが検出した）。
--
-- 全クエリを監査して `expo_id is null` を足すより、**値そのものを持たせない**方が確実。
-- `expos_set_ends` と同じ作法で、insert/update のたびに無条件で false にする。
create or replace function public.galleries_expo_never_public()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expo_id is not null then
    new.is_public := false;
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_expo_never_public on public.galleries;
create trigger galleries_expo_never_public
  before insert or update on public.galleries
  for each row execute function public.galleries_expo_never_public();

-- 既にある行を直す（0045 より前に作られた合同展示の部屋）。
update public.galleries set is_public = false where expo_id is not null and is_public;

-- **合同展示の部屋を通常の公開経路から外す。** これが無いと、主催者が部屋の公開スイッチを
-- 入れただけで（＝場所代を払う前に）`/@ハンドル/{slug}` と `/explore` に出てしまう。
drop policy if exists "galleries_select_public" on public.galleries;
create policy "galleries_select_public"
  on public.galleries for select using (is_public and expo_id is null);

-- 合同展示の部屋は**会期だけで**開く（`is_public` は見ない）。主催者が押すスイッチではなく、
-- 支払いで始まった会期が見せ方を決める。
drop policy if exists "galleries_select_expo_live" on public.galleries;
create policy "galleries_select_expo_live"
  on public.galleries for select
  using (expo_id is not null and public.gallery_in_live_expo(id));

/* ================= 2. 配置 ================= */
drop policy if exists "placements_select_expo_live" on public.placements;
create policy "placements_select_expo_live"
  on public.placements for select
  using (public.gallery_in_live_expo(gallery_id));

/* ================= 3. 作品 ================= */
-- 会期中の合同展示に掛かっている作品は、**誰の作品でも**来場者に見える（それが展示だから）。
-- 会期が終わって猶予も切れれば、この経路は閉じる（展示の行が消えるので `gallery_in_live_expo`
-- が false になる）。作品そのものは各作家のライブラリに残る。
drop policy if exists "artworks_select_in_live_expo" on public.artworks;
create policy "artworks_select_in_live_expo"
  on public.artworks for select
  using (
    exists (
      select 1
        from public.placements p
       where p.artwork_id = artworks.id
         and public.gallery_in_live_expo(p.gallery_id)
    )
  );

/* ================= 4. 名前の取り合いを塞ぐ ================= */
-- `/expo/{name}` には**2つの住人**が居る:
--   ・`profiles.expo_slug`（0040。管理者が付けるアカウントの別名）
--   ・`expos.slug`（0044。合同展示）
-- 一意制約は別々なので、**同じ名前が両方に存在できてしまい**、どちらを開くかは
-- 解決の順番次第になる（＝先に登録した人の展示が、あとから同名を取った人に隠される）。
-- 新しく取る側を互いに弾いて、これから増えないようにする。既存の重複は下の NOTICE で知らせる。
create or replace function public.guard_expo_slug_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is null then return new; end if;
  if exists (select 1 from public.profiles p where lower(p.expo_slug) = lower(new.slug)) then
    raise exception 'that URL name is already used by an exhibition alias'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists expos_guard_slug_unique on public.expos;
create trigger expos_guard_slug_unique
  before insert or update of slug on public.expos
  for each row execute function public.guard_expo_slug_unique();

-- 逆向き: アカウントの別名を付けるときに、合同展示の名前とぶつからないようにする。
-- 0040 の `set_expo_slug` に一行足した全文（`create or replace` なので置き換わる）。
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
    raise exception 'invalid slug: %', p_slug;
  end if;

  -- **合同展示の名前とぶつけない**（`/expo/{name}` を取り合うので、先に居る方を守る）。
  if v_clean is not null and exists (select 1 from public.expos x where lower(x.slug) = v_clean) then
    raise exception 'that URL name is already used by a joint exhibition'
      using errcode = 'unique_violation';
  end if;

  update public.profiles set expo_slug = v_clean where id = p_user;
  if not found then
    raise exception 'no such profile';
  end if;
end;
$$;

revoke all on function public.set_expo_slug(uuid, text) from public, anon;
grant execute on function public.set_expo_slug(uuid, text) to authenticated;

-- 既にぶつかっているものがあれば知らせる（勝手に直さない — どちらを残すかは人が決める）。
do $$
declare
  v_dupes text;
begin
  select string_agg(x.slug, ', ') into v_dupes
    from public.expos x
   where exists (select 1 from public.profiles p where lower(p.expo_slug) = lower(x.slug));
  if v_dupes is not null then
    raise notice '同じ URL 名が合同展示とアカウント別名の両方にあります: %。/expo/ はどちらか一方しか開けないので、どちらを残すか決めてください。', v_dupes;
  end if;
end $$;
