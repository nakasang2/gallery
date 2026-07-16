// Ambient past-visitor presence (§11.19). Pure mapping kept separate so it can be
// unit-tested and shared without pulling in three.js / the store.

/** Hard ceiling on simultaneous silhouettes — a busy room should feel alive, not
 *  crowded/annoying (per the design call). */
export const MAX_GHOSTS = 4

/** How many ambient silhouettes to show for a room's cumulative visit count.
 *  Log-scaled and capped: a brand-new room (a couple of views) stays honestly quiet,
 *  popularity ramps the crowd up, and it never exceeds MAX_GHOSTS.
 *    <3 → 0,  3–15 → 1–2,  ~64 → 3,  ~256+ → 4 (capped). */
export function ghostCountForVisits(visits: number, max = MAX_GHOSTS): number {
  if (!Number.isFinite(visits) || visits < 3) return 0
  return Math.max(0, Math.min(max, Math.floor(Math.log(visits + 1) / Math.log(4))))
}
