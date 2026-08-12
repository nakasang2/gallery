'use client'
// 扉が「どこに、どちらを向いて開くか」だけを持つモジュール。
//
// **壁を切り抜く側（Room）と、枠＋奥の廊下を建てる側（RoomPortals）の両方が
// ここだけを見る。** 分けた理由は壊れ方の重さ: 片方が「開口はここ」と思い、もう片方が
// 別の場所を開けると、**壁に穴が空いたまま扉が無い**＝部屋の外（虚空）が見える、という
// 誰も気づかないまま出荷されうる不具合になる。答えを1つにすれば食い違えない。
//
// 2026-08-13 まで扉は「壁を切り抜かずに、壁の 0.52m 手前へ置いた箱」だった。ユーザーの
// 実機確認で **①枠が浮いて見える ②奥行き 0.4m では床が途切れて奥行きを感じない**と
// 分かり、**壁に本物の開口を開ける（ユーザー選択 A案）** に切り替えた。切り抜けば
// 廊下は壁の裏＝部屋の外に置けるので、深さは部屋の広さと無関係に取れる。
import { useMemo } from 'react'
import * as THREE from 'three'
import type { LayoutDef } from '@/lib/presets'
import { useGallery } from '@/lib/store'
import { titleWallWidth } from '@/lib/roomPlan'

/** Clear height/width of the opening, in metres — a touch over a doorway so the frame
 *  reads at a glance from across the room. */
export const DOOR_W = 1.6
export const DOOR_H = 2.5
export const JAMB = 0.12
/** 枠（jamb / lintel）の箱の奥行き。枠は壁の面（ローカル `z = 0`）を中心に置くので、
 *  半分が部屋側へ出て、半分が開口の中へ入る ── 実際のドア枠と同じ納まり。 */
export const JAMB_D = JAMB * 1.6

/** 壁を切り抜いた開口の奥に伸ばす廊下の奥行き。**壁の裏＝部屋の外**なので、部屋を
 *  狭めずに深く取れる。1.2m あると床が奥へ続いて暗がりへ落ちるのが読める（0.4m では
 *  「黒い板」に見えた ── ユーザー報告 2026-08-13）。 */
export const WALL_TUNNEL_D = 1.2
/** 最後の手段（自立配置）の奥行き。こちらは箱が**部屋の中に出る**ので浅く保つ。 */
export const FREE_TUNNEL_D = 0.4

export type WallId = 'west' | 'east' | 'north' | 'south'

/** 壁に開ける穴。`u` は**その壁の左端（壁のローカル +X 側から見た左）からの距離**で、
 *  `Room` の壁プレーンの UV と同じ座標系。 */
export type WallHole = { wall: WallId; u: number; wallWidth: number }

export type DoorPlacement = {
  pos: THREE.Vector3
  rotY: number
  /** 壁を切り抜いた本物の開口。`null` は最後の手段の自立配置（切り抜けない）。 */
  hole: WallHole | null
}

/** How far the doorway stands from `layout.entry`. The entry is the camera's spawn
 *  point, so a doorway ON it means loading the room already inside the frame — far
 *  enough that the visitor sees the doorway instead of standing in it. */
const ENTRY_CLEAR = 2.2

/** How far along `side` from `from` the visitor can still stand, as a [min, max]
 *  range of the parameter t in `from + side * t`. Bounded by the walls minus the same
 *  1.0m margin `WalkControls.clampToRoom` keeps, so a doorway never ends up somewhere
 *  the visitor cannot walk to. */
function freeSpan(
  from: { x: number; z: number },
  side: THREE.Vector2,
  hw: number,
  hd: number,
  margin: number
): [number, number] {
  let lo = -Infinity
  let hi = Infinity
  // One axis at a time: t is bounded where the moving coordinate leaves the box. An
  // axis the direction barely moves along constrains nothing (and must not divide).
  for (const [pos, dir, half] of [
    [from.x, side.x, hw],
    [from.z, side.y, hd],
  ] as const) {
    const limit = half - margin
    if (Math.abs(dir) < 1e-6) continue
    const a = (-limit - pos) / dir
    const b = (limit - pos) / dir
    lo = Math.max(lo, Math.min(a, b))
    hi = Math.min(hi, Math.max(a, b))
  }
  return [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0]
}

