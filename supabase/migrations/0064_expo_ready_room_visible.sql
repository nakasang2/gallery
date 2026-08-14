-- 「準備できた」参加作家の部屋だけ、主催者に中身を見せる（ユーザー選択C 2026-08-14）
--
-- 背景（実測して分かったこと）: 0062 の `galleries_select_expo_owner` が主催者に開けたのは
-- **部屋の行だけ**で、作品（`artworks`）と配置（`placements`）は開けていなかった。その結果:
--   ・会期前  → 主催者は参加作家の部屋を開いても**空っぽの部屋**しか見えない
--   ・会期中  → 誰でも見える（0045 の公開経路）
-- つまり主催者は **中身を一度も見ないまま $15〜$40 の場所代を払って公開する**ことになり、
-- 判断の材料は参加作家の自己申告トグルだけだった。
--
-- 決定（ユーザー選択C）: **「準備できた」がオンの部屋に限って**主催者に中身を開く。
--   ・A案（準備状態に関わらず読み取り専用で開放）は却下 ── 作りかけを見られる。
--   ・B案（見えないままにして「部屋を開く」を撤去）も却下 ── 課金の判断材料が
--     自己申告だけになる。
-- トグルが「作りかけを見られたくない作家」と「付ける前に確かめたい主催者」を両立させる。
-- 作家はいつでもオフに戻せる（0062 の `set_expo_room_ready`）ので、**見せるかどうかの
-- 決定権は最後まで作家が持つ**。
--
-- **読み取りだけ。** 書き込みのポリシーは1つも増やさない（0062 のSQLテスト09で、主催者が
-- 参加作家の部屋を書き換えられないことを確かめてある。ここでもテストで再確認する）。
--
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。0001〜0063 を先に適用しておくこと。

/* ================= 1. 述語（1か所に置く） ================= */
-- **「その部屋は、私が主催する展示の中にあって、準備できたが立っているか」** だけを見る。
-- 2つのポリシーが同じ述語を読むので、条件が食い違う余地が無い
-- （DECISIONS【絶対ルール】2026-08-12「同じ意味の値を2か所で計算しない」）。
--
-- `security definer` にするのは、判定のために `galleries` と `expos` を横断して読む必要が
-- あるため（呼び手のRLSで絞られると、判定そのものができない）。**引数の部屋しか見ない**
-- ので、これで見えるようになるのは呼び手が既に指定した1部屋の可否だけ。
create or replace function public.expo_room_ready_for_organizer(p_gallery uuid)
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
       and g.expo_ready_at is not null
       and x.owner_id = (select auth.uid())
  );
$$;

-- **`anon` にも execute を渡す。ここを絞ってはいけない。**
-- 最初 `revoke … from public, anon` と書いたところ、**未ログインの来場者が `artworks` を
-- 1行読むだけで `permission denied for function` で落ちる**状態になった（下のSQLテスト13が
-- 検出）。RLSのポリシーは**全てのロールについて評価される**ので、`anon` の SELECT でも
-- この述語が呼ばれる ── 呼べなければクエリごとエラーになり、**公開ページが全滅する**。
-- これは 0041 で実際に本番へ出してしまった事故と同じ形（supabase/tests/README 参照）。
-- 未ログインでは `auth.uid()` が null なので、述語は常に false を返す＝権限を渡しても
-- 見えるものは1行も増えない。0047 の `invited_to_expo` が同じ理由で3ロールに配っている。
revoke all on function public.expo_room_ready_for_organizer(uuid) from public;
grant execute on function public.expo_room_ready_for_organizer(uuid) to anon, authenticated, service_role;

/* ================= 2. 作品 ================= */
-- 既存のポリシーは**1文字も変えない**（ポリシーは OR で足されるので、`artworks_owner_all`
-- や会期中の公開経路の意味を変えずに済む＝通常展示への回帰が原理的に起きない。0046 で
-- 採った作法と同じ）。
drop policy if exists "artworks_select_expo_ready_room" on public.artworks;
create policy "artworks_select_expo_ready_room"
  on public.artworks for select
  using (gallery_id is not null and public.expo_room_ready_for_organizer(gallery_id));

/* ================= 3. 配置 ================= */
-- 主催者のプレビュー（配置タブ・3D）が壁の並びを読めるように。ここも select だけ。
drop policy if exists "placements_select_expo_ready_room" on public.placements;
create policy "placements_select_expo_ready_room"
  on public.placements for select
  using (public.expo_room_ready_for_organizer(gallery_id));
