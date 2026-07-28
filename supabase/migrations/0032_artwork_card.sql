-- A mid-size derivative for browse surfaces (Explore cards, artist-page covers).
--
-- Why: those cards render around 330x210 CSS px, but they were being handed
-- `display.jpg` — up to 1600px on the long edge (measured: 141 KB for one card
-- on a real gallery). The 400px `thumb.jpg` we already generate is too small to
-- cover a card on a 2x screen without going soft, so neither existing size fits.
-- 800px does, at roughly a quarter of the bytes.
--
-- This column exists because the file cannot be assumed: every artwork uploaded
-- before this change has no card.jpg, and pointing an <img> at a 404 would break
-- the very surface we are trying to speed up. `false` simply means "fall back to
-- display.jpg", which is exactly today's behaviour — so old rows keep working
-- untouched and no backfill is required.
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.artworks
  add column if not exists has_card boolean not null default false;

comment on column public.artworks.has_card is
  'True when {storage_path}/card.jpg (long edge 800) exists. False = use display.jpg.';
