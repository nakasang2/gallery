-- 会期中に作品を引っ込められたら主催者に知らせる（ユーザー指示 2026-08-12）
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）
--
-- なぜ必要か: 提出には通知があるのに（0047 の `expo_submissions_notify` は
-- `after insert`）、**取り下げには何も無かった**。0047 のトリガは掛かっている作品を
-- 壁から下ろすだけなので、**場所代を払って開催中の展示から作品が1点消えても、
-- 主催者はダッシュボードを開くまで気づけない**。払った側にだけ黙って損が出る形。
--
-- 通知する条件は「**支払い済みで、まだ会期が終わっていない**」に絞る:
--   ・下書き中は主催者が組み立てている最中で、作家も選び直す。`setMySubmissions` は
--     差分を書くので選び直すたびに delete が出る ＝ 通知すると純粋な雑音になる。
--   ・会期が終わったあとの取り下げは、もう誰にも見えていないので知らせる意味が薄い。
--   ・`starts_at` はクライアントから触れない（`guard_expo_run`）ので、この条件は
--     「決済を通った展示」と同義。
--
-- **展示ごと削除したときに大量に飛ぶのを防ぐ**: `expo_submissions.expo_id` は
-- `on delete cascade` なので、展示を消すと子行の delete が1行ずつ走る。その時点で
-- 親の `expos` 行はもう見えないので `v_owner is null` で抜ける（insert 版と同じ作法）。
--
-- **作品ごと削除したときは通知する**: `artwork_id` も cascade だが、これは
-- 「会期中の展示から作品が消えた」そのものなので、知らせるのが正しい。ただし
-- `artworks` の行が消えているため作家名は引けない ＝ actor は空で出す。

/* ================= 1. 種別を1つ増やす ================= */
-- 提出（`submission`）と逆向きの出来事なので、同じ種別に畳まない。畳むと
-- 「出した」と「引っ込めた」がまとめ機能で1件に混ざって意味が反転する。
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'unsubmit', 'like', 'guestbook', 'announce'));

/* ================= 2. 取り下げを主催者に知らせる ================= */
create or replace function public.notify_expo_unsubmit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_artist_id uuid;
  v_artist text;
begin
  select x.owner_id, x.title, x.starts_at, x.ends_at
    into v_owner, v_title, v_starts, v_ends
    from public.expos x where x.id = old.expo_id;

  -- 展示ごと消えた（cascade）— 親が見えないので通知先が無い
  if v_owner is null then return old; end if;
  -- 支払い前（下書き）、または会期が終わっている
  if v_starts is null or v_ends is null or now() >= v_ends then return old; end if;

  -- 主催者が自分の作品を引っ込めたときは通知しない（insert 版と同じ）。
  -- 作品ごと消えた場合は owner_id が引けないので null になり、この条件は通らない
  -- ＝ 通知する（会期中の展示から作品が消えたことは知らせる必要がある）。
  select a.owner_id into v_artist_id from public.artworks a where a.id = old.artwork_id;
  if v_artist_id is not null and v_owner is not distinct from v_artist_id then return old; end if;

  select coalesce(p.display_name, p.username) into v_artist
    from public.profiles p where p.id = v_artist_id;

  -- まとめの鍵は insert 版と同じ (kind, actor, 未読, 同日)。1人が3点引っ込めたら
  -- 1件に畳まれて件数が増える ── 誰が何点引っ込めたかが1行で読める。
  perform public.push_notification_rollup(
    v_owner, 'unsubmit', null, null, coalesce(v_title, ''), v_artist
  );
  return old;
end;
$$;

revoke all on function public.notify_expo_unsubmit() from public, anon, authenticated;

drop trigger if exists expo_submissions_unsubmit_notify on public.expo_submissions;
create trigger expo_submissions_unsubmit_notify
  after delete on public.expo_submissions
  for each row execute function public.notify_expo_unsubmit();
