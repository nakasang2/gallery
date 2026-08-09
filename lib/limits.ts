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

/**
 * The work-slot cap a newly created room starts at.
 *
 * The free first room starts at the plan's `worksPerGallery` (5) and grows one
 * $3 slot at a time. Every room after it can only exist because a room was
 * bought, and that price already includes the room's full physical capacity, so
 * it starts at `MAX_WORKS_PER_ROOM` — which also means the per-slot add-on never
 * applies to it (`work_cap` is already at the ceiling).
 *
 * KNOWN GAP (accepted, not overlooked). "Which room is the free one" is positional
 * — the first one created — and nothing on the row records that it was the free
 * grant. So an owner who buys a room, then DELETES their original free room, then
 * builds a replacement gets `MAX_WORKS_PER_ROOM` for it: five free slots laundered
 * into fifteen, once, worth the ten slots they skipped.
 *
 * Left open deliberately, because every fix that uses only what we already store is
 * worse. Inferring the grade from the existing rows' caps ("grant 15 only while
 * fewer rooms are at max than rooms bought") misfires on the honest case that
 * matters more: a free room legitimately grown to 15 by buying slots looks
 * identical, and a buyer would be charged $25 and handed a 5-slot room. The ledger
 * cannot separate them either — `record_capacity_purchase` keys its row on the
 * Checkout session, not the gallery, so slot purchases are not attributable to a
 * room after the fact.
 *
 * Closing it properly means recording provenance on the row (a `slots_included`
 * flag written at creation) — a schema change worth making when rooms are actually
 * being bought and deleted, not on speculation.
 */
export function capForNewRoom(existingRooms: number): number {
  return existingRooms === 0 ? PLAN.worksPerGallery : MAX_WORKS_PER_ROOM
}
