// Plan variables (REQUIREMENTS.md 10.10). Single reference point for every limit
// so a future paid plan only has to swap what this module returns.
// At release everyone is on the same (free-equivalent) plan.

export interface PlanLimits {
  /** How many galleries one user gets for FREE. Rooms past this one are bought
   *  (one `purchases` row of kind 'room' each) — see `roomAllowance()`. */
  galleries: number
  /** Works placed per gallery — effective slots = min(layout slots, this) */
  worksPerGallery: number
  /** Total storage per user (images + videos + posters) */
  storageBytes: number
  /** Single video file cap */
  videoBytes: number
}

export const PLAN: PlanLimits = {
  galleries: 1,
  worksPerGallery: 5,
  storageBytes: 300 * 1024 * 1024,
  videoBytes: 40 * 1024 * 1024,
}

/** Cap on a gallery BGM track. A looping ambient track.
 *  Lives here (not in cloud.ts) so the upload-url route can enforce it
 *  server-side without importing browser-only code. */
export const GALLERY_BGM_MAX_BYTES = 15 * 1024 * 1024

/** Cap on any single still image we accept (avatar, logo, LP hero, artwork
 *  display/thumb). Everything is re-encoded to JPEG in the browser first, so a
 *  legitimate upload lands far under this — it only bounds a hostile caller. */
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024

/** Physical ceiling on works per room. Every layout offers exactly this many
 *  slots (docs/DECISIONS 2026-07-24), so capacity is layout-independent: the
 *  free tier shows `worksPerGallery`, and slots are bought (by quantity) up to
 *  this max. The checkout clamps purchases so work_cap never exceeds it. */
export const MAX_WORKS_PER_ROOM = 15

/** Effective number of usable slots for a layout. `cap` is the OWNING gallery's own
 *  work_cap (REQUIREMENTS.md §11.5/§11.7 — capacity is fixed per room at purchase
 *  time, not one account-wide constant); omit it where no gallery row is in scope
 *  (template previews, a signed-out guest's local scene) to fall back to the plan default. */
export function effectiveSlotCount(layoutSlotCount: number, cap: number = PLAN.worksPerGallery): number {
  return Math.min(layoutSlotCount, cap)
}

/**
 * How many rooms this user may own: the free one plus one per room purchased
 * (ユーザー決定 2026-08-09 — $25 per extra room, 15 slots included).
 *
 * The allowance is a COUNT, not a list of room ids, so the owner creates the room
 * themselves after buying — picking its own title, theme and layout the same way
 * the first room is picked. Two consequences worth keeping:
 *   - deleting a purchased room does not burn the purchase (the allowance is still
 *     there, so they can build a different room in its place)
 *   - the webhook only ever writes a ledger row; it never creates a gallery, so a
 *     charge can never land a half-built room in the account
 */
export function roomAllowance(roomsPurchased: number): number {
  return PLAN.galleries + Math.max(0, roomsPurchased)
}

/** How many rooms of each GRADE an account holds. A room is one of exactly two
 *  things, recorded on the row itself (`galleries.slots_included`, migration 0038):
 *   - free   — the plan's one free room. Starts at `PLAN.worksPerGallery` and grows one
 *              $3 slot at a time, so its `work_cap` can legitimately reach the max.
 *   - paid   — created against a room purchase, so its full capacity came included.
 *  The grade is what makes the two distinguishable AFTER the fact; `work_cap` alone
 *  cannot tell a bought room from a free room somebody grew with slot purchases. */
export interface RoomTally {
  free: number
  paid: number
}

export function tallyRooms(rooms: { slots_included?: boolean | null }[]): RoomTally {
  let paid = 0
  for (const r of rooms) if (r.slots_included) paid++
  return { free: rooms.length - paid, paid }
}

/** Grants the account holds but has not built a room against yet. What the dashboard
 *  counts when it says "you have N rooms waiting to be built". */
export function unbuiltRooms(tally: RoomTally, roomsPurchased: number): number {
  const freeLeft = Math.max(0, PLAN.galleries - tally.free)
  const paidLeft = Math.max(0, Math.max(0, roomsPurchased) - tally.paid)
  return freeLeft + paidLeft
}

/**
 * What the next room this account creates is allowed to be, or null when it may not
 * create one at all.
 *
 * Grade accounting rather than position. The rule used to be "the first room you create
 * is the free one, every later room includes its slots", which was laundering-prone:
 * buy a room, DELETE the original free room, build a replacement, and the replacement
 * looked like a "later room" and came with fifteen slots — five free slots turned into
 * fifteen for nothing (ユーザー指示 2026-08-09 to close it).
 *
 * Counting grades closes it exactly, with no false positives: a paid room is only
 * granted while FEWER paid rooms exist than rooms bought, and the free room is only
 * granted while the account has no free room. Deleting a purchased room still does not
 * burn the purchase (the paid grant is unused again), and a free room grown to fifteen
 * by buying slots is still a free room, so a buyer can never be charged $25 and handed
 * a five-slot room.
 *
 * Paid first, so somebody who has just paid gets the room they paid for now rather than
 * after building a free one. The totals are the same either way.
 *
 * Advisory only — the DB enforces the same rule in `enforce_room_allowance` (0038),
 * because `galleries` is inserted into directly through RLS.
 */
export function gradeForNewRoom(
  tally: RoomTally,
  roomsPurchased: number
): { slotsIncluded: boolean; cap: number } | null {
  if (tally.paid < Math.max(0, roomsPurchased)) {
    return { slotsIncluded: true, cap: MAX_WORKS_PER_ROOM }
  }
  if (tally.free < PLAN.galleries) {
    return { slotsIncluded: false, cap: PLAN.worksPerGallery }
  }
  return null
}
