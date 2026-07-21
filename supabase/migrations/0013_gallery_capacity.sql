-- 0013: per-gallery work capacity (REQUIREMENTS.md §11.5/§11.7 — "room capacity" axis).
-- Capacity now travels with the room itself instead of being one global constant:
-- each gallery gets its own work_cap, fixed to the plan's value at creation time
-- ("buy a room" = a fresh row with that purchase's cap already baked in).
--
-- Existing rows default to 10 (today's global PLAN.worksPerGallery) so no current
-- gallery is retroactively shrunk — only *new* galleries created after this ships
-- get the smaller free-tier cap (5), written explicitly by lib/galleries.ts.

alter table public.galleries
  add column if not exists work_cap integer not null default 10;
