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

/**
 * How many works a room can actually hang — the ONE place this is decided.
 *
 * `cap`（口座が持っている作品枠）が縛るのは **自動で埋める枚数だけ**。手で並べた部屋
 * （`arrangement` が非空）では、オーナーが壁に掛けたものがそのまま出る ── 上限は間取りの
 * 物理スロット数だけ（ユーザー決定 2026-08-12「配置したものを正とする」＝A案）。
 *
 * この関数が独立して存在するのは、同じ計算が**3か所に写して書かれていた**ため。
 * 2026-08-12 に枠を口座全体の共通プールにしたとき、配置エディタだけが新しい計算
 * （口座合計 − 他の部屋の配置数）に切り替わり、保存（lib/galleries.rebuildPlacements）と
 * 3D描画（lib/roomPlan.slotCount）は昔の「その部屋自身の work_cap」のまま残った。結果、
 * **ダッシュボードで15点並べても保存時に10点が捨てられ、3Dには5点しか出なかった**
 * （ユーザー報告 2026-08-12）。3経路がこの1本を通る形にして、二度と食い違えなくする。
 *
 * 枠の総量は入口で守る: `PlacementEditor.drop()` が cap 到達時に新しい配置を断る。
 * ここで既に掛かっているものを黙って落とすのは、**オーナーが作った展示を勝手に
 * 削る**（しかも placements の行が実際に delete される）ことなので、やらない。
 */
export function usableSlots(slotCount: number, arrangement: (string | null)[], cap: number): number {
  const n = Math.max(0, Math.floor(slotCount))
  return arrangement.length > 0 ? n : Math.max(0, Math.min(n, Math.floor(cap)))
}

/** Resolve which work occupies each physical slot.
 *  Returns an array of length `slotCount`; entry i is the work at slot i, or null when
 *  the slot is empty.
 *  - Works named in `arrangement` go to their slot (first valid occurrence wins).
 *  - When `arrangement` is EMPTY (an un-arranged room, or the guest demo showcase),
 *    every work auto-fills the slots in order: own works first, then `extra` (the guest
 *    demo collection) — exactly "hang the works in slots 0,1,2,…", the pre-§11.13
 *    behaviour, so un-arranged rooms are unaffected.
 *  - Once `arrangement` is non-empty it is AUTHORITATIVE: only the works it names hang,
 *    and works it omits stay off the wall (the owner took them down, or never placed a
 *    new upload). No auto-fill runs, so a manually curated room shows exactly the works
 *    the owner chose (ユーザー指示 2026-07-31).
 *  - `guests` (合同展示で他の作家が出した作品) can be NAMED by the arrangement but are
 *    **never auto-filled**. A submission is an offer, not a decision: the organiser has
 *    to hang it. Passing them in `own` or `extra` instead would auto-hang a stranger's
 *    work in any room whose arrangement is still empty. */
export function placeWorks(
  slotCount: number,
  arrangement: (string | null)[],
  own: ArtworkData[],
  extra: ArtworkData[] = [],
  /** Slot order for auto-fill (e.g. balancedFillOrder); sequential when omitted */
  fillOrder?: number[],
  /** Max works AUTO-FILLED (plan capacity). Defaults to every slot. Does **not** truncate
   *  an explicit `arrangement` — see `usableSlots` above for why. */
  cap: number = slotCount,
  /** Placeable but never auto-filled — see the note above. */
  guests: ArtworkData[] = []
): (ArtworkData | null)[] {
  const n = Math.max(0, Math.floor(slotCount))
  const max = usableSlots(n, arrangement, cap)
  const slots: (ArtworkData | null)[] = new Array(n).fill(null)
  const byId = new Map([...own, ...guests].map((a) => [a.id, a]))
  const placedIds = new Set<string>()
  let placed = 0
  // 1. Honour explicit placements at ANY physical slot (skip ids that no longer
  //    exist, and duplicates). Pre-balanced rooms arranged works on slots 0..cap-1;
  //    those stay exactly where the owner put them. `max` is the physical slot count
  //    whenever an arrangement exists, so `cap` never silently un-hangs a work here.
  for (let i = 0; i < n && i < arrangement.length; i++) {
    if (placed >= max) break
    const id = arrangement[i]
    if (id && byId.has(id) && !placedIds.has(id)) {
      slots[i] = byId.get(id)!
      placedIds.add(id)
      placed++
    }
  }
  // 2. Auto-fill — but ONLY when there is no manual arrangement at all (an empty array).
  //    Once the owner has arranged the room, `arrangement` is a full-length snapshot
  //    (every edit writes one, even when it's all nulls), and it is authoritative: a work
  //    they took off the wall must stay in the tray, and a work they never placed must not
  //    auto-hang itself (ユーザー指示 2026-07-31「壁から外す＝トレイに戻す・自動で埋め
  //    戻さない」). The guest demo showcase and every un-arranged room keep the old
  //    "hang the works in slots 0,1,2,…" behaviour because their arrangement is empty.
  //    One rescue survives the authoritative rule: a work the arrangement STILL names but
  //    couldn't seat — pinned at a slot index the layout no longer has (a custom room was
  //    shrunk) — is re-placed into an open slot, so a resize never silently drops a work
  //    the owner didn't take down. A work the arrangement doesn't mention at all (taken
  //    off the wall, or a never-placed new upload) stays off.
  let queue: ArtworkData[]
  if (arrangement.length === 0) {
    queue = [...own, ...extra]
  } else {
    const namedAnywhere = new Set(arrangement.filter((x): x is string => !!x))
    // Guests are included HERE but not in the auto-fill branch above: this is the
    // rescue for a work the arrangement still names but whose slot the layout lost,
    // and dropping a guest's work on a resize would be the same silent loss.
    queue = [...own, ...guests].filter((a) => namedAnywhere.has(a.id) && !placedIds.has(a.id))
  }
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
