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
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { LayoutDef, ThemeDef } from '@/lib/presets'
import { useGallery } from '@/lib/store'
import { track } from '@/lib/analytics'
import type { SiblingRoom } from '@/lib/publish'

/** Clear height/width of the opening, in metres — a touch over a doorway so the frame
 *  reads at a glance from across the room. */
const DOOR_W = 1.6
const DOOR_H = 2.5
const JAMB = 0.12
/** How close the camera has to be for the doorway to offer itself. Generous, because
 *  the prompt is a suggestion — the visitor still has to press it. */
const NEAR_DIST = 2.8

/** Preferred spacing between doorway centres, and the tightest they may be packed
 *  before we stop adding them. Below DOOR_W they would overlap, which is why the
 *  floor is the opening's own width plus a sliver of jamb. */
const GAP_WANT = DOOR_W + 0.9
const GAP_MIN = DOOR_W + 0.25
/** How many doorways one room shows at most. Not a limit on rooms — rooms are
 *  unlimited — but past this many, openings crowding one wall stop reading as doors,
 *  and the room list in the HUD is the complete index either way. */
const MAX_DOORS = 4
/** How far the nearest doorway stands from `layout.entry`. The entry is the camera's
 *  spawn point, so a doorway centred on it means loading the room already inside the
 *  frame — far enough that the visitor sees the doorway instead of standing in it. */
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

/**
 * Where the doorways stand.
 *
 * Anchored on `layout.entry` — always inside the room, always walkable, and never
 * inside a bench or a partition, because it is where visitors are placed on arrival —
 * and spread SIDEWAYS from it, perpendicular to the direction they face on entry. So
 * the ways onward sit beside the way in, which is also how a real gallery does it.
 *
 * The run is fitted to the space that actually exists rather than placed and then
 * clamped: clamping each doorway independently piled the outer ones on top of each
 * other as soon as there were four (caught by the placement check before this shipped).
 * So the gap shrinks toward GAP_MIN to fit, the run slides to stay inside the room,
 * and if even the tightest spacing will not hold them all, FEWER are returned — the
 * caller renders only the doorways it gets, and the HUD's room list still names every
 * room.
 */
function doorPlacements(layout: LayoutDef, count: number): { pos: THREE.Vector3; rotY: number }[] {
  const { entry } = layout
  const margin = 1.0
  // Unit vector perpendicular to the entry heading, along the floor.
  const side = new THREE.Vector2(Math.cos(entry.yaw), -Math.sin(entry.yaw))
  const [lo, hi] = freeSpan(entry, side, layout.hw, layout.hd, margin)
  const span = Math.max(0, hi - lo)

  // The doorways go entirely to ONE side of the entry, starting ENTRY_CLEAR away, so
  // none of them can land on the camera's spawn point. The clearance is carved out of
  // the usable span BEFORE fitting rather than applied afterwards: offsetting the run
  // and then clamping it back inside the room dragged the near doorway to within 0.23m
  // of the spawn as soon as there were three (caught by the geometry check).
  //
  // `dir` is whichever side has more room past the clearance; `usable` is how much of it
  // there is. A room too shallow to hold even one doorway that far from the entry gets
  // none — the HUD's room list is still the complete way around.
  const roomAhead = Math.max(0, hi - ENTRY_CLEAR)
  const roomBehind = Math.max(0, -ENTRY_CLEAR - lo)
  const dir = roomAhead >= roomBehind ? 1 : -1
  const usable = Math.max(roomAhead, roomBehind)
  if (usable <= 0) return []

  let n = Math.min(count, MAX_DOORS)
  while (n > 1 && GAP_MIN * (n - 1) > usable) n--
  const gap = n > 1 ? Math.min(GAP_WANT, usable / (n - 1)) : 0

  const out: { pos: THREE.Vector3; rotY: number }[] = []
  for (let i = 0; i < n; i++) {
    // Nearest doorway exactly at the clearance, the rest marching further out.
    const t = dir * (ENTRY_CLEAR + gap * i)
    const x = entry.x + side.x * t
    const z = entry.z + side.y * t
    // Face the room's centre, so the opening is seen from where the art hangs. A plane's
    // normal points along +Z before rotation, so `atan2(-x, -z)` IS the yaw that turns it
    // toward (0,0) — an extra quarter turn here left every doorway edge-on (caught by the
    // orientation check, which measures normal · toCentre).
    out.push({ pos: new THREE.Vector3(x, 0, z), rotY: Math.atan2(-x, -z) })
  }
  return out
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
  const nearRoomSlug = useGallery((s) => s.nearRoomSlug)
  const setNearRoom = useGallery((s) => s.setNearRoom)

  // The OTHER public rooms. `rooms` always contains the current one, so filtering it
  // out is what turns a single-room show into "no doorways at all".
  const others = useMemo<SiblingRoom[]>(
    () => (visitor?.rooms ?? []).filter((r) => r.slug !== visitor?.slug),
    [visitor]
  )
  // `doorPlacements` returns as many doorways as this room can actually hold, which
  // may be fewer than there are other rooms — so the rooms WITH a doorway are the
  // leading slice, and the HUD's room list is what covers the rest.
  const places = useMemo(() => doorPlacements(layout, others.length), [layout, others.length])
  const doors = useMemo(() => others.slice(0, places.length), [others, places.length])

  // Proximity, tested against the doorway the camera is actually closest to — with two
  // doorways side by side, "the first one within range" would latch onto the wrong one.
  const lastRef = useRef<string | null>(null)
  useFrame(() => {
    if (!doors.length) return
    let best: string | null = null
    let bestD = NEAR_DIST
    for (let i = 0; i < doors.length; i++) {
      const p = places[i]
      const d = Math.hypot(camera.position.x - p.pos.x, camera.position.z - p.pos.z)
      if (d < bestD) {
        bestD = d
        best = doors[i].slug
      }
    }
    if (best !== lastRef.current) {
      lastRef.current = best
      setNearRoom(best)
    }
  })

  // Unmounting (leaving the room, or the doorways going away) must not strand a stale
  // prompt in the HUD.
  useEffect(() => () => setNearRoom(null), [setNearRoom])

  if (!visitor || !doors.length) return null

  return (
    <>
      {doors.map((room, i) => (
        <Doorway
          key={room.slug}
          at={places[i].pos}
          rotY={places[i].rotY}
          theme={theme}
          active={nearRoomSlug === room.slug}
          onEnter={() => enterRoom(visitor.username, room)}
        />
      ))}
    </>
  )
}

/** Walk through to another room: a full navigation, which is what makes this cheap
 *  (the whole scene is rebuilt for the new room rather than swapped in place).
 *  The front-door room lives at `/@name`, everything else at `/@name/[slug]` — the
 *  same mapping `lib/seo.exhibitionPath` canonicalises to, so a doorway never links to
 *  a URL that redirects or duplicates. */
export function enterRoom(username: string, room: SiblingRoom): void {
  const path = room.isMain ? `/@${username}` : `/@${username}/${room.slug}`
  const embed = useGallery.getState().embed
  track('room_enter', { to: room.slug, main: room.isMain, embed })
  // Embedded, this gallery is a frame on somebody else's page: navigating it would
  // silently replace their embed with a different room. Same rule the rest of the HUD
  // follows for outbound links in an embed — open it, don't hijack the frame.
  if (embed) window.open(path, '_blank', 'noopener')
  else window.location.assign(path)
}
