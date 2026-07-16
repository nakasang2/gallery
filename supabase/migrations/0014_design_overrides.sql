-- 0014: Design Tools overrides (REQUIREMENTS.md §11.5/§11.8) — the buy-once
-- "design tools" capability: wall/floor colour, light colour/intensity, and a
-- small logo composited onto the title wall, layered on top of the chosen
-- theme. Stored as one jsonb blob (same two-layer pattern as mat/work_cap):
-- '{}' means "no overrides, render the theme as-is".

alter table public.galleries
  add column if not exists design_overrides jsonb not null default '{}'::jsonb;
