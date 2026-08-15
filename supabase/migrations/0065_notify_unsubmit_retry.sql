-- 0057 の関数とトリガだけを、あとから当てられる形で置き直す（2026-08-15）
--
-- なぜ必要か（本番で実際に起きたこと）: `0057_notify_unsubmit.sql` を本番へ貼ったら
--   ERROR: 23514: check constraint "notifications_kind_check" of relation
--   "notifications" is violated by some row
-- で弾かれた。**migration の中身は正しく、順序だけが問題**だった:
--
--   0048 … 'submission', 'like'                            （適用済み）
--   0057 … 'submission', 'unsubmit', 'like'                 ← **貼っていなかった**
--   0062 … 'submission', 'unsubmit', 'room_ready', 'like'   （適用済み）
--
-- 0062 の一覧は 0057 の**上位互換**なので、0062 を先に当てた本番に 0057 を当てると
-- **既に許可されている `room_ready` を取り上げる後退**になる。しかも 0062 の
-- 「準備できた」トグルで `room_ready` の通知行が実際に生まれていたため、制約の
-- 追加そのものが弾かれた ＝ **0057 は本番に対してもう二度と当たらない**。
--
-- **0057 の書き方は、流し方によっては表を無防備なまま残す。** 0057 は
-- `drop constraint if exists` と `add constraint` を**別々の文**で書いている。
-- `psql -f`（文ごとに自動コミット）で流すと **drop だけがコミットされ add が巻き戻り、
-- 制約が1つも無い表が残る** ── ローカルで再現し、そのあと `kind = 'でたらめ'` の行が
-- 普通に insert できることまで実測した。
--
-- **【重要な訂正 2026-08-15】本番はこの状態になっていなかった。** Supabase の SQL Editor は
-- 貼り付けたスクリプトを**1つのトランザクション**で実行するため、0057 の失敗は drop ごと
-- 巻き戻っており、制約は無傷のまま残っていた（本番で実測して確認）。Claude は最初
-- 「本番も制約が消えているはず」と報告したが、**再現に使った `psql -f` と本番の SQL Editor で
-- トランザクションの単位が違う**ことを確かめずに断定した誤りだった（docs/LESSONS 2026-08-15）。
-- それでも `psql`・CI・他のクライアントから流す経路は残るので、下の書き方は守る。
--
-- したがって 0065 は2つやる:
--   ①制約を**10種すべて**（アプリの `NotificationKind` と一致）で置き直す。これは
--     0048・0057・0062 のどの一覧の上位集合でもあるので、**どの順序で当てても後退しない**。
--   ②0057 の関数とトリガを置く。
--
-- 番号順に流す経路（schema.sql・新しい環境）では 0057 → 0062 → 0065 の順に走り、
-- 0065 は同じ制約と同じ関数を置き直すだけなので結果は変わらない（冪等）。
--
-- **この形の再発を防ぐ書き方**: `check (... in (...))` を丸ごと書き換える migration は、
-- 順序を守れなかった瞬間に「後から当てられないファイル」になり、しかも**失敗したときに
-- 守りを外して去る**。列挙を広げる変更は、①その migration より後で誰かが広げていても
-- 壊さない一覧にする ②drop と add を1つのトランザクションに入れる、のどちらかを守る
-- （docs/LESSONS「検証・ツール」2026-08-15）。
--
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。0062 を先に適用しておくこと。

/* ================= 0. 種別の制約を建て直す ================= */
-- **10種はアプリの `lib/notifications.ts` の `NotificationKind` と一致している**
-- （2026-08-15 に突き合わせて確認）。drop と add を **1つのトランザクション**に入れて
-- あるので、万一 add が弾かれても drop は巻き戻る ＝ **どの流し方でも無防備にならない**。
-- 0057 はこれをしていないので、自動コミットのクライアントから流すと守りを外して去る。
begin;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'unsubmit', 'room_ready', 'like', 'guestbook', 'announce'));
commit;

/* ================= 取り下げを主催者に知らせる（0057 の再掲） ================= */
-- 提出には通知があるのに（0047 の `expo_submissions_notify` は `after insert`）、
-- **取り下げには何も無かった**。0047 のトリガは掛かっている作品を壁から下ろすだけ
-- なので、**場所代を払って開催中の展示から作品が1点消えても、主催者はダッシュボードを
-- 開くまで気づけない**。払った側にだけ黙って損が出る形。
--
-- 通知する条件は「**支払い済みで、まだ会期が終わっていない**」に絞る:
--   ・下書き中は主催者が組み立てている最中で、作家も選び直す ＝ 純粋な雑音になる。
--   ・会期が終わったあとの取り下げは、もう誰にも見えていないので知らせる意味が薄い。
--   ・`starts_at` はクライアントから触れない（`guard_expo_run`）ので、この条件は
--     「決済を通った展示」と同義。
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
