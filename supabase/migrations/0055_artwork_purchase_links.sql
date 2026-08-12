-- Multiple purchase links per work (a wallpaper, an NFT, a print shop…) instead
-- of exactly one URL (ユーザー指示 2026-08-12). Free-form label + URL pairs, so
-- the artist decides what each link is rather than Xibit360 predefining a fixed
-- set of link kinds. Superseding purchase_url (0015) outright rather than
-- keeping both — the two hold the same fact, and leaving both around would
-- give every reader two sources of truth to reconcile.
alter table public.artworks
  add column if not exists purchase_links jsonb not null default '[]'::jsonb;

-- Backfill: a single existing purchase_url becomes one link with an empty label
-- (the editor and the artwork panel both treat an empty label on a lone link as
-- "no label to show" — same look as before this migration). Guarded by
-- purchase_links still being empty so re-running this migration after an artist
-- has already added links doesn't clobber their edits.
update public.artworks
set purchase_links = jsonb_build_array(jsonb_build_object('label', '', 'url', purchase_url))
where purchase_url is not null and purchase_url <> '' and purchase_links = '[]'::jsonb;

alter table public.artworks drop column if exists purchase_url;
