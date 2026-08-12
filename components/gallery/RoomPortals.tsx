'use client'
// Connecting doorways to this artist's other public rooms (ユーザー決定 2026-08-09).
//
// A multi-room show is several `galleries` rows, each with its own URL, and moving
// between them is a NEW PAGE LOAD — the user's call, and the reason this file is small:
// the scene still renders exactly one room, so nothing here touches the walls, the
// collision box (WalkControls.clampToRoom), the baked shadows or the ghost crowd. A
// doorway is a free-standing frame plus a proximity test; walking "through" it is a
// navigation.
//
// No hole is cut in the wall. `Room`'s walls are single planes with no opening, and
// cutting one would mean reworking wall geometry, the shadow bake and the clamp for
// every layout. Instead the doorway is **built in front of** the wall: a frame plus a
// short recess (`TUNNEL_D`), which reads as a thick wall with an opening in it
// (ユーザー決定 2026-08-12・C案). It stands `JAMB + TUNNEL_D` = 0.52m off the wall line,
// which the visitor can never walk into — `WalkControls.clampToRoom` keeps them 1.0m
// clear of every wall, so they stop 0.48m short of the mouth.
//
// Placement is flush along a wall (ユーザー指摘 2026-08-12), with the entry-anchored
// free-standing spot kept only as a last resort for rooms too tight on all four walls.
//
// ONE door per room, however many other rooms there are (ユーザー決定 2026-08-09). The
// door is the way out; which room it opens onto is chosen AT the door, in the HUD. One
// opening per room needed spacing, a cap and a shrinking gap, and three separate bugs
// lived in that arithmetic — none of which can exist now.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { LayoutDef, ThemeDef } from '@/lib/presets'
import { useGallery } from '@/lib/store'
import { track } from '@/lib/analytics'
import { roomPath, type SiblingRoom } from '@/lib/publish'
import { titleWallWidth } from '@/lib/roomPlan'
import { getDoorwayDepth } from './textures'

/** Clear height/width of the opening, in metres — a touch over a doorway so the frame
 *  reads at a glance from across the room. */
const DOOR_W = 1.6
const DOOR_H = 2.5
const JAMB = 0.12
/**
 * 開口の奥行き（ユーザー決定 2026-08-12・C案「開口部の奥に短い暗いトンネルを置く」）。
 *
 * **扉をこの分だけ壁から離す**必要がある。壁は厚みの無い1枚のプレーンで、しかも
 * `FrontSide`（部屋の内側を向く片面）なので、**壁の裏に伸ばしたトンネルは壁自身に
 * 隠れて見えない**。以前の `nudge` は `JAMB`（0.12m）だけで、枠の箱が奥行き 0.192m
 * あるため実際に残っていた余地は 0.024m しか無かった。壁を切り欠く案は、影の焼き込みと
 * 当たり判定を全間取りで作り直すことになるので採らない（このファイル冒頭の判断）。
 *
 * 離した結果トンネルの外側が部屋に出るが、**外面を枠と同じ暗色にしてあるので
 * 「厚い壁に開いた開口」として読める** ── 箱が浮いて見えるのではなく建築になる。
 * 0.4m は実際の厚い壁の開口と同じくらいで、突き出しは 0.52m に収まる
 * （最も浅い間取りでも半奥行き 4m あるので、通路を塞がない）。
 */
const TUNNEL_D = 0.4
/** 枠（jamb / lintel）の箱の奥行き。枠は `z = 0` を中心に置くので、**半分だけトンネル側へ
 *  食い込む**。 */
const JAMB_D = JAMB * 1.6
/** トンネルの内壁（側壁・天井）は `z = 0` からではなく**枠の箱が終わる位置から**始める。
 *  同じ平面に枠の内側の面（左右の枠なら `|x| = DOOR_W/2`、まぐさなら `y = DOOR_H`）が既に
 *  居るので、`z = 0` から張ると重なった区間が**完全な同一平面になり Zファイティングで
 *  ちらつく**（別視点レビューで検出。ユーザー報告の床のちらつきと同型の不具合）。
 *  枠の面とは端で接するので隙間はできない。 */
