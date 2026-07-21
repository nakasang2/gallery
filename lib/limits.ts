// Plan variables (REQUIREMENTS.md 10.10). Single reference point for every limit
// so a future paid plan only has to swap what this module returns.
// At release everyone is on the same (free-equivalent) plan.

export interface PlanLimits {
  /** How many galleries one user can own */
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

/** Effective number of usable slots for a layout. `cap` is the OWNING gallery's own
 *  work_cap (REQUIREMENTS.md §11.5/§11.7 — capacity is fixed per room at purchase
 *  time, not one account-wide constant); omit it where no gallery row is in scope
 *  (template previews, a signed-out guest's local scene) to fall back to the plan default. */
export function effectiveSlotCount(layoutSlotCount: number, cap: number = PLAN.worksPerGallery): number {
  return Math.min(layoutSlotCount, cap)
}
