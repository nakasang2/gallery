// Pure slot-placement logic (§11.13 — manual placement). Kept free of any store /
// React imports so both the client hooks (lib/exhibition) and the publish/rebuild
// path (lib/galleries) can share it without an import cycle.
import type { ArtworkData } from './artworks'

/** Resolve which work occupies each physical slot.
 *  Returns an array of length `slotCount`; entry i is the work at slot i, or null when
 *  the slot is empty.
 *  - Works named in `arrangement` go to their slot (first valid occurrence wins).
 *  - Works the arrangement never mentions (new uploads — or every work when the
 *    arrangement is empty) auto-fill the remaining empty slots in order: own works
 *    first, then `extra` (the guest demo collection).
 *  With an empty arrangement this is exactly "hang the works in slots 0,1,2,…",
 *  i.e. the pre-§11.13 behaviour, so existing rooms are unaffected. */
export function placeWorks(
  slotCount: number,
  arrangement: (string | null)[],
  own: ArtworkData[],
  extra: ArtworkData[] = []
): (ArtworkData | null)[] {
  const n = Math.max(0, Math.floor(slotCount))
  const slots: (ArtworkData | null)[] = new Array(n).fill(null)
  const byId = new Map(own.map((a) => [a.id, a]))
  const placedIds = new Set<string>()
  // 1. Honour explicit placements (skip ids that no longer exist, and duplicates)
  for (let i = 0; i < n && i < arrangement.length; i++) {
    const id = arrangement[i]
    if (id && byId.has(id) && !placedIds.has(id)) {
      slots[i] = byId.get(id)!
      placedIds.add(id)
    }
  }
  // 2. Auto-fill the gaps with works the arrangement never names — own first, then demo.
  //    A gap the arrangement DID leave (null within its range) is intentional and only
  //    gets filled if there's still an unplaced work looking for a home.
  const named = new Set(arrangement.filter((x): x is string => !!x))
  const queue = [...own.filter((a) => !named.has(a.id)), ...extra]
  let q = 0
  for (let i = 0; i < n && q < queue.length; i++) {
    if (!slots[i]) slots[i] = queue[q++]
  }
  return slots
}

export interface Placement {
  /** Works in slot order (also the prev/next navigation order) */
  list: ArtworkData[]
  /** Parallel to `list`: the physical slot index each work hangs on */
  slots: number[]
  /** Works that didn't fit (more works than usable slots) */
  overflow: number
}

/** Collapse a per-slot array (from placeWorks) into the parallel list/slots arrays
 *  the renderer and navigation consume, dropping the empty slots. */
export function toPlacement(perSlot: (ArtworkData | null)[], totalWorks: number): Placement {
  const list: ArtworkData[] = []
  const slots: number[] = []
  for (let i = 0; i < perSlot.length; i++) {
    const a = perSlot[i]
    if (a) {
      list.push(a)
      slots.push(i)
    }
  }
  return { list, slots, overflow: Math.max(0, totalWorks - list.length) }
}
