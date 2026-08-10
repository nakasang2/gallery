-- 合同展示でも「来場・芳名帳・いいね」が動くようにする（0045 の続き。③公開ページの検証で発覚）
--
-- 0045 で合同展示の部屋は **`is_public` を持てない**ようにした（会期だけが見え方を決める）。
-- ところが来場者の関わり方を許すポリシーは**全部 `is_public` を見ている**:
--
--   ・`visits_insert_public`            — 来場の記録（3Dの人影＝過去の来場者）
--   ・`guestbook_insert_public` (0033)  — 芳名帳に書く
--   ・`guestbook_select_public_or_own`  — 芳名帳を読む
--   ・`likes_insert_public`             — いいね
--   ・`likes_select_public_or_own`      — いいねを読む
--   ・`public_visit_count()` (0024)     — 人影の数
--
-- つまり**会期中の合同展示では、芳名帳のフォームは出るのに書けず**（RLSが拒否＝来場者には
-- ただのエラー）、いいねも押せず、人影も出ない。**場所代を払った展示でだけ体験が欠けている**
-- という、いちばん出てはいけない形の欠落。
--
-- 直し方: ポリシーは **OR で足される**ので、既存のものは触らず「会期の生きている合同展示なら
-- 通す」ポリシーを並べて足す（`is_public` 側の意味を1文字も変えないので、通常展示への回帰が
-- 原理的に起きない）。関数だけは足せないので `public_visit_count` は全文を置き換える。
--
-- 述語は 0045 の `gallery_in_live_expo(uuid)` をそのまま使う（`security definer`・anon に
-- grant 済み・読むのは会期の日付だけ）。**猶予中（会期は終わったがURLは生きている）も
-- 通す**のは、そこがまだ本物のページだから ── 閉幕直後に届いた記帳を黙って捨てるより、
-- 受け取るほうがよい。消えるのは猶予明けに行ごと（`purge_expired_expos`）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. 前提（0045 未適用だと足せない） ================= */
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'gallery_in_live_expo'
  ) then
    raise exception '0045_expo_public_read.sql を先に適用してください（gallery_in_live_expo が無い）';
  end if;
end $$;

/* ================= 1. 来場の記録 ================= */
-- 3Dの人影（§11.19）の材料。読めるのは今までどおり部屋の持ち主だけ（`visits_select_own`）。
drop policy if exists "visits_insert_expo_live" on public.visits;
create policy "visits_insert_expo_live"
  on public.visits for insert
  with check (public.gallery_in_live_expo(gallery_id));

/* ================= 2. 芳名帳 ================= */
-- **`guestbook_enabled` は尊重する。** 合同展示の部屋もふつうの部屋なので、主催者が
-- 閉じていれば閉じたまま（0033 が守っているのと同じ約束）。
drop policy if exists "guestbook_insert_expo_live" on public.guestbook;
create policy "guestbook_insert_expo_live"
  on public.guestbook for insert
  with check (
    exists (
      select 1 from public.galleries g
       where g.id = gallery_id
         and g.guestbook_enabled
         and public.gallery_in_live_expo(g.id)
    )
  );

drop policy if exists "guestbook_select_expo_live" on public.guestbook;
create policy "guestbook_select_expo_live"
  on public.guestbook for select
  using (public.gallery_in_live_expo(gallery_id));

/* ================= 3. いいね ================= */
-- 通知の宛先は**作品の所有者**なので（0042 の `notify_like`）、合同展示で他人の壁に
-- 掛かっていても「あなたの作品がいいねされた」は作家本人に届く。ここは経路を開けるだけ。
drop policy if exists "likes_insert_expo_live" on public.likes;
create policy "likes_insert_expo_live"
  on public.likes for insert
  with check (public.gallery_in_live_expo(gallery_id));

drop policy if exists "likes_select_expo_live" on public.likes;
create policy "likes_select_expo_live"
  on public.likes for select
  using (public.gallery_in_live_expo(gallery_id));

/* ================= 4. 人影の数 ================= */
-- 0024 の全文に「会期の生きている合同展示なら数える」を足したもの（関数は OR で足せない
-- ので置き換える）。**返すのは合計だけ**で、行も時刻も返さないのは 0024 のまま。
create or replace function public.public_visit_count(p_gallery uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(count(*), 0)::int
  from public.visits v
  where v.gallery_id = p_gallery
    and (
      exists (select 1 from public.galleries g where g.id = p_gallery and g.is_public)
      or public.gallery_in_live_expo(p_gallery)
    );
$$;

revoke all on function public.public_visit_count(uuid) from public;
grant execute on function public.public_visit_count(uuid) to anon, authenticated, service_role;