const TUNNEL_INNER_D = TUNNEL_D - JAMB_D / 2
const TUNNEL_INNER_Z = -(JAMB_D / 2 + TUNNEL_D) / 2
/** How close the camera has to be for the doorway to offer itself. Generous, because
 *  the prompt is a suggestion — the visitor still has to press it. */
const NEAR_DIST = 2.8

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
const WALL_DOOR_HALF = DOOR_W / 2 + JAMB
/** Gap left between whatever the wall already carries (the title board, or the
 *  nearest hanging slot) and the doorway, so the two never read as touching. Tried
 *  generously first, then tightened once, before giving up on a given wall. */
const CLEARANCE_STEPS = [0.35, 0.1]

/** One of the room's four walls, in the terms `doorOnWall` needs: which coordinate is
 *  fixed (and its value), how far the wall runs (half-length, along the other axis),
 *  the yaw that faces the doorway into the room, and which way to nudge it off the
 *  wall line so the frame doesn't clip into the wall.
 *
 *  **`WALL_OFFSET` は `JAMB` ではなく `JAMB + TUNNEL_D`**（ユーザー決定 2026-08-12・C案）。
 *  開口の奥にトンネルを掘るには、壁の手前にその分の空間が要る ── 壁の裏へ伸ばしても
 *  片面プレーンの壁に隠れるだけなので（`TUNNEL_D` の説明を参照）。 */
const WALL_OFFSET = JAMB + TUNNEL_D
function wallSpec(layout: LayoutDef, id: 'west' | 'east' | 'north' | 'south') {
  switch (id) {
    case 'west':
      return { fixedAxis: 'x' as const, fixed: -layout.hw, half: layout.hd, rotY: Math.PI / 2, nudge: WALL_OFFSET }
    case 'east':
      return { fixedAxis: 'x' as const, fixed: layout.hw, half: layout.hd, rotY: -Math.PI / 2, nudge: -WALL_OFFSET }
    case 'north':
      return { fixedAxis: 'z' as const, fixed: -layout.hd, half: layout.hw, rotY: 0, nudge: WALL_OFFSET }
    case 'south':
      return { fixedAxis: 'z' as const, fixed: layout.hd, half: layout.hw, rotY: Math.PI, nudge: -WALL_OFFSET }
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
    half = Math.max(half, Math.abs(spec.fixedAxis === 'x' ? s.z : s.x))
  }
  return half
}

/** Where the doorway stands on a given wall, past whichever end of that wall's own
 *  slots/board has room for it — `null` if it doesn't fit even at the tightest
 *  clearance tried. Faces straight into the room (perpendicular to the wall) rather
 *  than toward the room's centre point, the way a real doorway set into a wall would. */
