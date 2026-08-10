-- 招待を合同展示（`expos`）のものにする ── 部屋への招待を撤去する（ユーザー選択A 2026-08-09）
--
-- 0037/0041 では招待と提出が**部屋（`galleries`）単位**だった。0044 で合同展示が
-- 独立した実体になり「招待は合同展示だけの機能にする」と決まった（ユーザー選択A）ので、
-- 単位を合わせる。
--
-- **なぜ部屋単位ではいけないか**: 合同展示は部屋を複数ぶら下げられる（0044）。部屋単位の
-- ままだと、主催者が2室目を作った瞬間に**同じ作家をもう一度招き直さないと掛けられない**。
-- 招待は「この展示に参加しますか」という1回の話であって、部屋の数だけ繰り返す話ではない。
--
-- **提出も展示単位にする。** 作家は「この展示に出す作品」を選び、**どの部屋に掛けるかは
-- 主催者が決める**。作家に部屋を選ばせると、主催者が構成を変えるたびに作家の同意が
-- 迷子になる（部屋を消すと提出も消える＝出したはずの作品が黙って引き上がる）。
-- 同意の中身は「この展示に、この作品を出す」で閉じている。
--
-- 引き継ぐもの（0037/0041 で血を流して決めた形は変えない）:
--   ・**作家が出す（push）**。主催者は相手のライブラリを見ない ── 見える範囲＝出すと決めた範囲。
--   ・**同意は作品単位**。「受諾済み」だけでは掛けられず、その作品が提出されていること。
--   ・**辞退・取り下げでその場で壁から下りる。**
--   ・**述語は `security definer` の関数に出す。** ポリシーの中に直接書くと
--     `submissions` ⇄ `artworks` で **RLS が無限再帰**して全部落ちる（0041 で実測）。
--   ・**ポリシーが呼ぶ関数は `anon` にも grant する。** `artworks` に載るポリシーは
--     未ログインの来場者が公開ページを開くだけで評価されるので、渡し忘れると
--     `permission denied for function` で**公開サイトが全滅する**（0041 で実際にやった）。
--     渡しても漏れない ── どれも `auth.uid()` を見るので anon では常に false。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
--
-- **この migration は `room_invites` / `room_submissions` を落とす。** 招待UIが動いて
-- いたのは今日までで、本番に行があれば下の 0 節が件数を報告してから消す（招待は
-- まだ誰も使っていないはずだが、動作確認では「無いこと」を示せない）。

/* ================= 0. 何を捨てるかを先に数える ================= */
do $$
declare
  v_inv int := 0;
  v_sub int := 0;
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'room_invites') then
    execute 'select count(*) from public.room_invites' into v_inv;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'room_submissions') then
    execute 'select count(*) from public.room_submissions' into v_sub;
  end if;
  if v_inv > 0 or v_sub > 0 then
    raise warning '0047: 部屋への招待 % 件・提出 % 件を捨てます（合同展示への招待に載せ替えたので、必要なら主催者が招き直してください）。掛かっている placement は下の 8 節で外れます。', v_inv, v_sub;
  else
    raise notice '0047: 捨てる部屋への招待・提出はありません（想定どおり）。';
  end if;
end $$;

/* ================= 1. 招待（主催者 → 作家。展示単位） ================= */
create table if not exists public.expo_invites (
  id uuid primary key default gen_random_uuid(),
  expo_id uuid not null references public.expos (id) on delete cascade,
  /** 招かれた作家。この人が出した作品が、この展示の部屋に掛けられるようになる。 */
  artist_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (expo_id, artist_id)
);

-- 受信箱が引く向き（自分宛の招待）と、主催者の参加者一覧が引く向き。
create index if not exists expo_invites_artist_idx on public.expo_invites (artist_id, status);
create index if not exists expo_invites_expo_idx on public.expo_invites (expo_id, created_at);

alter table public.expo_invites enable row level security;

/* 主催者: 出す・見る・取り下げる。**status は自分では動かせない**（受諾は作家の
 * 意思表示なので、招いた側が勝手に 'accepted' にできてはいけない）。update を
 * 持つのは下の作家向けポリシーだけ。 */
drop policy if exists "expo_invites_owner_read" on public.expo_invites;
create policy "expo_invites_owner_read"
  on public.expo_invites for select using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

