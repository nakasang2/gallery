-- 動画作品対応: artworks に種別カラムを追加
-- 適用方法: 0001 と同様に SQL Editor に貼り付けて Run(再実行安全)
-- (プロジェクト: https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/sql/new)

alter table public.artworks
  add column if not exists kind text not null default 'image'
  check (kind in ('image', 'video'));
