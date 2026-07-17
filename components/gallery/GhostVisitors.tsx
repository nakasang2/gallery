'use client'
// Ambient past-visitor presence (§11.19). Translucent, wall-contrast-tinted human
// figures — a real rigged glTF character (public/models/visitor.glb) walking the room
// with its own walk/idle clips and pausing to face the art — their number scaled by the
// gallery's cumulative visit count. Async, not realtime: only an aggregate count, no
// other-user data. Rendered as soft monochrome silhouettes (textures dropped) so they
// read as a "presence", not a specific person, and identical instances don't look like
// clones. Visitor pages only; never the owner-editor, hidden while a work is focused,
// and off on low-power devices.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { useGallery, useSettings } from '@/lib/store'
import { resolveLayout, resolveTheme, type LayoutDef } from '@/lib/presets'
import { getSolids, usePlacement, type Solid } from '@/lib/exhibition'
import { LOW_POWER } from '@/lib/controller'
import { ghostCountForVisits, MAX_GHOSTS } from '@/lib/ghosts'
import { galleryAudio } from '@/lib/audio'

// The character is Draco-compressed; decode with the vendored local decoder (no CDN).
const MODEL_URL = '/models/visitor.glb'
useGLTF.setDecoderPath('/draco/')

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

type ArtSlot = LayoutDef['slots'][number]

