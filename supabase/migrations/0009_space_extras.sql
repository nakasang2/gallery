-- 空間・見せ方の拡張: カスタムレイアウトのパラメータと OGP 代表作の手動指定
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.galleries
  -- layout = 'custom' のときの部屋パラメータ(hw/hd/island)。プリセット時は空
  add column if not exists layout_params jsonb not null default '{}'::jsonb,
  -- OGPカード・作家ページのカバーに使う作品(未指定なら slot 0)
  add column if not exists cover_artwork_id uuid references public.artworks (id) on delete set null;
