-- 合同展示の招待を成立させる（ユーザー承認 2026-08-09）— 作家が「出す」形にする
--
-- 0037 で「受諾済みの招待がある作家の作品は掛けられる」ところまで作ったが、UIが作れない。
-- **主催者には招待した作家の作品を「見る」経路が無い**（`artworks` の select は「自分の」か
-- 「どこかの公開ギャラリーに掛かっている」の2つだけ）。招待した相手の未公開の作品は
-- 1件も見えないので、主催者が選ぶ画面は原理的に描けない。
--
-- 埋め方は2つあった:
--   ①主催者が引く（pull）: 招待した作家の**全作品**を主催者に読ませ、主催者が選ぶ
--   ②作家が出す（push）: 作家が**出す作品を選び**、その分だけ主催者に見える  ← これ（ユーザー承認）
-- ②を採る理由: ①は「合同展に誘われた」だけでライブラリ全部（習作・未発表・売れた作品）が
-- 他人に見える。展示に出すつもりの無いものまで見せるのは、招待の対価として重すぎる。
-- ②なら**見える範囲＝出すと決めた範囲**で一致する。
--
-- あわせて 0037 の②を締める: 「受諾済み招待がある」→「受諾済み招待があり、かつ**その作品が
-- 提出されている**」。理由は、招待は作家という単位、掛けるかどうかは作品という単位で、
-- 前者だけで後者を許すと**受諾した瞬間に自分の全作品が掛けられる状態になる**こと。
-- 見えないから安全、には寄りかからない（公開中の作品なら id は公開ページに載っている）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 提出（作家 → 部屋） ================= */
create table if not exists public.room_submissions (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (gallery_id, artwork_id)
);

-- 主催者の画面が「この部屋への提出」を引く向き。
create index if not exists room_submissions_gallery_idx
  on public.room_submissions (gallery_id, created_at);

alter table public.room_submissions enable row level security;

/* ---- 述語は関数に出す（RLSの無限再帰を避けるため） ----
 * 最初は各ポリシーの中に `exists (select 1 from public.artworks …)` と直接書いたが、
 * **`infinite recursion detected in policy for relation "room_submissions"` で
 * 全部落ちた**（scratch Postgres で実測 2026-08-09）。下の2の select ポリシーが
 * `artworks` に `room_submissions` を読ませるので、
 *   room_submissions のポリシー → artworks の RLS → room_submissions のポリシー → …
 * と環になる。**環のどちらかを RLS の外に出さないと切れない。**
 *
 * `security definer` はテーブルの所有者として実行され、所有者は RLS を通らない
 * （`force row level security` を付けていない限り）。0037 の `may_place_artwork` が
 * 既に同じ形なので、作法もそこに合わせる。`security invoker` にしてはいけない
 * ＝呼び手のまま実行すると再帰が戻ってくる（`guard_*` 系とは逆の理由で definer）。 */

-- その作品が自分のものか。
create or replace function public.owns_artwork(p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.artworks a
     where a.id = p_artwork and a.owner_id = (select auth.uid())
  );
$$;

-- 自分の作品を、受諾済みの招待がある部屋に出せるか。辞退したあとは false に戻るので、
-- **辞退後に出し直すことはできない**。
create or replace function public.may_submit_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_artwork(p_artwork) and exists (
    select 1 from public.room_invites i
     where i.gallery_id = p_gallery
       and i.artist_id = (select auth.uid())
       and i.status = 'accepted'
  );
$$;

