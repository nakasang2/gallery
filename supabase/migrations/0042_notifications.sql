-- 通知（ユーザー指示 2026-08-09「通知は作ろう / 招待もそうですが、いいねやゲストブックの
-- 書き込み、あとは新テーマ追加のお知らせなどですかね」）
--
-- 直接のきっかけは 0041 の招待に**気づく経路が無かった**こと。主催者は「送った」と
-- 思っているのに、相手はダッシュボードを開くまで知らない。
--
-- 設計の要点:
--   ①**行はDBが書く**（トリガ、`security definer`）。クライアントに insert を許すと
--     「他人に偽の通知を送る」経路になる。RLS の insert ポリシーは**1つも作らない**。
--   ②**中身は書いた時点の値を焼き込む**（`title`）。部屋名を変えたり作品を消したりした
--     あとでも、通知は「そのとき何が起きたか」の記録として読めなければ意味が無い。
--   ③**いいねは作品ごと・1日1件にまとめる**（`count`）。匿名なので1件ずつだと同じ文面が
--     並ぶだけで、伸びた作品が通知欄を埋めて招待や芳名帳が埋もれる。
--   ④**自分の行動では通知しない**（自分の作品に自分でいいね、自分の芳名帳に自分で記帳）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 0. 0041 の事故の修理（先に流す） ================= */
-- **0041 を適用済みの環境は、未ログインの来場者から公開サイトが見えなくなっている。**
-- 0041 が足した2つのポリシー（`galleries_select_invited` /
-- `artworks_select_submitted_to_my_room`）が呼ぶ関数の execute を `authenticated`
-- だけに渡していたため、`anon` が `galleries` や `artworks` を読むだけで
-- `permission denied for function invited_to_room` で落ちる。
--
-- **RLS のポリシーは問い合わせたロールとして評価される**（OR で並んでいても評価は
-- スキップされない）ので、**そのテーブルに到達できる全ロールに execute が要る**。
-- 渡しても漏れない: どれも `auth.uid()` を見るので anon では常に false。
--
-- 0041 のファイル自体も直したので、これから新しい環境に流す人には二重に効く（冪等）。
-- 実測で見つけた: 0041 のテスト35項目が**全部 `authenticated` で走っていた**
-- （LESSONS 2026-08-09）。
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'invited_to_room') then
    execute 'grant execute on function public.invited_to_room(uuid) to anon, authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'artwork_submitted_to_my_room') then
    execute 'grant execute on function public.artwork_submitted_to_my_room(uuid) to anon, authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'owns_artwork') then
    execute 'grant execute on function public.owns_artwork(uuid) to anon, authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'may_submit_artwork') then
    execute 'grant execute on function public.may_submit_artwork(uuid, uuid) to anon, authenticated, service_role';
  end if;
end $$;