function doorOnWall(layout: LayoutDef, id: 'west' | 'east' | 'north' | 'south'): { pos: THREE.Vector3; rotY: number } | null {
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
    const fixedPos = spec.fixed + spec.nudge
    const x = spec.fixedAxis === 'x' ? fixedPos : vary
    const z = spec.fixedAxis === 'x' ? vary : fixedPos
    return { pos: new THREE.Vector3(x, 0, z), rotY: spec.rotY }
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
function doorPlacement(layout: LayoutDef): { pos: THREE.Vector3; rotY: number } | null {
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
 *
 * Anchored on `layout.entry` — always inside the room, always walkable, and never inside
 * a bench or a partition, because it is where visitors are placed on arrival — offset
 * SIDEWAYS by ENTRY_CLEAR so the visitor does not load standing in the frame. Whichever
 * side has the room gets it; a space too tight for either gets no door, and the room list
 * in the HUD is still the complete way around.
 */
function entryDoorPlacement(layout: LayoutDef): { pos: THREE.Vector3; rotY: number } | null {
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
  return { pos: new THREE.Vector3(x, 0, z), rotY: Math.atan2(-x, -z) }
}

function Doorway({
  at,
  rotY,
  theme,
  active,
  onEnter,
}: {
  at: THREE.Vector3
  rotY: number
  theme: ThemeDef
  active: boolean
  onEnter: () => void
}) {
  const gl = useThree((s) => s.gl)
  // The opening itself: a dim panel that lifts when the visitor is close enough to use
  // it, so "this one is live" is readable without any text in the scene.
  return (
    <group position={at} rotation-y={rotY}>
      {/* Jambs and lintel — plain trim, the same near-black as the room's baseboards */}
      {/* 近づくと枠が仄かに光る＝「この扉は使える」の合図。**面を足さずに既にある枠で
          伝える** ── 開口に半透明の板や帯を重ねる方式は、テーマ次第で明るい板に見えたり
          （whitecube の `stripColor` は純白）奥行きを霞ませたりした。`emissive` なら
          照明にも奥行きにも触らない。 */}
      {[
        { pos: [-(DOOR_W / 2 + JAMB / 2), DOOR_H / 2, 0] as const, size: [JAMB, DOOR_H, JAMB * 1.6] as const },
        { pos: [DOOR_W / 2 + JAMB / 2, DOOR_H / 2, 0] as const, size: [JAMB, DOOR_H, JAMB * 1.6] as const },
        { pos: [0, DOOR_H + JAMB / 2, 0] as const, size: [DOOR_W + JAMB * 2, JAMB, JAMB * 1.6] as const },
      ].map((j, i) => (
        <mesh key={`j${i}`} position={[...j.pos]}>
          <boxGeometry args={[...j.size]} />
          <meshStandardMaterial
            color={0x0e0c0a}
            roughness={0.7}
            emissive={theme.stripColor}
            emissiveIntensity={active ? 0.5 : 0.12}
          />
        </mesh>
      ))}
      {/* 開口の奥のトンネル（ユーザー決定 2026-08-12・C案）。**実際に奥行きがある**ので、
          側壁が開口の近くだけ光を拾って奥へ落ちていく ── 平らな板に勾配を描く方式（B案）
          との違いはそこ。ローカル -z が壁の側、+z が部屋の側（`rotY` が開口を部屋へ向ける）。

          側壁と天井は `DoubleSide` の1マテリアルで兼用する: 内側から見ればトンネルの
          内壁、外側から見れば枠と同じ暗色の箱＝「厚い壁」に見える。面を2組持たない。
          床は敢えて置かない（下の「天井だけ」のコメント参照）。 */}
      {/* 奥の面。ここだけ `meshBasicMaterial` で照明に依存させない ── テーマの明るさで
          奥が明るくなると「穴」に見えなくなる。勾配は中心が最も暗い（getDoorwayDepth）。 */}
      <mesh position={[0, DOOR_H / 2, -TUNNEL_D]} renderOrder={0}>
        <planeGeometry args={[DOOR_W, DOOR_H]} />
        <meshBasicMaterial map={getDoorwayDepth()} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* 側壁（左右） */}
      {[-1, 1].map((sx) => (
        <mesh
          key={`tw${sx}`}
          position={[(sx * DOOR_W) / 2, DOOR_H / 2, TUNNEL_INNER_Z]}
          rotation-y={Math.PI / 2}
        >
          <planeGeometry args={[TUNNEL_INNER_D, DOOR_H]} />
          <meshStandardMaterial color={0x0e0c0a} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 天井だけ。**床は置かない**（ユーザー報告 2026-08-12「下部がちらついてる」）。
          部屋の床は `hw*2 × hd*2` のプレーンで y=0、扉の下も通っている ── そこへ
          トンネルの床を y=0 で重ねたので**完全な同一平面になり Zファイティングで
          ちらついていた**。部屋の床がそのまま recess の床になるのが実際の戸口でもある。 */}
      <mesh position={[0, DOOR_H, TUNNEL_INNER_Z]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[DOOR_W, TUNNEL_INNER_D]} />
        <meshStandardMaterial color={0x0e0c0a} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* 「生きている扉」の合図は**枠そのものを光らせる**（上の jamb/lintel の emissive）。
          以前ここに置いていた敷居の帯は、テーマの `stripColor` が純白の間取り
          （whitecube）で**明るい灰色の板**に見えてしまった（ユーザー報告のスクショで確認）。
          面を足さずに既にある枠で伝えれば、重なる面が増えず Zファイティングの種も増えない。 */}
      {/* クリックの的は開口いっぱい（見えないまま）。帯だけを的にすると狙いにくく、
          扉は主要な移動手段なので的は大きく保つ。`opacity: 0` でもレイキャストは通る
          （three は `visible` を見るが不透明度は見ない）。 */}
      <mesh
        position={[0, DOOR_H / 2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onEnter()
        }}
        onPointerOver={() => (gl.domElement.style.cursor = 'pointer')}
        onPointerOut={() => (gl.domElement.style.cursor = '')}
      >
        <planeGeometry args={[DOOR_W, DOOR_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export default function RoomPortals({ layout, theme }: { layout: LayoutDef; theme: ThemeDef }) {
  const camera = useThree((s) => s.camera)
  const visitor = useGallery((s) => s.visitor)
  const atDoorway = useGallery((s) => s.atDoorway)
  const setAtDoorway = useGallery((s) => s.setAtDoorway)
  const setRoomPickerOpen = useGallery((s) => s.setRoomPickerOpen)

  // The OTHER public rooms. `rooms` always contains the current one, so filtering it
  // out is what turns a single-room show into "no doorway at all".
  const others = useMemo<SiblingRoom[]>(
    () => (visitor?.rooms ?? []).filter((r) => r.slug !== visitor?.slug),
    [visitor]
  )
  const place = useMemo(() => doorPlacement(layout), [layout])

  // Proximity. One door, so this is a single distance test — and `setAtDoorway` ignores
  // an unchanged value, so standing still costs no re-renders.
  useFrame(() => {
    if (!place) return
    const d = Math.hypot(camera.position.x - place.pos.x, camera.position.z - place.pos.z)
    setAtDoorway(d < NEAR_DIST)
  })

  // Unmounting (leaving the room, or the door going away) must not strand a stale prompt
  // or an open picker in the HUD.
  useEffect(
    () => () => {
      setAtDoorway(false)
      setRoomPickerOpen(false)
    },
    [setAtDoorway, setRoomPickerOpen]
  )

  if (!visitor || !others.length || !place) return null

  /** Through the door. With one other room there is nothing to choose, so go straight
   *  there; with several, the door asks which one (ユーザー決定 2026-08-09). */
  const go = () => {
    if (others.length === 1) enterRoom(visitor, others[0])
    else setRoomPickerOpen(true)
  }

  return <Doorway at={place.pos} rotY={place.rotY} theme={theme} active={atDoorway} onEnter={go} />
}

/** Walk through to another room: a full navigation, which is what makes this cheap
 *  (the whole scene is rebuilt for the new room rather than swapped in place).
 *  The front-door room lives at `/@name` (a joint exhibition's lobby at
 *  `/expo/{name}`), everything else one level under it — `roomPath` is the ONE place
 *  that mapping lives, and `lib/seo.exhibitionPath` canonicalises through the same
 *  function, so a doorway never links to a URL that redirects, 404s or duplicates. */
export function enterRoom(from: { username: string; expo: { slug: string } | null }, room: SiblingRoom): void {
  const path = roomPath(from, room)
  const embed = useGallery.getState().embed
  track('room_enter', { to: room.slug, main: room.isMain, embed, expo: from.expo?.slug ?? null })
  // Embedded, this gallery is a frame on somebody else's page: navigating it would
  // silently replace their embed with a different room. Same rule the rest of the HUD
  // follows for outbound links in an embed — open it, don't hijack the frame.
  if (embed) window.open(path, '_blank', 'noopener')
  else window.location.assign(path)
}