drop policy if exists "expo_invites_owner_insert" on public.expo_invites;
create policy "expo_invites_owner_insert"
  on public.expo_invites for insert with check (
    status = 'pending'
    and exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

drop policy if exists "expo_invites_owner_delete" on public.expo_invites;
create policy "expo_invites_owner_delete"
  on public.expo_invites for delete using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

-- 作家: 自分宛の招待を見る／受諾・辞退する（＝いつでも取り下げられる）。
drop policy if exists "expo_invites_artist_read" on public.expo_invites;
create policy "expo_invites_artist_read"
  on public.expo_invites for select using (artist_id = (select auth.uid()));

drop policy if exists "expo_invites_artist_respond" on public.expo_invites;
create policy "expo_invites_artist_respond"
  on public.expo_invites for update
  using (artist_id = (select auth.uid()))
  with check (artist_id = (select auth.uid()) and status in ('accepted', 'declined'));

/* ================= 2. 招かれた作家が「何に招かれたのか」を読める ================= */
-- `expos` の select は 0044 で **所有者 or 会期が生きている or 管理者**。合同展示は
-- **会期前（下書き）に準備する**のがふつうなので、これが無いと招かれた作家に
-- 展示の題名も主催者も読めない ＝ 受信箱に「何かに招かれました」しか出せない。
--
-- `security definer` にするのは、`expo_invites` のポリシーが `expos` を読むため
-- （`expos` のポリシーに `expo_invites` を直接書くと環になる。0041 と同じ形）。
create or replace function public.invited_to_expo(p_expo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expo_invites i
     where i.expo_id = p_expo and i.artist_id = (select auth.uid())
  );
$$;

revoke all on function public.invited_to_expo(uuid) from public;
grant execute on function public.invited_to_expo(uuid) to anon, authenticated, service_role;

-- 辞退したあとも読めるままにする（受諾し直せるわけではないが、履歴として
-- 「辞退した展示」を出せないと、受信箱から行が消えて何が起きたのか分からなくなる）。
drop policy if exists "expos_select_invited" on public.expos;
create policy "expos_select_invited"
  on public.expos for select using (public.invited_to_expo(id));

/* ================= 3. 提出（作家 → 展示） ================= */
create table if not exists public.expo_submissions (
  id uuid primary key default gen_random_uuid(),
  expo_id uuid not null references public.expos (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (expo_id, artwork_id)
);

-- 主催者の配置画面が「この展示への提出」を引く向き。
create index if not exists expo_submissions_expo_idx
  on public.expo_submissions (expo_id, created_at);

alter table public.expo_submissions enable row level security;

-- 自分の作品を、受諾済みの招待がある展示に出せるか。辞退したあとは false に戻るので、
-- **辞退後に出し直すことはできない**。
create or replace function public.may_submit_to_expo(p_expo uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.owns_artwork(p_artwork) and exists (
    select 1 from public.expo_invites i
     where i.expo_id = p_expo
       and i.artist_id = (select auth.uid())
       and i.status = 'accepted'
  );
$$;

-- その作品が「自分が主催する展示に提出されている」か（下の artworks の select 用）。
create or replace function public.artwork_submitted_to_my_expo(p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.expo_submissions s
      join public.expos x on x.id = s.expo_id
     where s.artwork_id = p_artwork
       and x.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.may_submit_to_expo(uuid, uuid) from public;
revoke all on function public.artwork_submitted_to_my_expo(uuid) from public;
grant execute on function public.may_submit_to_expo(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.artwork_submitted_to_my_expo(uuid) to anon, authenticated, service_role;

-- 作家: 自分の作品を、**受諾済みの招待がある展示にだけ**出せる。
drop policy if exists "expo_submissions_artist_insert" on public.expo_submissions;
create policy "expo_submissions_artist_insert"
  on public.expo_submissions for insert
  with check (public.may_submit_to_expo(expo_id, artwork_id));

-- 作家: 出したものは**いつでも引っ込められる**（招待の受諾と対称）。招待の状態は見ない
-- ── 辞退したあとに取り下げられないと、行が残り続ける。
drop policy if exists "expo_submissions_artist_delete" on public.expo_submissions;
create policy "expo_submissions_artist_delete"
  on public.expo_submissions for delete using (public.owns_artwork(artwork_id));

drop policy if exists "expo_submissions_artist_read" on public.expo_submissions;
create policy "expo_submissions_artist_read"
  on public.expo_submissions for select using (public.owns_artwork(artwork_id));

-- 主催者: 自分の展示への提出を見る。**書けない**（提出は作家の意思表示なので、
-- 主催者が代わりに出せてはいけない ── status を主催者に触らせないのと同じ理由）。
-- `expos` は `expo_submissions` を読まないので、ここは環にならず直接書ける。
drop policy if exists "expo_submissions_owner_read" on public.expo_submissions;
create policy "expo_submissions_owner_read"
  on public.expo_submissions for select using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

/* ================= 4. 主催者が提出された作品を読める ================= */
-- これが無いと、提出の行は見えても**作品の中身（画像・タイトル・寸法）が読めない**ので
-- 選ぶ画面が描けない。範囲は「提出された作品」だけ ── 招待した作家の全作品ではない。
drop policy if exists "artworks_select_submitted_to_my_expo" on public.artworks;
create policy "artworks_select_submitted_to_my_expo"
  on public.artworks for select using (public.artwork_submitted_to_my_expo(id));

/* ================= 5. 掛けてよいかの述語（部屋 → 展示に読み替え） ================= */
-- ①（自分の作品）は 0037 から変えない。②を「その部屋が属する展示への受諾済み招待が
-- あり、かつその作品がその展示に提出されている」にする。
--
-- **`expo_id is null` の部屋（通常展示）では②が絶対に成立しない**ので、通常展示に
-- 他人の作品が入る道は無い（0037 で塞いだ穴は塞がったまま）。
create or replace function public.may_place_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- ① 部屋の所有者が、その作品の所有者でもある（通常展示の全ケースがこれ）
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
     where g.id = p_gallery and a.owner_id = g.owner_id
  ) or exists (
    -- ② 合同展示の部屋で、作品の所有者がその展示への招待を受諾しており、
    --    かつ**その作品をその展示に出している**
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
      join public.expo_invites i
        on i.expo_id = g.expo_id and i.artist_id = a.owner_id and i.status = 'accepted'
      join public.expo_submissions s
        on s.expo_id = g.expo_id and s.artwork_id = a.id
     where g.id = p_gallery and g.expo_id is not null
  );
$$;

revoke all on function public.may_place_artwork(uuid, uuid) from public;
grant execute on function public.may_place_artwork(uuid, uuid) to authenticated, service_role;

/* ================= 6. 取り下げたら壁から下りる（作品単位） ================= */
-- 引っ込めたのに掛かったままなら、提出を選べる意味が無い。**その展示の全部屋**から
-- 外す（提出は展示単位なので、どの部屋に掛かっているかは主催者しか知らない）。
create or replace function public.drop_placements_on_unsubmit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.placements p
   using public.galleries g, public.artworks a
   where p.gallery_id = g.id
     and g.expo_id = old.expo_id
     and p.artwork_id = old.artwork_id
     and a.id = old.artwork_id
     -- 主催者自身の作品は①で許されているので触らない。
     and a.owner_id <> g.owner_id;
  return old;
end;
$$;

drop trigger if exists expo_submissions_unsubmit on public.expo_submissions;
create trigger expo_submissions_unsubmit
  after delete on public.expo_submissions
  for each row execute function public.drop_placements_on_unsubmit();

/* ================= 7. 辞退・取り下げで作家ごと下りる ================= */
-- 受諾を取り消した（辞退に変えた・招待が消えた）のに作品が掛かったままなら、同意の
-- 意味が無い。**その展示の全部屋**からその作家の作品を外し、提出も引き上げる
-- （提出が残ると、辞退したのに主催者からは作品が見えたまま＝4の select は招待を見ない）。
create or replace function public.drop_placements_on_expo_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expo uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_expo := old.expo_id; v_artist := old.artist_id;
  else
    -- 受諾のままなら何もしない
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_expo := new.expo_id; v_artist := new.artist_id;
  end if;

  delete from public.placements p
   using public.galleries g, public.artworks a
   where p.gallery_id = g.id
     and g.expo_id = v_expo
     and a.id = p.artwork_id
     and a.owner_id = v_artist
     -- 主催者自身の作品は①で許されているので触らない。
     and a.owner_id <> g.owner_id;

  -- 提出も引き上げる（上で placement は消えているので、6のトリガの二重発火は無害）。
  delete from public.expo_submissions s
   using public.artworks a
   where s.expo_id = v_expo
     and a.id = s.artwork_id
     and a.owner_id = v_artist;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists expo_invites_revoke on public.expo_invites;
create trigger expo_invites_revoke
  after update or delete on public.expo_invites
  for each row execute function public.drop_placements_on_expo_revoke();

/* ================= 8. @ハンドルで招く ================= */
-- ハンドルで指定する（ユーザー承認 2026-08-09）。メールだと**アカウントの有無を
-- 問い合わせられる**ようになる（総当たりで「このメールは登録済み」が引ける）。
-- ハンドルは `/@名前` として既に公開されている。
--
-- 関数にしたのは、クライアントから「ハンドル → id」を引いて insert する2往復のあいだに
-- 相手がハンドルを変えると**別人を招く**事故が起きるため。1文で解決して入れる。
create or replace function public.invite_artist_to_expo(p_expo uuid, p_handle text)
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
  select x.owner_id into v_owner from public.expos x where x.id = p_expo;
  if v_owner is null then
    raise exception 'no such exhibition';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your exhibition';
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
    -- 主催者の作品は①で掛かるので招待は不要。招くと「参加者に自分が並ぶ」ことになる。
    raise exception 'cannot invite yourself';
  end if;

  insert into public.expo_invites (expo_id, artist_id, status)
  values (p_expo, v_artist, 'pending')
  -- **受諾済みは絶対に巻き戻さない**（pending に戻すと7のトリガが提出も掛かっている
  -- 作品も引き上げる＝招き直しただけで展示が壊れる）。ただし**辞退された相手は
  -- 招き直せる**必要がある: `do nothing` だけにすると、一度断られた相手に声をかけ直す
  -- 道が無く、**エラーも出ないまま何も起きない**（0041 の別視点レビュー指摘）。
  on conflict (expo_id, artist_id) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.expo_invites.status = 'declined'
  returning id into v_id;

  if v_id is null then
    -- `do update` の where が false（＝pending か accepted のまま）。既存の行を返す。
    select i.id into v_id from public.expo_invites i
     where i.expo_id = p_expo and i.artist_id = v_artist;
  end if;
  return v_id;
end;
$$;

revoke all on function public.invite_artist_to_expo(uuid, text) from public, anon;
grant execute on function public.invite_artist_to_expo(uuid, text) to authenticated;

/* ================= 9. 通知の宛先を展示に付け替える（0042） ================= */
-- 0042 の3本は `room_invites` / `room_submissions` に載っていた。表を落とすとトリガも
-- 一緒に消えるので、**同じ意味のものを新しい表に作り直す**（作らないと招待に気づく
-- 経路が無くなる＝0042 を作った理由そのものが消える）。
--
-- `notifications.gallery_id` は**入れない**（合同展示に対応する部屋は1つに決まらない）。
-- 見出しは展示の題名を焼き込む ── source が消えても読めるようにするのが 0042 の作法。

create or replace function public.notify_expo_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
  v_organizer text;
begin
  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;
  select coalesce(p.display_name, p.username) into v_organizer
    from public.profiles p where p.id = v_owner;

  perform public.push_notification(
    new.artist_id, 'invite', null, null, coalesce(v_title, ''), '', v_organizer
  );
  return new;
end;
$$;

drop trigger if exists expo_invites_notify on public.expo_invites;
create trigger expo_invites_notify
  after insert on public.expo_invites
  for each row execute function public.notify_expo_invite();

-- 受諾・辞退を**主催者へ**返す。招いたまま返事を待つ側にも通知が要る（辞退は特に:
-- 気づかないと空いた枠を埋め直せない）。
create or replace function public.notify_expo_invite_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
  v_artist text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted', 'declined') then return new; end if;

  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;
  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = new.artist_id;

  -- 本文に状態を入れる（`accepted` / `declined`）。表示側が文言を選ぶための値で、
  -- 画面に出す英語ではない。
  perform public.push_notification(
    v_owner, 'invite_reply', null, null, coalesce(v_title, ''), new.status, v_artist
  );
  return new;
end;
$$;

drop trigger if exists expo_invites_reply_notify on public.expo_invites;
create trigger expo_invites_reply_notify
  after update of status on public.expo_invites
  for each row execute function public.notify_expo_invite_reply();

-- 提出を**主催者へ**。作家は複数点まとめて出すので**作家ごと・1日1件にまとめる**。
create or replace function public.notify_expo_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
  v_artist_id uuid;
  v_artist text;
begin
  select x.owner_id, x.title into v_owner, v_title
    from public.expos x where x.id = new.expo_id;
  select a.owner_id into v_artist_id
    from public.artworks a where a.id = new.artwork_id;

  -- 主催者が自分の作品を出したときは通知しない。
  if v_owner is null or v_owner is not distinct from v_artist_id then return new; end if;

  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = v_artist_id;

  -- まとめの鍵は (展示, 作家)。作家は `actor_name` で持つので、同じ日に2人が出しても
  -- 2件に分かれる（1件に畳むと誰が出したのか分からなくなる）。
  -- `p_gallery` は null なので、まとめは「同じ kind・同じ actor・未読・同日」で当たる。
  perform public.push_notification_rollup(
    v_owner, 'submission', null, null, coalesce(v_title, ''), v_artist
  );
  return new;
end;
$$;

drop trigger if exists expo_submissions_notify on public.expo_submissions;
create trigger expo_submissions_notify
  after insert on public.expo_submissions
  for each row execute function public.notify_expo_submission();

/* ================= 10. 部屋への招待を撤去する ================= */
-- **ここから下は 0037/0041 の取り壊し。** 表を落とせばポリシーとトリガは一緒に消えるので、
-- 残るのは「どこからも呼ばれなくなった関数」と、`galleries` に載っていたポリシー1本。
--
-- 順序が要る: `may_place_artwork` は 5 で**もう書き換えてある**（`room_invites` を
-- 参照しない版になっている）。先に表を落とすと、書き換える前の版が壊れた関数として
-- 残る瞬間ができる ── だから**書き換えてから落とす**。

-- 招かれた作家に部屋を読ませていたポリシー（0041 の 1.5）。招待は展示単位になったので、
-- 読ませる先は `expos`（上の 2）に移った。
drop policy if exists "galleries_select_invited" on public.galleries;

-- 0041 が `artworks` に載せていた select（部屋への提出）。4 で展示版に置き換えたので落とす。
-- **表を落としてもポリシーは残る**（`artworks` は消えていないので）ため、明示的に消す
-- ── 残ると `artwork_submitted_to_my_room` を呼び続けて `artworks` の select が全部落ちる。
--
-- **関数より先に落とす。** ポリシーは関数への依存として登録されるので、順番を逆にすると
-- `drop function` が `cannot drop function … because other objects depend on it` で落ちる
-- （実測 2026-08-10。しかもハーネスが psql の失敗を握り潰していたので、表だけ消えて
-- 関数とポリシーが残った半端なDBを相手に検査していた）。
drop policy if exists "artworks_select_submitted_to_my_room" on public.artworks;

drop table if exists public.room_submissions cascade;
drop table if exists public.room_invites cascade;

-- 参照先が消えて使えなくなった関数。**残すと「まだ部屋への招待がある」と読める**ので消す。
drop function if exists public.invited_to_room(uuid);
drop function if exists public.may_submit_artwork(uuid, uuid);
drop function if exists public.artwork_submitted_to_my_room(uuid);
drop function if exists public.invite_artist_by_handle(uuid, text);
drop function if exists public.drop_placement_on_unsubmit();
drop function if exists public.drop_placements_on_revoke();
drop function if exists public.notify_invite();
drop function if exists public.notify_invite_reply();
drop function if exists public.notify_submission();

/* ================= 11. 締めた述語で弾かれる placement を数える ================= */
-- 5 で②の条件が「部屋への招待」から「展示への招待」に変わったので、**部屋への招待で
-- 入っていた placement** は次の再公開で弾かれる。7 のトリガは表を落とす前には走らない
-- （`drop table` はトリガを発火させない）ので、ここで数えて報告する。
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
    raise warning '0047: % 件の placement が新しい同意の条件を満たしません（部屋への招待で入っていたもの）。表示は残りますが次の再公開で弾かれます ── 主催者が合同展示として招き直してください。', v_bad;
  else
    raise notice '0047: 影響を受ける placement はありません（想定どおり）。';
  end if;
end $$;
