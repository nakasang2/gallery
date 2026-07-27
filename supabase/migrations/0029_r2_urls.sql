-- 0029: point stored file URLs at Cloudflare R2 (docs/DECISIONS.md 2026-07-27).
--
-- Most files need no change here: `artworks.storage_path` holds a RELATIVE key
-- ({uid}/{artworkId}) and the app builds the absolute URL at read time, so those
-- followed the base-URL switch automatically. The columns below are the ones that
-- were saved as ABSOLUTE Supabase Storage URLs and have to be rewritten once.
--
-- 適用方法: SQL Editor に貼り付けて Run。**先にファイルの移送を終えてから**実行する
-- (移送前に実行すると、まだ存在しないR2のURLを指す時間ができる)。再実行は安全
-- (すでに書き換わった行はパターンに一致しないので何も起きない)。
--
-- 配信ドメインが cdn.xibit360.art 以外なら、下の 'https://cdn.xibit360.art/' を
-- すべて置き換えてから実行する。

-- The old public prefix, matched loosely so any project ref works:
--   https://<ref>.supabase.co/storage/v1/object/public/artworks/<key>
-- Cache-busting suffixes (?v=…) are preserved.

-- Profile avatars (0001)
update public.profiles
set avatar_url = regexp_replace(
  avatar_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where avatar_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

-- Per-work audio guides (0021)
update public.artworks
set audio_url = regexp_replace(
  audio_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where audio_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

-- Gallery BGM (0027) and the Design Tools logo inside design_overrides (0014).
--
-- galleries has a BEFORE UPDATE trigger that bumps updated_at (0005), and the
-- public feed orders by updated_at (lib/publish.ts). Rewriting a URL is not an
-- edit by the artist, so suspend the trigger for these two statements — every
-- gallery with a BGM or logo would otherwise jump to the top of /explore.
alter table public.galleries disable trigger galleries_touch;

update public.galleries
set bgm_url = regexp_replace(
  bgm_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where bgm_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

update public.galleries
set design_overrides = regexp_replace(
  design_overrides::text,
  'https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/',
  'g'
)::jsonb
where design_overrides::text like '%.supabase.co/storage/v1/object/public/artworks/%';

alter table public.galleries enable trigger galleries_touch;

-- Article cover images (0020)
update public.articles
set cover_url = regexp_replace(
  cover_url,
  '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/'
)
where cover_url like 'https://%.supabase.co/storage/v1/object/public/artworks/%';

-- Landing-page hero images, stored inside site_config.value jsonb (0018).
-- Rewritten as text and cast back ('g' = every occurrence), so any key holding
-- such a URL is covered no matter how many there are.
update public.site_config
set value = regexp_replace(
  value::text,
  'https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/artworks/',
  'https://cdn.xibit360.art/',
  'g'
)::jsonb,
  updated_at = now()
where value::text like '%.supabase.co/storage/v1/object/public/artworks/%';

-- Verification: every query below should return 0 rows after this runs.
--   select id, avatar_url from public.profiles where avatar_url like '%supabase.co/storage%';
--   select id, audio_url  from public.artworks where audio_url  like '%supabase.co/storage%';
--   select id, bgm_url    from public.galleries where bgm_url    like '%supabase.co/storage%';
--   select id, cover_url  from public.articles  where cover_url  like '%supabase.co/storage%';
--   select id from public.galleries  where design_overrides::text like '%supabase.co/storage%';
--   select key from public.site_config where value::text like '%supabase.co/storage%';