/* ================= 1. 表 ================= */
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- 受け取る人。宛先であって「起こした人」ではない。
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('invite', 'invite_reply', 'submission', 'like', 'guestbook', 'announce')),
  -- 文脈。source が消えても通知は残るので **null 許容**（`on delete set null`）。
  gallery_id uuid references public.galleries (id) on delete set null,
  artwork_id uuid references public.artworks (id) on delete set null,
  /** 書いた時点の見出し（部屋名・作品名・お知らせのタイトル）。source を消しても
   *  読めるように焼き込む。 */
  title text not null default '',
  /** 本文。芳名帳のメッセージ、お知らせの本文。 */
  body text not null default '',
  /** 起こした人の表示名。芳名帳の署名や招待した作家など**すでに本人が名乗っている
   *  場面だけ**。いいねは匿名なので常に null（likes 表に user_id が無い＝そもそも
   *  持っていない）。 */
  actor_name text,
  /** まとめた件数（いいね・提出）。1件ずつのものは 1。 */
  count int not null default 1 check (count > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ベルが引く向き: 自分の新しい順。未読数は同じ索引で数えられる。
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
-- いいね・提出のまとめ先を探す向き（未読の同じ作品／同じ作家を1日単位で拾う）。
create index if not exists notifications_rollup_idx
  on public.notifications (user_id, kind, artwork_id, gallery_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- 本人だけが読む。
drop policy if exists "notifications_own_read" on public.notifications;
create policy "notifications_own_read"
  on public.notifications for select using (user_id = (select auth.uid()));

-- 既読にする・消す。**insert のポリシーは作らない** — 行を書くのはトリガと
-- 管理者RPC（どちらも definer）だけ。クライアントに insert を許すと、他人の宛先で
-- 偽の通知を作れる（「Xibit360からのお知らせ」を騙れる）。
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update"
  on public.notifications for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "notifications_own_delete" on public.notifications;
create policy "notifications_own_delete"
  on public.notifications for delete using (user_id = (select auth.uid()));

/* ================= 2. 書き込みの共通部 ================= */
-- 1件足す。`security definer` なので RLS を通らない（＝insert ポリシー無しで書ける）。
create or replace function public.push_notification(
  p_user uuid,
  p_kind text,
  p_gallery uuid,
  p_artwork uuid,
  p_title text,
  p_body text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 宛先が居ない（プロフィールが消えた等）なら黙って何もしない。通知の失敗で
  -- **本来の操作（いいね・記帳・招待）を失敗させてはいけない**。
  if p_user is null then return; end if;
  insert into public.notifications (user_id, kind, gallery_id, artwork_id, title, body, actor_name)
  values (p_user, p_kind, p_gallery, p_artwork, coalesce(p_title, ''), coalesce(p_body, ''), p_actor);
end;
$$;

revoke all on function public.push_notification(uuid, text, uuid, uuid, text, text, text) from public, anon, authenticated;

-- まとめて足す（いいね・提出）。**未読で・同じ種類・同じ対象・同じ日**の行があれば
-- 数を足して今の時刻に持ち上げ、無ければ1件作る。既読の行には足さない（読んだあとの
-- 新しい動きは新しい通知として出るべき）。
-- まとめの鍵は (宛先, 種類, 部屋, 作品, **起こした人**, その日)。`actor` も鍵に入れる
-- のが要点: 提出を部屋だけでまとめると、同じ日に2人が出したときに1件に畳まれて
-- **誰が出したのか分からなくなる**（主催者にとっては、それが一番知りたい部分）。
create or replace function public.push_notification_rollup(
  p_user uuid,
  p_kind text,
  p_gallery uuid,
  p_artwork uuid,
  p_title text,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null then return; end if;

  select n.id into v_id
    from public.notifications n
   where n.user_id = p_user
     and n.kind = p_kind
     and n.read_at is null
     and n.artwork_id is not distinct from p_artwork
     and n.gallery_id is not distinct from p_gallery
     and n.actor_name is not distinct from p_actor
     and n.created_at >= date_trunc('day', now())
   order by n.created_at desc
   limit 1;

  if v_id is null then
    insert into public.notifications (user_id, kind, gallery_id, artwork_id, title, actor_name)
    values (p_user, p_kind, p_gallery, p_artwork, coalesce(p_title, ''), p_actor);
  else
    update public.notifications
       set count = count + 1, created_at = now()
     where id = v_id;
  end if;
end;
$$;

revoke all on function public.push_notification_rollup(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
-- 0042 の途中で引数を足したので、5引数版が残っていれば消す（同名の別シグネチャが
-- 並ぶと `perform` がどちらを呼ぶか曖昧になる）。
drop function if exists public.push_notification_rollup(uuid, text, uuid, uuid, text);

/* ================= 3. いいね ================= */
-- 宛先は**作品の所有者**（部屋の所有者ではない）。合同展示では他人の部屋に掛かって
-- いても「あなたの作品がいいねされた」のは作家本人の話。部屋の側の数字は
-- ダッシュボードのメーターが持っている。
create or replace function public.notify_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
begin
  select a.owner_id, a.title into v_owner, v_title
    from public.artworks a where a.id = new.artwork_id;

  -- 自分の作品に自分でいいねしたときは通知しない。likes は匿名（user_id が無い）ので
  -- 「押した人」は分からないが、**ログイン中の本人**なら auth.uid() で分かる。
  if v_owner is not null and v_owner is distinct from (select auth.uid()) then
    perform public.push_notification_rollup(v_owner, 'like', new.gallery_id, new.artwork_id, v_title);
  end if;
  return new;
end;
$$;

drop trigger if exists likes_notify on public.likes;
create trigger likes_notify
  after insert on public.likes
  for each row execute function public.notify_like();

/* ================= 4. 芳名帳 ================= */
-- 1件ずつ通知する（数が少なく、1件ごとに読む価値のある本文がある）。署名は来場者が
-- 自分で名乗った名前で、**公開ページに既に出ている**ので通知に載せてよい。
create or replace function public.notify_guestbook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
begin
  select g.owner_id, g.title into v_owner, v_title
    from public.galleries g where g.id = new.gallery_id;

  if v_owner is not null and v_owner is distinct from (select auth.uid()) then
    perform public.push_notification(
      v_owner, 'guestbook', new.gallery_id, null, v_title, new.message,
      nullif(new.name, '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists guestbook_notify on public.guestbook;
create trigger guestbook_notify
  after insert on public.guestbook
  for each row execute function public.notify_guestbook();

/* ================= 5. 招待（0037/0041） ================= */
-- 招かれた作家へ。**これが今回の発端** — 0041 まで、招待に気づく経路が無かった。
create or replace function public.notify_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room text;
  v_owner uuid;
  v_organizer text;
begin
  select g.title, g.owner_id into v_room, v_owner
    from public.galleries g where g.id = new.gallery_id;
  select coalesce(p.display_name, p.username) into v_organizer
    from public.profiles p where p.id = v_owner;

  perform public.push_notification(
    new.artist_id, 'invite', new.gallery_id, null, coalesce(v_room, ''), '', v_organizer
  );
  return new;
end;
$$;

drop trigger if exists room_invites_notify on public.room_invites;
create trigger room_invites_notify
  after insert on public.room_invites
  for each row execute function public.notify_invite();

-- 受諾・辞退を**主催者へ**返す。招いたまま返事を待つ側にも通知が要る（辞退は特に:
-- 気づかないと空いた枠を埋め直せない）。
create or replace function public.notify_invite_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room text;
  v_owner uuid;
  v_artist text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted', 'declined') then return new; end if;

  select g.title, g.owner_id into v_room, v_owner
    from public.galleries g where g.id = new.gallery_id;
  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = new.artist_id;

  -- 本文に状態を入れる（`accepted` / `declined`）。表示側が文言を選ぶための値で、
  -- 画面に出す英語ではない。
  perform public.push_notification(
    v_owner, 'invite_reply', new.gallery_id, null, coalesce(v_room, ''), new.status, v_artist
  );
  return new;
end;
$$;

drop trigger if exists room_invites_reply_notify on public.room_invites;
create trigger room_invites_reply_notify
  after update of status on public.room_invites
  for each row execute function public.notify_invite_reply();

/* ================= 6. 提出（0041） ================= */
-- 主催者へ。作家は複数点まとめて出すので**作家ごと・1日1件にまとめる**。
create or replace function public.notify_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_room text;
  v_artist_id uuid;
  v_artist text;
begin
  select g.owner_id, g.title into v_owner, v_room
    from public.galleries g where g.id = new.gallery_id;
  select a.owner_id into v_artist_id
    from public.artworks a where a.id = new.artwork_id;

  -- 部屋の所有者が自分の作品を出した（自分の部屋への提出）ときは通知しない。
  if v_owner is null or v_owner is not distinct from v_artist_id then return new; end if;

  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = v_artist_id;

  -- まとめの鍵は (部屋, 作家)。作家は `actor_name` で持つので、同じ日に2人が出しても
  -- 2件に分かれる（1件に畳むと誰が出したのか分からなくなる）。
  perform public.push_notification_rollup(
    v_owner, 'submission', new.gallery_id, null, coalesce(v_room, ''), v_artist
  );
  return new;
end;
$$;

drop trigger if exists room_submissions_notify on public.room_submissions;
create trigger room_submissions_notify
  after insert on public.room_submissions
  for each row execute function public.notify_submission();

/* ================= 7. お知らせ（管理者） ================= */
-- 新しいテーマの追加など。**全員に1行ずつ配る**（fan-out）。
--
-- 「お知らせ表 + profiles.announcements_seen_at」でも作れて行数は1件で済むが、
-- 未読の数え方が2系統に分かれる（配られた通知と、まだ読んでいないお知らせ）。
-- 利用者数がまだ小さいので、**1つの通知欄・1つの未読数**を保つ方を採る。
-- 効いてくるのは利用者が数万人になったときで、そのときは配るのをやめて
-- seen_at 方式に寄せる（この関数の中だけを書き換えれば済む）。
--
-- 文面は**書いた言語のまま全員に出る**。お知らせはUI文言ではなく「中身」なので、
-- 記事（/articles）と同じ扱い＝`check:i18n` の対象外。
create or replace function public.broadcast_announcement(p_title text, p_body text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'title required';
  end if;

  insert into public.notifications (user_id, kind, title, body)
  select p.id, 'announce', trim(p_title), coalesce(p_body, '')
    from public.profiles p;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.broadcast_announcement(text, text) from public, anon;
grant execute on function public.broadcast_announcement(text, text) to authenticated;

/* ================= 8. 既読 ================= */
-- 1件ずつ update するより、開いたときに**まとめて既読**にしたい。RLS の update
-- ポリシーで本人の行だけに絞れているので、これは利便のための関数。
create or replace function public.mark_notifications_read()
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where user_id = (select auth.uid()) and read_at is null;
$$;

grant execute on function public.mark_notifications_read() to authenticated;
