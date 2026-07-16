-- 配置の並び順とプロフィール編集のための追加
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

-- 作品の表示順(エディタでの並び替えを永続化する)
alter table public.artworks
  add column if not exists sort_order double precision not null default 0;

create index if not exists artworks_owner_order_idx
  on public.artworks (owner_id, sort_order, created_at);