/** Half the doorway's own footprint along the wall it stands against (opening +
 *  jambs), in metres. */
export const WALL_DOOR_HALF = DOOR_W / 2 + JAMB
/** Gap left between whatever the wall already carries (the title board, or the
 *  nearest hanging slot) and the doorway, so the two never read as touching. Tried
 *  generously first, then tightened once, before giving up on a given wall. */
const CLEARANCE_STEPS = [0.35, 0.1]
/** 掛かる作品の**半幅の見込み**。`layout.slots` は掛ける位置（中心）しか持たず、実際の
 *  幅は作品ごとに実行時に決まるので、静的には見込みで空ける。切り抜き前は重なっても
 *  「絵の隣に枠がある」程度だったが、**開口を開けた後は作品が穴の上に浮く**ので、
 *  ここを空けないと壊れて見える。1.7m 幅の大作まで当たらない値。 */
const SLOT_HALF_ALLOW = 0.85

/** One of the room's four walls, in the terms `doorOnWall` needs: which coordinate is
 *  fixed (and its value), how far the wall runs (half-length, along the other axis),
 *  and the yaw that faces the doorway into the room.
 *
 *  `uSign` は「壁に沿った世界座標」→「壁プレーンの左端からの距離 u」の向き。
 *  `Room` の壁は `rotY` が同じプレーンなので、`u = half + uSign * vary` で一致する
 *  （north/east はプレーンのローカル +X が世界の +x/+z、south/west は逆向き）。 */
function wallSpec(layout: LayoutDef, id: WallId) {
  switch (id) {
    case 'west':
      return { fixedAxis: 'x' as const, fixed: -layout.hw, half: layout.hd, rotY: Math.PI / 2, uSign: -1 }
    case 'east':
      return { fixedAxis: 'x' as const, fixed: layout.hw, half: layout.hd, rotY: -Math.PI / 2, uSign: 1 }
    case 'north':
      return { fixedAxis: 'z' as const, fixed: -layout.hd, half: layout.hw, rotY: 0, uSign: 1 }
    case 'south':
      return { fixedAxis: 'z' as const, fixed: layout.hd, half: layout.hw, rotY: Math.PI, uSign: -1 }
  }
}

/** How much of that wall's length is already claimed, as a half-extent from its
 *  centre. The west wall carries the exhibition title board (TitleWall.tsx) and never
 *  any hanging slots; the other three carry whatever `layout.slots` puts on them (a
 *  wall with none of its own is reported as fully free). */
function wallOccupiedHalf(layout: LayoutDef, spec: ReturnType<typeof wallSpec>): number {
  if (spec.fixedAxis === 'x' && spec.fixed < 0) return titleWallWidth(layout) / 2
  let half = 0
  for (const s of layout.slots) {
    const onThisWall = Math.abs((spec.fixedAxis === 'x' ? s.x : s.z) - spec.fixed) < 0.5
    if (!onThisWall) continue
    half = Math.max(half, Math.abs(spec.fixedAxis === 'x' ? s.z : s.x) + SLOT_HALF_ALLOW)
  }
  return half
}

/** Where the doorway stands on a given wall, past whichever end of that wall's own
 *  slots/board has room for it — `null` if it doesn't fit even at the tightest
 *  clearance tried. Faces straight into the room (perpendicular to the wall) rather
 *  than toward the room's centre point, the way a real doorway set into a wall would. */
