-- 0015: per-artwork purchase/shop link — an artist can point a specific work
-- at wherever they sell it (their own shop, Etsy, a DM link, etc.). Shown to
-- visitors on the artwork panel; optional, null means "not for sale here".

alter table public.artworks
  add column if not exists purchase_url text;
