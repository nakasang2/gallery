-- 0023: manual slot placement (REQUIREMENTS.md §11.13).
-- Which work hangs on which wall slot travels with the room as a jsonb array:
--   arrangement[slotIndex] = artworkId | null   (null / a gap = an intentionally-empty slot)
-- Empty/absent (the default for every existing room) means "no manual arrangement" — works
-- auto-fill slots from 0, i.e. exactly the pre-0023 behaviour, so nothing is retroactively
-- rearranged. The authored order is mirrored into placements.slot_index on publish, so the
-- public page hangs works (and keeps the same empty spots) the owner arranged.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.galleries
  add column if not exists arrangement jsonb;
