-- 汎用のレート制限カウンタ（リリース前監査 #11・#31・2026-08-21）
--
-- なぜ要るか: `/report`（匿名・無制限でinsertできた。0072で塞ぐ）と
-- `/api/upload-url`（同一アカウントからの連打に制限が無かった）の両方が
-- 「同じ形の穴」を持っていた。外部サービス（Redis等）を新たに契約せず、
-- 既存の `reserve_storage`（0030）と同じ「Postgresの関数+テーブルで数える」
-- 作法に揃える（ユーザー決定 2026-08-21）。
--
-- 固定窓（fixed window）方式: `bucket`（用途）+`key`（IP/uidなど）+
-- `window_start`（p_window_secondsごとに区切った開始時刻）ごとに件数を数える。
-- スライディングウィンドウほど厳密ではないが、境界をまたぐ2倍越えを許しても
-- 「無制限」よりは十分に強く、実装・検査コストが低い。
--
-- 直接この表を読み書きできるのは誰もいない（RLSを有効にしてポリシーを1つも
-- 作らない＝既定拒否）。唯一の入口は下の `check_rate_limit()`
-- （security definer）で、呼べるのは authenticated と service_role だけに絞る
-- ── anon（未サインインの通報フォーム）は `/api/report` が service_role で
-- 代行して呼ぶので、anon自身に実行権限を与える必要はない。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create table if not exists public.rate_limit_counters (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, key, window_start)
);

alter table public.rate_limit_counters enable row level security;

create or replace function public.check_rate_limit(
  p_bucket text,
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (bucket, key, window_start, count)
  values (p_bucket, p_key, v_window, 1)
  on conflict (bucket, key, window_start)
    do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;

  -- 手入れ不要にする日和見的な掃除。呼ばれるたびに少しずつ古い窓を消すので、
  -- 専用のcronジョブが無くても表が際限なく育たない。
  delete from public.rate_limit_counters where window_start < now() - interval '1 day';

  return v_count <= p_max;
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, text, integer, integer) to authenticated, service_role;
