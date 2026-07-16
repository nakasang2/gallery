-- 0011: per-work hanging & caption overrides.
-- Frames already override per work (placements.frame_override); hanging and
-- caption now follow the same pattern — the gallery row keeps the defaults
-- (theme-recommended), placements carry the optional per-work override.
-- NULL = inherit the gallery default. No RLS changes: the existing placement
-- policies (owner writes, public reads via the gallery) already cover them.

alter table public.placements
  add column if not exists hanging_override text,
  add column if not exists caption_override text;
