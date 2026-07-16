'use client'
// Ambient past-visitor presence (§11.19). Low-poly articulated figures (built from
// primitives — zero asset deps) that walk the room with a procedural gait and pause to
// face the art, their number scaled by the gallery's cumulative visit count. Async, not
// realtime — only an aggregate count, no other-user data. Visitor pages only; never the
// owner-editor, hidden while a work is focused, and off on low-power devices.
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { useGallery, useSettings } from '@/lib/store'
import { resolveLayout, resolveTheme, type LayoutDef } from '@/lib/presets'
import { getSolids, usePlacement, type Solid } from '@/lib/exhibition'
import { LOW_POWER } from '@/lib/controller'
import { ghostCountForVisits, MAX_GHOSTS, pickWeightedSlot, type SlotWeight } from '@/lib/ghosts'
import { galleryAudio } from '@/lib/audio'

// One shared, faint contact shadow so the figures read as grounded (the room's baked
// shadows don't cover moving objects, and per-frame shadow maps would be too costly).
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false })

function luminance(hex: number): number {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function shortAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

interface Target {
  x: number
  z: number
  /** Heading to adopt on arrival (facing the art), or null for a floor spot */
  face: number | null
}

function pickTarget(layout: LayoutDef, solids: Solid[], slots: SlotWeight[]): Target {
  // Mostly loiter in front of an artwork slot (chosen ∝ popularity), facing the wall —
  // reads as "someone stopped to look" — else a random floor point to cross to.
  const slotIdx = Math.random() < 0.82 ? pickWeightedSlot(slots) : null
  let x: number
  let z: number
  let face: number | null = null
  const slot = slotIdx != null ? layout.slots[slotIdx] : undefined
  if (slot) {
    const inward = 1.5 + Math.random() * 0.7
    x = slot.x + Math.sin(slot.rotY) * inward
    z = slot.z + Math.cos(slot.rotY) * inward
    face = slot.rotY + Math.PI // look back toward the wall the piece hangs on
  } else {
    x = (Math.random() * 2 - 1) * (layout.hw - 1)
    z = (Math.random() * 2 - 1) * (layout.hd - 1)
  }
  x = THREE.MathUtils.clamp(x, -layout.hw + 0.8, layout.hw - 0.8)
  z = THREE.MathUtils.clamp(z, -layout.hd + 0.8, layout.hd - 0.8)
  for (const s of solids) {
    if (Math.abs(x - s.x) < s.hw + 0.5 && Math.abs(z - s.z) < s.hd + 0.5) {
      z = s.z + (z >= s.z ? 1 : -1) * (s.hd + 0.7)
    }
  }
  return { x, z, face }
}

interface GhostState {
  x: number
  z: number
  tx: number
  tz: number
  tface: number | null
  face: number
  pause: number
  phase: number
  speed: number
}

function Ghost({
  layout,
  solids,
  slots,
  baseColor,
  active,
}: {
  layout: LayoutDef
  solids: Solid[]
  slots: SlotWeight[]
  baseColor: THREE.Color
  active: boolean
}) {
  const camera = useThree((s) => s.camera)
  const root = useRef<THREE.Group>(null)
  const upper = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)

  // One material per figure (slight per-ghost tint so a crowd isn't clones), shared by
  // all its parts. Semi-solid: embodied but a touch translucent, so it fades if you walk
  // right into one instead of looming.
  const mat = useMemo(() => {
    const c = baseColor.clone().multiplyScalar(0.82 + Math.random() * 0.32)
    return new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.96,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
      depthWrite: true,
    })
  }, [baseColor])
  useEffect(() => () => mat.dispose(), [mat])

  // Keep the latest weighted slots in a ref so useFrame always picks against current
  // popularity without re-subscribing the frame loop.
  const slotsRef = useRef(slots)
  slotsRef.current = slots

  const stateRef = useRef<GhostState | null>(null)
  if (!stateRef.current) {
    const start = pickTarget(layout, solids, slots)
    const t = pickTarget(layout, solids, slots)
    stateRef.current = {
      x: start.x,
      z: start.z,
      tx: t.x,
      tz: t.z,
      tface: t.face,
      face: Math.random() * Math.PI * 2,
      // Start walking (not dwelling), so the first thing they do is head to a piece —
      // avoids a spawn frame where they'd face a target they aren't standing at yet.
      pause: 0,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.3,
    }
  }

  useFrame((_, delta) => {
    const g = root.current
    const s = stateRef.current
    if (!active || !g || !s) return
    const dt = Math.min(delta, 0.05)
    let moving = false
    if (s.pause > 0) {
      // Dwelling in front of the piece it just reached — turn to face THAT art (tface is
      // still the arrived target's heading) and hold, then pick the next spot when done.
      s.pause -= dt
      if (s.tface != null) s.face += shortAngle(s.tface - s.face) * Math.min(1, dt * 3)
      if (s.pause <= 0) {
        const nt = pickTarget(layout, solids, slotsRef.current)
        s.tx = nt.x
        s.tz = nt.z
        s.tface = nt.face
      }
    } else {
      const dx = s.tx - s.x
      const dz = s.tz - s.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.25) {
        s.pause = 3 + Math.random() * 5 // arrived — stop and look at this piece
      } else {
        moving = true
        const step = Math.min(dist, s.speed * dt)
        s.x += (dx / dist) * step
        s.z += (dz / dist) * step
        s.face += shortAngle(Math.atan2(dx, dz) - s.face) * Math.min(1, dt * 4)
        s.phase += dt * s.speed * 6.2
      }
    }
    g.position.set(s.x, moving ? Math.abs(Math.sin(s.phase)) * 0.015 : 0, s.z)
    g.rotation.y = s.face
    // Gait: legs swing opposite each other, arms counter to the legs; limbs ease to rest
    // when standing.
    // Lean the upper body toward the piece while dwelling in front of it — the readable
    // "stopped to look at the art" cue (the figure is otherwise near front/back symmetric).
    if (upper.current) {
      const lean = s.pause > 0 && s.tface != null ? 0.16 : 0
      upper.current.rotation.x += (lean - upper.current.rotation.x) * Math.min(1, dt * 3)
    }
    const legSwing = moving ? Math.sin(s.phase) * 0.5 : 0
    const armSwing = moving ? Math.sin(s.phase) * 0.38 : 0
    if (legL.current) legL.current.rotation.x = legSwing
    if (legR.current) legR.current.rotation.x = -legSwing
    if (armL.current) armL.current.rotation.x = -armSwing
    if (armR.current) armR.current.rotation.x = armSwing
    // Only fade when the camera is basically on top of one, so they stay solid otherwise
    const d = Math.hypot(s.x - camera.position.x, s.z - camera.position.z)
    mat.opacity = 0.85 * THREE.MathUtils.clamp((d - 0.7) / 0.8, 0, 1)
  })

  return (
    <group ref={root}>
      {/* contact shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} material={SHADOW_MAT}>
        <circleGeometry args={[0.34, 16]} />
      </mesh>
      {/* legs (pivot at hip) */}
      <group ref={legL} position={[-0.1, 0.8, 0]}>
        <mesh position={[0, -0.4, 0]} material={mat}>
          <cylinderGeometry args={[0.075, 0.06, 0.8, 6]} />
        </mesh>
      </group>
      <group ref={legR} position={[0.1, 0.8, 0]}>
        <mesh position={[0, -0.4, 0]} material={mat}>
          <cylinderGeometry args={[0.075, 0.06, 0.8, 6]} />
        </mesh>
      </group>
      {/* upper body — pivots at the hips so it can lean toward the art. Children are
          rebased by -0.85 in y so their world heights are unchanged. */}
      <group ref={upper} position={[0, 0.85, 0]}>
        {/* torso */}
        <mesh position={[0, 0.23, 0]} material={mat}>
          <boxGeometry args={[0.34, 0.56, 0.19]} />
        </mesh>
        {/* arms (pivot at shoulder) */}
        <group ref={armL} position={[-0.21, 0.47, 0]}>
          <mesh position={[0, -0.28, 0]} material={mat}>
            <cylinderGeometry args={[0.05, 0.045, 0.58, 6]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.21, 0.47, 0]}>
          <mesh position={[0, -0.28, 0]} material={mat}>
            <cylinderGeometry args={[0.05, 0.045, 0.58, 6]} />
          </mesh>
        </group>
        {/* head — nudged forward so the figure reads as having a front (a facing) */}
        <mesh position={[0, 0.71, 0.04]} material={mat}>
          <sphereGeometry args={[0.12, 12, 10]} />
        </mesh>
      </group>
    </group>
  )
}