-- その作品が「自分の部屋に提出されている」か（2の select ポリシー用）。
create or replace function public.artwork_submitted_to_my_room(p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.room_submissions s
      join public.galleries g on g.id = s.gallery_id
     where s.artwork_id = p_artwork
       and g.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_artwork(uuid) from public, anon;
revoke all on function public.may_submit_artwork(uuid, uuid) from public, anon;
revoke all on function public.artwork_submitted_to_my_room(uuid) from public, anon;
grant execute on function public.owns_artwork(uuid) to authenticated, service_role;
grant execute on function public.may_submit_artwork(uuid, uuid) to authenticated, service_role;
grant execute on function public.artwork_submitted_to_my_room(uuid) to authenticated, service_role;

-- 作家: 自分の作品を、**受諾済みの招待がある部屋にだけ**出せる。
drop policy if exists "room_submissions_artist_insert" on public.room_submissions;
create policy "room_submissions_artist_insert"
  on public.room_submissions for insert
  with check (public.may_submit_artwork(gallery_id, artwork_id));

-- 作家: 自分が出したものは**いつでも引っ込められる**（招待の受諾と対称）。
-- 招待の状態は見ない — 辞退したあとに取り下げられないと、行が残り続ける。
drop policy if exists "room_submissions_artist_delete" on public.room_submissions;
create policy "room_submissions_artist_delete"
  on public.room_submissions for delete using (public.owns_artwork(artwork_id));

drop policy if exists "room_submissions_artist_read" on public.room_submissions;
create policy "room_submissions_artist_read"
  on public.room_submissions for select using (public.owns_artwork(artwork_id));

-- 部屋の所有者: 自分の部屋への提出を見る。**書けない**（提出は作家の意思表示なので、
-- 主催者が代わりに出せてはいけない ── 0037 で status を主催者に触らせなかったのと同じ）。
-- `galleries` は `room_submissions` を読まないので、ここは環にならず直接書ける。
drop policy if exists "room_submissions_owner_read" on public.room_submissions;
create policy "room_submissions_owner_read"
  on public.room_submissions for select using (
    exists (
      select 1 from public.galleries g
       where g.id = gallery_id and g.owner_id = (select auth.uid())
    )
  );

/* ================= 1.5 招かれた作家が「どの展示か」を読める ================= */
-- `galleries` の select は 0001 で **所有者 or `is_public`** だけ。合同展示は**非公開の
-- あいだに準備する**のが普通なので、招かれた作家は招待の行は見えても
-- **部屋のタイトルも主催者も読めない** ＝「何に招かれたのか」が表示できない。
--
-- これも `security definer` 経由にする。`room_invites` のポリシーが `galleries` を読む
-- ので、`galleries` のポリシーに `room_invites` を直接書くと今度はそこで環になる。
create or replace function public.invited_to_room(p_gallery uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_invites i
     where i.gallery_id = p_gallery and i.artist_id = (select auth.uid())
  );
$$;

revoke all on function public.invited_to_room(uuid) from public, anon;
grant execute on function public.invited_to_room(uuid) to authenticated, service_role;

-- 辞退したあとも読めるままにする（受諾し直せるわけではないが、履歴として
-- 「辞退した展示」を出せないと、受信箱から行が消えて何が起きたのか分からなくなる）。
drop policy if exists "galleries_select_invited" on public.galleries;
create policy "galleries_select_invited"
  on public.galleries for select using (public.invited_to_room(id));

/* ================= 2. 主催者が提出された作品を読める ================= */
-- これが無いと、提出の行は見えても**作品の中身（画像・タイトル・寸法）が読めない**ので
-- 選ぶ画面が描けない。範囲は「提出された作品」だけ ── 招待した作家の全作品ではない。
drop policy if exists "artworks_select_submitted_to_my_room" on public.artworks;
create policy "artworks_select_submitted_to_my_room"
  on public.artworks for select using (public.artwork_submitted_to_my_room(id));

/* ================= 3. 掛けてよいかの述語を締める ================= */
-- 0037 の②「受諾済み招待がある」に、**提出済み**を足す。①（自分の作品）は変えない
-- ので、合同展示より前の全ケースは今までどおり。
create or replace function public.may_place_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- ① 部屋の所有者が、その作品の所有者でもある（今までの全ケースがこれ）
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
     where g.id = p_gallery and a.owner_id = g.owner_id
  ) or exists (
    -- ② 作品の所有者がこの部屋への招待を受諾しており、かつ**その作品を出している**
    select 1
      from public.artworks a
      join public.room_invites i
        on i.gallery_id = p_gallery and i.artist_id = a.owner_id and i.status = 'accepted'
      join public.room_submissions s
        on s.gallery_id = p_gallery and s.artwork_id = a.id
     where a.id = p_artwork
  );
$$;

revoke all on function public.may_place_artwork(uuid, uuid) from public;
grant execute on function public.may_place_artwork(uuid, uuid) to authenticated, service_role;

/* ================= 4. 取り下げたら壁から下りる ================= */
-- 0037 が招待に対してやっていることを、提出に対してもやる。引っ込めたのに掛かったまま
-- なら、提出を選べる意味が無い。**その1点だけ**を外す（招待の取り下げは作家の作品を
-- まとめて外すが、こちらは作品単位）。
create or replace function public.drop_placement_on_unsubmit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 部屋の所有者自身の作品は①で許されているので触らない（提出の行があっても、
  -- それは主催者が自分の部屋に自分の作品を出したケースで、外す理由が無い）。
  delete from public.placements p
   where p.gallery_id = old.gallery_id
     and p.artwork_id = old.artwork_id
     and exists (
       select 1 from public.artworks a
        where a.id = old.artwork_id
          and a.owner_id <> (select g.owner_id from public.galleries g where g.id = old.gallery_id)
     );
  return old;
end;
$$;

drop trigger if exists room_submissions_unsubmit on public.room_submissions;
create trigger room_submissions_unsubmit
  after delete on public.room_submissions
  for each row execute function public.drop_placement_on_unsubmit();

