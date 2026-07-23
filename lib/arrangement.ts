// Pure slot-placement logic (§11.13 — manual placement). Kept free of any store /
// React imports so both the client hooks (lib/exhibition) and the publish/rebuild
// path (lib/galleries) can share it without an import cycle.
import type { ArtworkData } from './artworks'
import type { LayoutDef } from './presets'

/** Auto-fill order that spreads works evenly across the walls.
 *  Slots are grouped by wall (rotY), each wall is ordered centre-out, and the
 *  walls are then interleaved round-robin — so 5 works in the hall land as
 *  2 north + 2 south + 1 east (centred pairs) instead of 4 crammed on one wall.
 *  Physical slot indices are untouched, so manual arrangements (§11.13) and
 *  published placements stay valid. */
export function balancedFillOrder(layout: LayoutDef): number[] {
  const groups = new Map<number, number[]>()
  layout.slots.forEach((slot, i) => {
    const key = Math.round(slot.rotY * 1000)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(i)
  })
  // centre-out within each wall: [2,1,3,0,4] for 5 slots, [1,2,0,3] for 4
  const walls = [...groups.values()].map((idxs) => {
    const out: number[] = []
    let lo = Math.ceil(idxs.length / 2) - 1
    let hi = lo + 1
    while (lo >= 0 || hi < idxs.length) {
      if (lo >= 0) out.push(idxs[lo--])
      if (hi < idxs.length) out.push(idxs[hi++])
    }
    return out
  })
  const order: number[] = []
  for (let round = 0; order.length < layout.slots.length; round++) {
    for (const wall of walls) if (round < wall.length) order.push(wall[round])
  }
  return order
}

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
  extra: ArtworkData[] = [],
  /** Slot order for auto-fill (e.g. balancedFillOrder); sequential when omitted */
  fillOrder?: number[],
  /** Max works shown (plan capacity). Defaults to every slot. Explicit arrangement
   *  entries count toward it; auto-fill stops once it's reached. */
  cap: number = slotCount
): (ArtworkData | null)[] {
  const n = Math.max(0, Math.floor(slotCount))
  const max = Math.max(0, Math.min(n, Math.floor(cap)))
  const slots: (ArtworkData | null)[] = new Array(n).fill(null)
  const byId = new Map(own.map((a) => [a.id, a]))
  const placedIds = new Set<string>()
  let placed = 0
  // 1. Honour explicit placements at ANY physical slot (skip ids that no longer
  //    exist, and duplicates). Pre-balanced rooms arranged works on slots 0..cap-1;
  //    those stay exactly where the owner put them.
  for (let i = 0; i < n && i < arrangement.length; i++) {
    if (placed >= max) break
    const id = arrangement[i]
    if (id && byId.has(id) && !placedIds.has(id)) {
      slots[i] = byId.get(id)!
      placedIds.add(id)
      placed++
    }
  }
  // 2. Auto-fill with works the arrangement never names — own first, then demo.
  //    A gap the arrangement DID leave (null within its range) is intentional and only
  //    gets filled if there's still an unplaced work looking for a home. The fill
  //    ORDER walks the balanced sequence so unplaced works spread across the walls
  //    instead of packing the first wall solid.
  // Only ids pinned WITHIN the current slot range count as "named": a work pinned
  // beyond it (the layout shrank since it was arranged) must fall back to auto-fill,
  // or it would silently vanish from the room.
  const named = new Set(
    arrangement.slice(0, n).filter((x): x is string => !!x)
  )
  const queue = [...own.filter((a) => !named.has(a.id)), ...extra]
  const order = fillOrder
    ? fillOrder.filter((i) => i >= 0 && i < n)
    : Array.from({ length: n }, (_, i) => i)
  let q = 0
  for (const i of order) {
    if (q >= queue.length || placed >= max) break
    if (!slots[i]) {
      slots[i] = queue[q++]
      placed++
    }
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