export default function GhostVisitors() {
  const visitor = useGallery((s) => s.visitor)
  const focused = useGallery((s) => s.focusedIndex) >= 0
  const settings = useSettings()

  const layout = useMemo(
    () => resolveLayout(settings.layout, settings.layoutParams),
    [settings.layout, settings.layoutParams]
  )
  const theme = useMemo(
    () => resolveTheme(settings.theme, settings.designOverrides),
    [settings.theme, settings.designOverrides]
  )
  const solids = useMemo(() => getSolids(layout), [layout])

  // Attention heatmap (§11.19.2): the figures visit hung works weighted by likes, so a
  // crowd gathers at the most-liked pieces. Empty slots aren't targets. sqrt keeps a very
  // popular work attractive without monopolising the whole (small) crowd; no likes → all
  // weights 1 → uniform, i.e. the plain wander.
  const placement = usePlacement()
  const slots = useMemo<SlotWeight[]>(() => {
    const likes = visitor?.likeCounts ?? {}
    return placement.list.map((art, i) => ({
      slot: placement.slots[i],
      weight: 1 + Math.sqrt(likes[art.id] ?? 0) * 1.6,
    }))
  }, [placement, visitor?.likeCounts])

  const count = visitor && !LOW_POWER ? ghostCountForVisits(visitor.visitCount) : 0
  const showing = count > 0 && !focused

  // Dark figures on light walls, pale on dark walls — always legible, lit by the room.
  const baseColor = useMemo(
    () => (luminance(theme.wall) > 0.5 ? new THREE.Color(0x3a3a44) : new THREE.Color(0xb9b9c4)),
    [theme.wall]
  )

  // Crowd murmur scales with how many figures are actually present (0 when focused/none).
  useEffect(() => {
    galleryAudio.setCrowdLevel(showing ? count : 0, MAX_GHOSTS)
    return () => galleryAudio.setCrowdLevel(0)
  }, [showing, count])

  if (count === 0) return null

  return (
    <group visible={showing}>
      {Array.from({ length: count }).map((_, i) => (
        <Ghost key={i} layout={layout} solids={solids} slots={slots} baseColor={baseColor} active={showing} />
      ))}
    </group>
  )
}
