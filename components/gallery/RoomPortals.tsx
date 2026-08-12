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
// Free-standing on purpose. `Room`'s walls are single planes with no opening, and
// cutting a hole in one would mean reworking wall geometry, the shadow bake and the
// clamp for every layout. A doorframe standing against the floor reads as a way out
// without any of that, and it lands in walkable space in EVERY layout because it is
// positioned from `layout.entry` — the spot the visitor already spawns on.
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

/** Clear height/width of the opening, in metres — a touch over a doorway so the frame
 *  reads at a glance from across the room. */
const DOOR_W = 1.6
const DOOR_H = 2.5
const JAMB = 0.12
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
/** Gap left between the title board's edge and the doorway, so the two never read
 *  as touching. */
const BOARD_CLEARANCE = 0.4
/** Gap left between the doorway and the corner it stands nearest to. */
const CORNER_CLEARANCE = 0.3

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
 * Preferred spot (ユーザー指示 2026-08-12): the far end of the title wall (the "back"
 * wall the exhibition board hangs on, TitleWall.tsx) — the doorway stands flush against
 * it, past the board, so it reads as the room's other landmark rather than an
 * arbitrary object floating mid-floor. Rooms too shallow for the board AND a clear
 * doorway on the same wall (the gap left on either side of the board is fixed
 * regardless of room size — see `titleWallWidth`) fall back to the previous
 * entry-anchored placement rather than clipping into the board or a side wall.
 */
function doorPlacement(layout: LayoutDef): { pos: THREE.Vector3; rotY: number } | null {
  return titleWallDoorPlacement(layout) ?? entryDoorPlacement(layout)
}

/** Flush against the title wall (x = -layout.hw), past whichever end of the board has
 *  room for it. Faces straight into the room (perpendicular to the wall) rather than
 *  toward the room's centre point, the way a real doorway set into a wall would. */
function titleWallDoorPlacement(layout: LayoutDef): { pos: THREE.Vector3; rotY: number } | null {
  const boardHalf = titleWallWidth(layout) / 2
  const centerToDoor = boardHalf + BOARD_CLEARANCE + WALL_DOOR_HALF
  if (centerToDoor + WALL_DOOR_HALF + CORNER_CLEARANCE > layout.hd) return null
  // Put it on the end farther from the entry point, so walking toward it reads as
  // moving deeper into the room rather than turning back toward where you arrived.
  const dir = layout.entry.z <= 0 ? 1 : -1
  const x = -layout.hw + JAMB
  const z = dir * centerToDoor
  return { pos: new THREE.Vector3(x, 0, z), rotY: Math.PI / 2 }
}

/**
 * Previous placement, kept as the fallback for rooms too shallow to fit a doorway
 * beside the title board (docs/DECISIONS 2026-08-09 for the original design).
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
      <mesh position={[-(DOOR_W / 2 + JAMB / 2), DOOR_H / 2, 0]}>
        <boxGeometry args={[JAMB, DOOR_H, JAMB * 1.6]} />
        <meshStandardMaterial color={0x0e0c0a} roughness={0.7} />
      </mesh>
      <mesh position={[DOOR_W / 2 + JAMB / 2, DOOR_H / 2, 0]}>
        <boxGeometry args={[JAMB, DOOR_H, JAMB * 1.6]} />
        <meshStandardMaterial color={0x0e0c0a} roughness={0.7} />
      </mesh>
      <mesh position={[0, DOOR_H + JAMB / 2, 0]}>
        <boxGeometry args={[DOOR_W + JAMB * 2, JAMB, JAMB * 1.6]} />
        <meshStandardMaterial color={0x0e0c0a} roughness={0.7} />
      </mesh>
      {/* The threshold glow. Emissive rather than lit, so it reads the same under every
          theme's lighting; the theme only decides its colour temperature. */}
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
        <meshBasicMaterial
          color={theme.stripColor}
          transparent
          opacity={active ? 0.3 : 0.13}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
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
