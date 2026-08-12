-- Per-work crop alignment. Exhibit.tsx crops the artwork image via texture UV
-- offset (object-fit: cover) when the chosen display size's aspect ratio
-- differs from the image's — until now that offset was hardcoded to center.
-- This column lets the artist choose which edge of the image stays visible
-- instead (ユーザー指示 2026-08-12). 'start'/'end' are axis-agnostic UV
-- positions (0 / the far offset); the editor UI decides whether that reads as
-- left/right or top/bottom depending on which axis is actually being cropped.
alter table public.artworks
  add column if not exists crop_align text not null default 'center'
  check (crop_align in ('start', 'center', 'end'));
