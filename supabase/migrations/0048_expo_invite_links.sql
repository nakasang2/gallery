-- 招待リンク（ユーザー決定 2026-08-10）— 「配れるURL」で参加希望を集め、主催者が承認する
--
-- 0047 で招待は `@ハンドル` を打つ経路だけになった。主催者が10人に声をかけるには10回
-- ハンドルを聞き出す必要があり、**相手のハンドルを知らないと招けない**（SNSのDMで
-- 「ハンドル教えて」から始まる）。配れるURLがあれば、主催者は1本貼るだけで済む。
--
-- ユーザー決定（2026-08-10）:
--   ・**リンクはログイン済みの誰でも使える**（人数上限は付けない）。流出しても実害は
--     「承認待ちが増える」だけ ── **承認するまで何も公開されないし、何も掛からない**。
--     効かなくしたいときは主催者が**無効化**する（下の `revoked_at`）。
--   ・**未登録の人には先に展示を見せる**（題名・主催者・会期）。そのうえで登録を促す。
--     何に誘われたのか分からないまま登録を求めない。
--   ・**参加希望は通知でも伝える**（`invite_request`）＋参加者一覧に「承認待ち」で並ぶ。
--
-- 形（0047 の状態機械に1つ足すだけ）:
--   `pending`   — **主催者が招いた**。作家の返事待ち
--   `requested` — **作家が希望を出した**。主催者の承認待ち  ← 今回追加
--   `accepted`  — 参加確定。ここから作品を出せる
--   `declined`  — 辞退（または希望の取り下げ）
--
-- **`requested` は何の権限も与えない。** `may_submit_to_expo` は `accepted` しか見ないので、
-- 承認前の作家は1点も出せず、掛けることもできない（0047 のまま）。
--
-- **作家が自分で `requested` → `accepted` にできてはいけない。** 0047 の
-- `expo_invites_artist_respond` は「自分の行を accepted/declined にできる」なので、
-- そのままだと**希望を出した本人が自分を承認できてしまう**＝承認の意味が消える。
-- 下の 4 のガードで塞ぐ（ポリシーの `with check` からは OLD が見えないのでトリガでやる）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. 状態を1つ増やす ================= */
-- `check` は差分更新できないので毎回書き直す（0044 の `purchases_kind_check` と同じ作法）。
alter table public.expo_invites drop constraint if exists expo_invites_status_check;
alter table public.expo_invites add constraint expo_invites_status_check
  check (status in ('pending', 'requested', 'accepted', 'declined'));

-- 通知の種類も2つ増やす（**主催者へ**「希望が来た」・**作家へ**「承認された」）。
-- 1つの種類に畳まないのは、宛先も文面も逆向きだから。
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'like', 'guestbook', 'announce'));

