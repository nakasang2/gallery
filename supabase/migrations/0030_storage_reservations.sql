-- 0030: 署名済みアップロードの「予約」台帳(容量制限の穴を塞ぐ)
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
--
-- 背景
--   容量制限(1人300MB)の判定は、これまで artworks.bytes の合計だった。この値は
--   ブラウザの言い値で、しかも作品ファイルは「行を作る前」にアップロードされる。
--   つまり行を作らなければ何MB上げても記録が残らず、毎回新しいidにすれば無制限に
--   書き込めた。音声ガイドとBGMに至っては、そもそもどこにも記録されていなかった。
--
-- 0030以降の考え方(docs/DECISIONS.md 2026-07-27「容量制限の実測化」)
--   使用量の正は **R2に実在するバイト数**。サーバーが署名のたびに {uid}/ 配下を
--   実測する。クライアントの申告値は一切使わないので、artworks.bytes を偽っても、
--   行を作らずに上げても、音声を上げても、すべて同じ1つの数字に反映される。
--
--   実測だけで足りないのは同時実行のとき。何本も同時に署名を要求されると全部が
--   「アップロード前」の同じ数字を見てしまう。そこで署名した分をこのテーブルへ
--   短時間(署名URLの有効期限と同じ10分)だけ積み、実測値＋予約分で判定する。
--   ファイルがR2に着けば実測値に含まれ、予約は期限切れで消える。
--
--   定期実行(cron)は要らない。期限切れの行は、次に誰かが署名を要求したついでに
--   まとめて消える。

create table if not exists public.storage_reservations (
  id bigint generated always as identity primary key,
  uid uuid not null references public.profiles (id) on delete cascade,
  -- R2のオブジェクトキー。用途とidから決まる固定パスなので、同じファイルを
  -- 上げ直しても行は増えない(unique で1本にまとまる)。
  key text not null,
  bytes bigint not null check (bytes > 0),
  expires_at timestamptz not null,
  unique (uid, key)
);

-- 期限切れの一括削除用。行の寿命が10分なのでテーブルは常に小さい。
create index if not exists storage_reservations_expiry_idx
  on public.storage_reservations (expires_at);

alter table public.storage_reservations enable row level security;
-- ポリシーを1つも作らない = anon/authenticated からは直接読み書きできない。
-- 出入口は下の security definer 関数だけ。

/* ================= 予約と容量判定 ================= */
--
-- 引数のうち p_listed_bytes(R2の実測合計)と p_limit_bytes はサーバー(APIルート)が
-- 決めて渡す。この関数自体は authenticated から直接呼べてしまうが、そこで嘘の
-- 実測値を渡しても得はしない:
--   - 通っても増えるのは「自分の予約」だけで、署名付きURLは1本も手に入らない
--     (URLを発行するのは app/api/upload-url/route.ts だけで、そちらは自分でR2を実測する)
--   - 既存の予約は greatest() で増える方向にしか更新できないので、
--     予約を消して枠を空けることはできない
-- つまり、細工してできるのは自分の枠を自分で狭めることだけ。
-- 返り値の型を変えるときは create or replace では置き換えられないので、先に落とす
drop function if exists public.reserve_storage(text[], bigint[], bigint, bigint, int);

create or replace function public.reserve_storage(
  p_keys text[],
  p_bytes bigint[],
  p_listed_bytes bigint,
  p_limit_bytes bigint,
  p_ttl_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(array_length(p_keys, 1), 0);
  v_new bigint;
  v_pending bigint;
  v_used bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  -- 1リクエストのファイル数はAPIルート側と揃えて最大4本
  if v_n = 0 or v_n > 4 or v_n is distinct from coalesce(array_length(p_bytes, 1), 0) then
    raise exception 'bad reservation batch';
  end if;
  if exists (select 1 from unnest(p_keys) as t(k) where k is null or k = '') then
    raise exception 'bad reservation key';
  end if;
  if exists (select 1 from unnest(p_bytes) as t(b) where b is null or b <= 0) then
    raise exception 'bad reservation size';
  end if;
  if p_listed_bytes is null or p_listed_bytes < 0
     or p_limit_bytes is null or p_limit_bytes <= 0
     or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'bad reservation arguments';
  end if;

  -- 期限切れの掃除。これが cron の代わり(署名要求のついでに片付く)。
  -- skip locked = 他のセッションが触っている行は飛ばす。全ユーザー分を無条件に
  -- 消すと、2人が同時に呼んだときお互いの行ロックを待ち合ってデッドロックし得る。
  -- 取りこぼしても下の集計が expires_at で弾くので、掃除は純粋な後片付けでよい。
  delete from public.storage_reservations
   where ctid in (
     select ctid from public.storage_reservations
      where expires_at < now()
      order by expires_at
      limit 1000
      for update skip locked
   );

  -- 同じユーザーの同時リクエストを直列化する。これが無いと2本が互いの予約が
  -- 入る前に残量を読み、どちらも通ってしまう(＝制限を一瞬だけ踏み越えられる)。
  -- トランザクション終了で自動的に外れる。
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- 今回と同じキーの予約は下の upsert で置き換わるので、二重に数えない。
  -- expires_at で絞るので、上の掃除が取りこぼした行があっても正しい。
  select coalesce(sum(bytes), 0) into v_pending
    from public.storage_reservations
   where uid = v_uid and expires_at > now() and not (key = any (p_keys));

  -- 同一キーが1バッチに複数入っていても1本として数える(下の upsert と揃える)
  select coalesce(sum(mb), 0) into v_new
    from (select max(b) as mb from unnest(p_keys, p_bytes) as t(k, b) group by k) d;

  v_used := p_listed_bytes + v_pending;
  if v_used + v_new > p_limit_bytes then
    -- 溢れるときは1行も入れない。失敗した試行が枠を食い続けないようにするため。
    return jsonb_build_object('ok', false, 'used', v_used);
  end if;

  -- greatest() で増える方向にしか更新しない。予約を小さく上書きして枠を空ける、
  -- という抜け道を残さないため(この関数は authenticated から直接も呼べる)。
  insert into public.storage_reservations as sr (uid, key, bytes, expires_at)
  select v_uid, k, max(b), now() + make_interval(secs => p_ttl_seconds)
    from unnest(p_keys, p_bytes) as t(k, b)
   group by k
  on conflict (uid, key) do update
    set bytes = greatest(sr.bytes, excluded.bytes),
        expires_at = greatest(sr.expires_at, excluded.expires_at);

  return jsonb_build_object('ok', true, 'used', v_used + v_new);
end;
$$;

revoke all on function public.reserve_storage(text[], bigint[], bigint, bigint, int) from public;
grant execute on function public.reserve_storage(text[], bigint[], bigint, bigint, int) to authenticated;

/* ================= 確認クエリ ================= */
-- 実行後、残っている予約(通常は0〜数件、10分で自然に消える):
--   select uid, key, bytes, expires_at from public.storage_reservations order by expires_at;
