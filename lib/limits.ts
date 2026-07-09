// Plan variables (REQUIREMENTS.md 10.10). Single reference point for every limit
// so a future paid plan only has to swap what this module returns.
// At release everyone is on the same (free-equivalent) plan.

export interface PlanLimits {
  /** How many hakoniwa (galleries) one user can own */
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
  worksPerGallery: 10,
  storageBytes: 300 * 1024 * 1024,
  videoBytes: 40 * 1024 * 1024,
}

/** Effective number of usable slots for a layout under the current plan */
export function effectiveSlotCount(layoutSlotCount: number): number {
  return Math.min(layoutSlotCount, PLAN.worksPerGallery)
}