/* ================= 1. リンク ================= */
create table if not exists public.expo_invite_links (
  id uuid primary key default gen_random_uuid(),
  expo_id uuid not null references public.expos (id) on delete cascade,
  /**
   * URL に載る文字列。**サーバが作る**（下の `create_expo_invite_link`）ので、
   * クライアントが弱い値を選べない。当てずっぽうで当たらない長さがあれば、
   * 「知っている人だけが使える」という性質はこれ1本で足りる。
   */
  token text not null unique,
  /** 無効化した時刻。**行は消さない** — 「あのリンクはいつ止めたか」を残す。 */
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists expo_invite_links_expo_idx
  on public.expo_invite_links (expo_id, created_at desc);

alter table public.expo_invite_links enable row level security;

-- 主催者だけが自分の展示のリンクを読める・無効化できる。**anon にも authenticated にも
-- select を開けない** ── 開けると表を1回読むだけで**全部のトークンが手に入る**
-- （招待リンクは「知っていること」が唯一の鍵なので、一覧できたら鍵ではなくなる）。
-- リンクを踏んだ人が展示を引く経路は、下の 3 の `security definer` 関数だけ。
drop policy if exists "expo_invite_links_owner_all" on public.expo_invite_links;
create policy "expo_invite_links_owner_all"
  on public.expo_invite_links for all
  using (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );

/* ================= 2. リンクを作る（トークンはサーバが決める） ================= */
create or replace function public.create_expo_invite_link(p_expo uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token text;
begin
  select x.owner_id into v_owner from public.expos x where x.id = p_expo;
  if v_owner is null then
    raise exception 'no such exhibition';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your exhibition';
  end if;

  -- v4 UUID 2本＝64文字の16進（約244ビット）。**`gen_random_bytes` は使わない** ──
  -- あれは pgcrypto の関数で、Supabase では `extensions` スキーマに入るので
  -- `set search_path = ''` のこの関数からは `public.` でも `extensions.` でも
  -- 環境次第で解決できない。`gen_random_uuid()` は Postgres 13 以降の組み込み
  -- （`pg_catalog`＝search_path を空にしても常に見える）なので、どの環境でも動く。
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.expo_invite_links (expo_id, token) values (p_expo, v_token);
  return v_token;
end;
$$;

revoke all on function public.create_expo_invite_link(uuid) from public, anon;
grant execute on function public.create_expo_invite_link(uuid) to authenticated;

/* ================= 3. リンクを踏んだ人が展示を引く ================= */
/**
 * トークンから展示の**表に出せる情報だけ**を返す。`security definer` なのは、
 * リンクを踏んだ人が（まだ招かれてもいないし、会期も始まっていないので）`expos` を
 * 読めないから。**返すのは題名・主催者・会期だけ**で、部屋も作品も返さない
 * ── リンクは「参加しませんか」の案内で、展示の中身の先行公開ではない。
 *
 * 無効化されたリンク・存在しないトークンは**0行**（「無効です」と「そんなリンクは無い」を
 * 区別しない ── 区別すると総当たりで有効なトークンを探せる）。
 *
 * `my_status` は呼び手自身の招待の状態（未ログインなら null）。画面が
 * 「もう希望を出しています」「すでに参加しています」を出し分けるために使う。
 */
create or replace function public.expo_by_invite_token(p_token text)
returns table (
  expo_id uuid,
  slug text,
  title text,
  statement text,
  starts_at timestamptz,
  ends_at timestamptz,
  organizer_name text,
  organizer_username text,
  my_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id,
         x.slug,
         x.title,
         x.statement,
         x.starts_at,
         x.ends_at,
         coalesce(p.display_name, p.username, ''),
         p.username,
         (select i.status from public.expo_invites i
           where i.expo_id = x.id and i.artist_id = (select auth.uid()))
    from public.expo_invite_links l
    join public.expos x on x.id = l.expo_id
    left join public.profiles p on p.id = x.owner_id
   where l.token = p_token
     and l.revoked_at is null;
$$;

revoke all on function public.expo_by_invite_token(text) from public;
grant execute on function public.expo_by_invite_token(text) to anon, authenticated, service_role;

/* ================= 4. 参加希望を出す ================= */
/**
 * リンクから「参加したい」を出す。**これは権限を1つも増やさない** — 主催者が承認する
 * まで `accepted` にならず、`may_submit_to_expo` は `accepted` しか見ない。
 *
 * 既にある行の扱い:
 *   `accepted`  → そのまま（もう参加している）
 *   `pending`   → **`accepted` にする。** 主催者が既に招いていて、本人がリンクから
 *                 「参加したい」と言った ── 受信箱の［受ける］と同じ意思表示なので、
 *                 承認を待たせる理由が無い（待たせると「招いたのに入れない」になる）
 *   `declined`  → `requested`（気が変わった。主催者の承認からやり直す）
 *   `requested` → そのまま（二度押し）
 *
 * 返すのは結果の状態。画面がそのまま文言を選べる。
 */
create or replace function public.request_expo_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expo uuid;
  v_owner uuid;
  v_me uuid := (select auth.uid());
  v_status text;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select x.id, x.owner_id into v_expo, v_owner
    from public.expo_invite_links l
    join public.expos x on x.id = l.expo_id
   where l.token = p_token and l.revoked_at is null;
  if v_expo is null then
    raise exception 'link not found';
  end if;
  if v_owner = v_me then
    -- 主催者の作品は招待なしで掛かる。自分の展示に希望を出すと参加者に自分が並ぶ。
    raise exception 'this is your own exhibition';
  end if;

  select i.status into v_status from public.expo_invites i
   where i.expo_id = v_expo and i.artist_id = v_me;

  if v_status is null then
    insert into public.expo_invites (expo_id, artist_id, status)
    values (v_expo, v_me, 'requested');
    return 'requested';
  end if;

  if v_status = 'accepted' then
    return 'accepted';
  end if;

  if v_status = 'pending' then
    -- 主催者は既に招いている。リンクを踏んだのは本人なので、これは受諾。
    update public.expo_invites
       set status = 'accepted', responded_at = now()
     where expo_id = v_expo and artist_id = v_me;
    return 'accepted';
  end if;

  if v_status = 'declined' then
    update public.expo_invites
       set status = 'requested', created_at = now(), responded_at = null
     where expo_id = v_expo and artist_id = v_me;
    return 'requested';
  end if;

  return v_status; -- 'requested' のまま
end;
$$;

revoke all on function public.request_expo_invite(text) from public, anon;
grant execute on function public.request_expo_invite(text) to authenticated;

/* ================= 5. 自分で自分を承認できないようにする ================= */
-- 0047 の `expo_invites_artist_respond` は「自分の行を accepted/declined にできる」。
-- `requested`（自分が出した希望）にもそれが当たるので、**希望を出した本人が自分を
-- 承認できてしまう** ＝ 承認の意味が消える。ポリシーの `with check` からは OLD が
-- 見えないので、トリガで塞ぐ。
--
-- `security invoker` にするのが要点 ── definer にすると `current_user` が常に関数の
-- 所有者になり、クライアント経由かどうかの区別がつかず素通りする（0036 で実際にやった）。
-- 下の `approve_expo_request` は definer なので `current_user` が変わり、ここを通れる。
create or replace function public.guard_expo_invite_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.status = 'requested' and new.status = 'accepted' then
      raise exception 'a request must be approved by the organizer'
        using errcode = 'check_violation';
    end if;
    -- 希望を「招待」に見せかける経路も塞ぐ（作家側から pending は作れない）。
    if old.status is distinct from 'pending' and new.status = 'pending' then
      raise exception 'cannot move an invitation back to pending'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expo_invites_guard_approval on public.expo_invites;
create trigger expo_invites_guard_approval
  before update of status on public.expo_invites
  for each row execute function public.guard_expo_invite_approval();

/* ================= 6. 主催者が承認する ================= */
/**
 * 参加希望を承認する。**主催者に update ポリシーを与えない**まま実現するために関数に
 * している（0047 の「status は主催者が動かせない」を保ったまま、`requested` だけを
 * 例外にする ── その行は**作家自身が出した意思表示**なので、承認しても勝手に参加させた
 * ことにはならない）。
 *
 * 断るときは招待を消す（0047 の `expo_invites_owner_delete` がそのまま使える）。
 */
create or replace function public.approve_expo_request(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select x.owner_id, i.status into v_owner, v_status
    from public.expo_invites i
    join public.expos x on x.id = i.expo_id
   where i.id = p_invite;
  if v_owner is null then
    raise exception 'no such invitation';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'not your exhibition';
  end if;
  if v_status <> 'requested' then
    -- 承認できるのは希望だけ。招待（pending）を主催者が受諾するのは別の話で、
    -- それは作家の意思表示なので主催者にはできない（0047）。
    raise exception 'only a request can be approved';
  end if;

  update public.expo_invites
     set status = 'accepted', responded_at = now()
   where id = p_invite;
end;
$$;

revoke all on function public.approve_expo_request(uuid) from public, anon;
grant execute on function public.approve_expo_request(uuid) to authenticated;

/* ================= 7. 通知 ================= */
-- 0047 の3本のうち2本を差し替える。**`requested` の行は宛先が逆**（作家が起こしたので
-- 主催者へ）なので、insert の通知を状態で分岐させる。
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
  v_artist text;
begin
  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;

  if new.status = 'requested' then
    -- 作家が希望を出した → **主催者へ**。
    select coalesce(p.display_name, p.username) into v_artist
      from public.profiles p where p.id = new.artist_id;
    perform public.push_notification(
      v_owner, 'invite_request', null, null, coalesce(v_title, ''), '', v_artist
    );
    return new;
  end if;

  -- 主催者が招いた → **作家へ**（0047 のまま）。
  select coalesce(p.display_name, p.username) into v_organizer
    from public.profiles p where p.id = v_owner;
  perform public.push_notification(
    new.artist_id, 'invite', null, null, coalesce(v_title, ''), '', v_organizer
  );
  return new;
end;
$$;

-- 返事の通知。**承認（`requested` → `accepted`）は作家へ**、それ以外（受諾・辞退）は
-- 主催者へ。分けないと、主催者が自分で押した承認の通知が自分に届く。
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
  v_organizer text;
begin
  if new.status is not distinct from old.status then return new; end if;

  select x.title, x.owner_id into v_title, v_owner
    from public.expos x where x.id = new.expo_id;

  if old.status = 'requested' and new.status = 'accepted' then
    select coalesce(p.display_name, p.username) into v_organizer
      from public.profiles p where p.id = v_owner;
    perform public.push_notification(
      new.artist_id, 'invite_approved', null, null, coalesce(v_title, ''), '', v_organizer
    );
    return new;
  end if;

  if new.status not in ('accepted', 'declined') then return new; end if;

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