function pickTarget(layout: LayoutDef, solids: Solid[], artSlots: ArtSlot[]): Target {
  // Mostly loiter in front of a random slot that ACTUALLY has a work (facing the wall) —
  // reads as "someone stopped to look" — else a random floor point to cross to. Only
  // occupied slots count, so nobody stops to stare at a blank wall or an empty inner face.
  const slot = artSlots.length ? artSlots[Math.floor(Math.random() * artSlots.length)] : null
  let x: number
  let z: number
  let face: number | null = null
  if (slot && Math.random() < 0.8) {
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
  speed: number
  timeScale: number
}

// The walk clip's own ground speed at timeScale 1 (measured from the foot bones:
// a planted foot travels back at ~1.44 m/s). Travel speed is derived from this so the
// feet stay locked to the floor — no moonwalking — whatever pace we pick.
const WALK_GROUND_SPEED = 1.44

function Ghost({
  layout,
  solids,
  baseColor,
  active,
  artSlots,
}: {
  layout: LayoutDef
  solids: Solid[]
  baseColor: THREE.Color
  active: boolean
  artSlots: ArtSlot[]
}) {
  const camera = useThree((s) => s.camera)
  const root = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF(MODEL_URL, '/draco/')

  // Per-instance clone (scene.clone() breaks skinned-mesh skeletons — must use
  // SkeletonUtils) rendered as a flat, uniform translucent silhouette tinted toward the
  // wall-contrast colour (textures dropped), so the crowd reads as soft presences, not a
  // row of identical businessmen.
  //
  // A naive transparent mesh double-blends everywhere the body's parts overlap along the
  // view ray (tie over shirt over torso, front over back) — those seams read darker. Fix
  // is a depth pre-pass: an opaque colour-masked twin of every skinned mesh writes depth
  // first, then the visible unlit material draws only the front-most fragment per pixel
  // (depthWrite off, so it never occludes the next figure). Result: every pixel is
  // blended exactly once → one even opacity, a true silhouette.
  const { model, mats } = useMemo(() => {
    const model = skeletonClone(scene)
    const c = baseColor.clone().multiplyScalar(0.82 + Math.random() * 0.32)
    const mat = new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.5,
      depthWrite: false, // don't occlude other ghosts / the room; the pre-pass handles self-occlusion
      depthTest: true,
    })
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false }) // depth-only pre-pass (opaque)

    const skinned: THREE.SkinnedMesh[] = []
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh
      if (sm.isMesh) {
        sm.material = mat
        sm.castShadow = false
        sm.receiveShadow = false
        sm.frustumCulled = false // skinned bounds jump around; don't let it cull mid-stride
        sm.renderOrder = 1
        if (sm.isSkinnedMesh) skinned.push(sm)
      }
    })
    // Add the depth twins after traversal (mutating the tree mid-traverse is unsafe)
    for (const sm of skinned) {
      const twin = new THREE.SkinnedMesh(sm.geometry, depthMat)
      twin.bind(sm.skeleton, sm.bindMatrix)
      twin.bindMode = sm.bindMode
      twin.frustumCulled = false
      twin.renderOrder = 0 // opaque pass anyway, but keep it explicit
      twin.position.copy(sm.position)
      twin.quaternion.copy(sm.quaternion)
      twin.scale.copy(sm.scale)
      sm.parent?.add(twin)
    }
    return { model, mats: [mat, depthMat] }
  }, [scene, baseColor])
  const mat = mats[0]
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats])

  // Two clips ship in the model: index 0 = walk (1.07s), 1 = idle (14.37s). Both play
  // always; a smoothed weight crossfades between them so starts/stops don't pop. Desync
  // the start times so a crowd isn't in lockstep.
  const { actions, names } = useAnimations(animations, root)
  const walkAction = useRef<THREE.AnimationAction | null>(null)
  const idleAction = useRef<THREE.AnimationAction | null>(null)
  useEffect(() => {
    const walk = actions[names[0]] ?? null
    const idle = actions[names[1]] ?? null
    walkAction.current = walk
    idleAction.current = idle
    if (idle) {
      idle.reset().play()
      idle.setEffectiveWeight(1)
      idle.time = Math.random() * idle.getClip().duration
    }
    if (walk) {
      walk.reset().play()
      walk.setEffectiveWeight(0)
      // Cadence is locked to this ghost's travel speed (speed = WALK_GROUND_SPEED * timeScale),
      // so the stride always matches the ground — brisk playback, but no foot-slide.
      walk.timeScale = stateRef.current?.timeScale ?? 1.35
      walk.time = Math.random() * walk.getClip().duration
    }
  }, [actions, names])

  const stateRef = useRef<GhostState | null>(null)
  if (!stateRef.current) {
    const start = pickTarget(layout, solids, artSlots)
    const t = pickTarget(layout, solids, artSlots)
    // Keep the brisk playback (~1.35) with a little per-ghost variety, and derive travel
    // speed from it so the feet stay planted at any pace.
    const timeScale = 1.35 * (0.92 + Math.random() * 0.16)
    stateRef.current = {
      x: start.x,
      z: start.z,
      tx: t.x,
      tz: t.z,
      tface: t.face,
      face: Math.random() * Math.PI * 2,
      pause: 0,
      timeScale,
      speed: WALK_GROUND_SPEED * timeScale,
    }
  }

  const walkWeight = useRef(0)

  useFrame((_, delta) => {
    const g = root.current
    const s = stateRef.current
    if (!active || !g || !s) return
    const dt = Math.min(delta, 0.05)
    let moving = false
    if (s.pause > 0) {
      // Dwelling in front of the piece it just reached — turn to face THAT art and hold.
      s.pause -= dt
      if (s.tface != null) s.face += shortAngle(s.tface - s.face) * Math.min(1, dt * 3)
      if (s.pause <= 0) {
        const nt = pickTarget(layout, solids, artSlots)
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
      }
    }
    g.position.set(s.x, 0, s.z) // feet-origin model sits on the floor; the clip does the bob
    g.rotation.y = s.face

    // Crossfade walk <-> idle on a smoothed weight so it eases rather than snaps
    walkWeight.current += ((moving ? 1 : 0) - walkWeight.current) * Math.min(1, dt * 8)
    const w = walkWeight.current
    if (walkAction.current) walkAction.current.setEffectiveWeight(w)
    if (idleAction.current) idleAction.current.setEffectiveWeight(1 - w)

    // Only fade when the camera is basically on top of one, so they stay legible otherwise
    const d = Math.hypot(s.x - camera.position.x, s.z - camera.position.z)
    mat.opacity = 0.5 * THREE.MathUtils.clamp((d - 0.7) / 0.8, 0, 1)
  })

  return (
    <group ref={root}>
      {/* contact shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} material={SHADOW_MAT}>
        <circleGeometry args={[0.34, 16]} />
      </mesh>
      <primitive object={model} />
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

  // The layout slots that actually hold a work — `slots[i]` is the slot index the i-th
  // exhibited piece hangs on. Ghosts only pause in front of these, so with just 2 works up
  // they never stop to stare at the empty walls (or an empty inner face).
  const { slots } = usePlacement()
  const artSlots = useMemo(
    () => slots.map((i) => layout.slots[i]).filter(Boolean),
    [slots, layout]
  )

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
    <Suspense fallback={null}>
      <group visible={showing}>
        {Array.from({ length: count }).map((_, i) => (
          <Ghost key={i} layout={layout} solids={solids} baseColor={baseColor} active={showing} artSlots={artSlots} />
        ))}
      </group>
    </Suspense>
  )
}

useGLTF.preload(MODEL_URL, '/draco/')
