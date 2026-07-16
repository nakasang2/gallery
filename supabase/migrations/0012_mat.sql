-- 0012: mat (the paper border inside the frame) — presence + colour.
-- Same two-layer pattern as every other design axis: the gallery row holds the
-- default ('auto' = each frame's recommended mat), placements carry the optional
-- per-work override (NULL = inherit). Keys resolve against lib/presets.ts MATS
-- (auto / none / white / ivory / grey / black); unknown keys fall back to 'auto'
-- at render time, so no CHECK constraint is needed.

alter table public.galleries
  add column if not exists mat_default text not null default 'auto';

alter table public.placements
  add column if not exists mat_override text;