/* ================= 5. 招待を取り下げたら提出も消える ================= */
-- 0037 の `drop_placements_on_revoke` は placement だけを消していた。提出の行が残ると、
-- **辞退したのに主催者からは作品が見えたまま**になる（2の select ポリシーは招待を見ない）。
-- 招待が消えた／辞退に変わった時点で、その作家のその部屋への提出も引き上げる。
create or replace function public.drop_placements_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_gallery := old.gallery_id; v_artist := old.artist_id;
  else
    -- 受諾のままなら何もしない
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_gallery := new.gallery_id; v_artist := new.artist_id;
  end if;

  -- その部屋に掛かっている「この作家の作品」だけを外す。部屋の所有者自身の作品は
  -- ①で許されているので触らない。
  delete from public.placements p
   where p.gallery_id = v_gallery
     and exists (
       select 1 from public.artworks a
        where a.id = p.artwork_id
          and a.owner_id = v_artist
          and a.owner_id <> (select g.owner_id from public.galleries g where g.id = v_gallery)
     );

  -- 提出も引き上げる（上で placement は消えているので、トリガの二重発火は無害）。
  delete from public.room_submissions s
   where s.gallery_id = v_gallery
     and exists (
       select 1 from public.artworks a
        where a.id = s.artwork_id and a.owner_id = v_artist
     );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

/* ================= 6. @ハンドルで招く ================= */
-- 招待は**ハンドルで指定する**（ユーザー承認 2026-08-09）。メールは持っていない相手も
-- 招けるが、**アカウントの有無を問い合わせられる**ようになってしまう（総当たりで
-- 「このメールは登録済み」が引ける）。ハンドルは `/@名前` として既に公開されている。
--
-- 関数にしたのは、`profiles` の select が `using (true)` でもクライアントから
-- 「ハンドル → id」を引いて insert する2往復になり、その間に相手がハンドルを変えると
-- 別人を招く事故が起きるため。1文で解決して入れる。
create or replace function public.invite_artist_by_handle(p_gallery uuid, p_handle text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_owner uuid;
  v_clean text;
  v_id uuid;
begin
  select g.owner_id into v_owner from public.galleries g where g.id = p_gallery;
  if v_owner is null then
    raise exception 'no such room';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your room';
  end if;

  -- `@` 付きで貼られても受ける（画面の見本が `@handle` なので必ず起きる）。
  v_clean := lower(trim(coalesce(p_handle, '')));
  v_clean := regexp_replace(v_clean, '^@+', '');
  if v_clean = '' then
    raise exception 'no handle given';
  end if;

  select p.id into v_artist from public.profiles p where lower(p.username) = v_clean;
  if v_artist is null then
    raise exception 'no such artist: %', p_handle;
  end if;
  if v_artist = v_owner then
    -- 自分の作品は①で掛かるので招待は不要。招くと「参加者に自分が並ぶ」ことになる。
    raise exception 'cannot invite yourself';
  end if;

  insert into public.room_invites (gallery_id, artist_id, status)
  values (p_gallery, v_artist, 'pending')
  -- **受諾済みは絶対に巻き戻さない**（pending に戻すと 0041 のトリガが提出も掛かって
  -- いる作品も引き上げる＝招き直しただけで展示が壊れる）。
  -- ただし**辞退された相手は招き直せる**必要がある: `do nothing` だけにすると、
  -- 一度断られた相手に声をかけ直す道が無く、**エラーも出ないまま何も起きない**
  -- （行は declined のまま、`may_submit_artwork` も false のまま。別視点レビュー指摘）。
  on conflict (gallery_id, artist_id) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.room_invites.status = 'declined'
  returning id into v_id;

  if v_id is null then
    -- `do update` の where が false（＝pending か accepted のまま）。既存の行を返す。
    select i.id into v_id from public.room_invites i
     where i.gallery_id = p_gallery and i.artist_id = v_artist;
  end if;
  return v_id;
end;
$$;

revoke all on function public.invite_artist_by_handle(uuid, text) from public;
revoke all on function public.invite_artist_by_handle(uuid, text) from anon;
grant execute on function public.invite_artist_by_handle(uuid, text) to authenticated;

/* ================= 7. 既存データの点検 ================= */
-- 3で述語を締めたので、**0037 の緩い条件で入っていた placement** が居ると次の再公開で
-- 弾かれる。0037 の時点では「受諾済み招待」だけで通っていたので、招待UIが無かった
-- 今日までは0件のはずだが、数えて報告する（本番に無いことを動作確認では出せない）。
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
    join public.artworks a on a.id = p.artwork_id
   where a.owner_id <> g.owner_id
     and not public.may_place_artwork(p.gallery_id, p.artwork_id);
  if v_bad > 0 then
    raise warning '0041: % placements would now fail the tightened consent check (accepted invite but the work was never submitted). They stay visible but will be rejected on the next republish — review them.', v_bad;
  else
    raise notice '0041: no placements affected by the tightened check (expected).';
  end if;
end $$;
