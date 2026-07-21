-- 0027_gallery_bgm.sql
-- Gallery ambient BGM (STRATEGY P3-12 "空間BGM"): the owner uploads one audio track
-- that loops as spatial background music while visitors walk the room. The file lives
-- in the artworks storage bucket ({owner}/{gallery}/bgm); this column holds its public URL.
-- Nullable — a gallery with no track just keeps the generated room tone (silent BGM).
alter table public.galleries add column if not exists bgm_url text;