function doorOnWall(layout: LayoutDef, id: WallId): DoorPlacement | null {
  const spec = wallSpec(layout, id)
  const occupiedHalf = wallOccupiedHalf(layout, spec)
  for (const clearance of CLEARANCE_STEPS) {
    const centerToDoor = occupiedHalf + clearance + WALL_DOOR_HALF
    if (centerToDoor + WALL_DOOR_HALF + clearance > spec.half) continue
    // Put it on the end farther from the entry point, so walking toward it reads as
    // moving deeper into the room rather than turning back toward where you arrived.
    const entryVary = spec.fixedAxis === 'x' ? layout.entry.z : layout.entry.x
    const dir = entryVary <= 0 ? 1 : -1
    const vary = dir * centerToDoor
    // 壁の面ぴったり。切り抜くので前へ逃がす必要がない（2026-08-13 A案）。
    const x = spec.fixedAxis === 'x' ? spec.fixed : vary
    const z = spec.fixedAxis === 'x' ? vary : spec.fixed
    return {
      pos: new THREE.Vector3(x, 0, z),
      rotY: spec.rotY,
      hole: { wall: id, u: spec.half + spec.uSign * vary, wallWidth: spec.half * 2 },
    }
  }
  return null
}

/**
 * Where the doorway stands.
 *
 * ONE doorway, whatever the number of other rooms (ユーザー決定 2026-08-09): the door is
 * the way out, and WHICH room it leads to is a choice made at the door. That replaced an
 * earlier design that placed one opening per room — it needed spacing, a cap, and a
 * shrinking gap to fit, and three of its bugs were in that arithmetic alone. A single
 * door has no arithmetic to get wrong, and it reads better: several openings in a row
 * stop looking like doors.
 *
 * **Always flush against a wall** (ユーザー指摘 2026-08-12: 「扉って壁沿いにあるものでは
 * ないですか？」) — never free-standing in open floor space, which is what the previous
 * entry-anchored fallback did for shallower rooms and read as an arbitrary object rather
 * than a doorway. Tries the title wall first (past whichever end of the board has room —
 * ユーザー指示 2026-08-12), then the opposite wall, then the two side walls, each at the
 * end farther from the entry point. A room too tight on every wall (none in the current
 * presets or the full custom size range) falls back to the old entry-anchored spot as a
 * last resort rather than showing no door at all.
 */
export function doorPlacement(layout: LayoutDef): DoorPlacement | null {
  for (const id of ['west', 'east', 'north', 'south'] as const) {
    const at = doorOnWall(layout, id)
    if (at) return at
  }
  return entryDoorPlacement(layout)
}

/**
 * Last-resort placement — free-standing in open floor space, anchored on
 * `layout.entry` (docs/DECISIONS 2026-08-09 for the original design). Only reached if
 * `doorPlacement` couldn't fit the doorway flush against any of the room's four walls.
 * 壁が無いので切り抜けない ＝ `hole: null`。廊下は浅いまま部屋の中に出る。
 */
function entryDoorPlacement(layout: LayoutDef): DoorPlacement | null {
  const { entry } = layout
  const margin = 1.0
  // Unit vector perpendicular to the entry heading, along the floor.
  const side = new THREE.Vector2(Math.cos(entry.yaw), -Math.sin(entry.yaw))
  const [lo, hi] = freeSpan(entry, side, layout.hw, layout.hd, margin)
  const dir = hi >= -lo ? 1 : -1
  if (Math.max(hi, -lo) < ENTRY_CLEAR) return null

  const t = dir * ENTRY_CLEAR
  const x = entry.x + side.x * t
  const z = entry.z + side.y * t
  // Face the room's centre, so the opening is seen from where the art hangs. A plane's
  // normal points along +Z before rotation, so `atan2(-x, -z)` IS the yaw that turns it
  // toward (0,0) — an extra quarter turn here left the doorway edge-on (caught by the
  // orientation check, which measures normal · toCentre).
  return { pos: new THREE.Vector3(x, 0, z), rotY: Math.atan2(-x, -z), hole: null }
}

/**
 * 今この部屋に扉が建つか、建つならどこか。**`Room` と `RoomPortals` の唯一の入口。**
 *
 * `rooms` は自分自身を含むので、自分を除いて1つも無ければ扉は建たない ── そのとき
 * `Room` は壁を切り抜いてはいけない（穴の向こうに何も無い）。
 */
export function useDoorway(layout: LayoutDef): DoorPlacement | null {
  const visitor = useGallery((s) => s.visitor)
  const hasOthers = !!visitor && (visitor.rooms ?? []).some((r) => r.slug !== visitor.slug)
  return useMemo(() => (hasOthers ? doorPlacement(layout) : null), [hasOthers, layout])
}
