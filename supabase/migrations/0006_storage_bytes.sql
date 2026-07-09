-- ストレージ容量の管理(プラン上限 300MB/ユーザー の実測用)
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

-- 作品ごとの保存バイト数(display + thumb + video の合計)。
-- 既存行は 0 のまま(過去の作品は容量計算に含めないベストエフォート)
alter table public.artworks
  add column if not exists bytes bigint not null default 0;
