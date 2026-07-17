'use client'
// Ambient past-visitor presence (§11.19). Translucent, wall-contrast-tinted human
// figures — a real rigged glTF character (public/models/visitor.glb) walking the room
// with its own walk/idle clips and pausing to face the art — their number scaled by the
// gallery's cumulative visit count. Async, not realtime: only an aggregate count, no
// other-user data. Rendered as soft monochrome silhouettes (textures dropped) so they
// read as a "presence", not a specific person, and identical instances don't look like
// clones. Visitor pages only; never the owner-editor, hidden while a work is focused,
// and off on low-power devices.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
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
import { fetchGhostConfig, GHOST_WALK_DEFAULT } from '@/lib/siteConfig'

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

// Steer toward the target while curving AROUND solid obstacles (benches, centre walls).
// Wall-follow steering: near the closest solid within a look-ahead, head mostly TANGENTIALLY
// (round the box on whichever side faces the target) with an outward push that grows as we
// close in, and only a little seek — so figures skirt partitions instead of clipping through
// them. Tuned + simulated so it never penetrates even at the top admin speed; the caller's
// stuck-watchdog handles the rare spot the figure can't reach (behind a wall's centre).
const GHOST_BODY = 0.4 // clearance half-width
const AVOID_LOOK = 1.2 // start steering this far from a box (≈1 m berth from the face)
function steerDir(px: number, pz: number, tx: number, tz: number, solids: Solid[]): { dx: number; dz: number } {
  let sdx = tx - px
  let sdz = tz - pz
  const dl = Math.hypot(sdx, sdz) || 1
  sdx /= dl
  sdz /= dl
  // the single closest threatening solid
  let bestOd = AVOID_LOOK
  let bnx = 0
  let bnz = 0
  let found = false
  for (const s of solids) {
    const mx = s.hw + GHOST_BODY
    const mz = s.hd + GHOST_BODY
    const cx = THREE.MathUtils.clamp(px, s.x - mx, s.x + mx)
    const cz = THREE.MathUtils.clamp(pz, s.z - mz, s.z + mz)
    const ox = px - cx
    const oz = pz - cz
    const od = Math.hypot(ox, oz)
    if (od >= bestOd) continue
    if (od > 1e-4) {
      bnx = ox / od
      bnz = oz / od
    } else {
      // inside the box — push out along the shallower penetration axis
      const penX = mx - Math.abs(px - s.x)
      const penZ = mz - Math.abs(pz - s.z)
      if (penX < penZ) {
        bnx = Math.sign(px - s.x) || 1
        bnz = 0
      } else {
        bnx = 0
        bnz = Math.sign(pz - s.z) || 1
      }
    }
    bestOd = od
    found = true
  }
  if (!found) return { dx: sdx, dz: sdz }
  // tangent along the box wall, on the side that still points toward the target
  let tanx = -bnz
  let tanz = bnx
  if (tanx * sdx + tanz * sdz < 0) {
    tanx = -tanx
    tanz = -tanz
  }
  const close = 1 - bestOd / AVOID_LOOK // 0 far … 1 touching
  let dx = tanx * 1.2 + bnx * (0.3 + 0.7 * close) + sdx * 0.4 * (1 - close)
  let dz = tanz * 1.2 + bnz * (0.3 + 0.7 * close) + sdz * 0.4 * (1 - close)
  const L = Math.hypot(dx, dz) || 1
  return { dx: dx / L, dz: dz / L }
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
  /** Closest we've come to the current target, and how long since it last improved —
   *  a watchdog so a figure that can't route to a spot (behind a wall's centre) gives up
   *  and picks a new one instead of circling forever. */
  bestDist: number
  stuckT: number
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
  walkSpeed,
}: {
  layout: LayoutDef
  solids: Solid[]
  baseColor: THREE.Color
  active: boolean
  artSlots: ArtSlot[]
  /** Admin-tunable travel speed (m/s); cadence locks to it */
  walkSpeed: number
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
    // Travel at the admin-set speed (± a little per-ghost variety), and set the clip's
    // timeScale so the stride matches the ground — feet stay planted at any speed.
    const pace = walkSpeed * (0.92 + Math.random() * 0.16)
    stateRef.current = {
      x: start.x,
      z: start.z,
      tx: t.x,
      tz: t.z,
      tface: t.face,
      face: Math.random() * Math.PI * 2,
      pause: 0,
      speed: pace,
      timeScale: pace / WALK_GROUND_SPEED,
      bestDist: Infinity,
      stuckT: 0,
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
        s.bestDist = Infinity
        s.stuckT = 0
      }
    } else {
      const dx = s.tx - s.x
      const dz = s.tz - s.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.25) {
        s.pause = 3 + Math.random() * 5 // arrived — stop and look at this piece
        s.bestDist = Infinity
      } else {
        moving = true
        // Curve around partitions/benches rather than walking straight through them
        const dir = steerDir(s.x, s.z, s.tx, s.tz, solids)
        const step = Math.min(dist, s.speed * dt)
        s.x += dir.dx * step
        s.z += dir.dz * step
        s.face += shortAngle(Math.atan2(dir.dx, dir.dz) - s.face) * Math.min(1, dt * 4)
        // Watchdog: if we're not getting any closer (circling a wall we can't round),
        // give up after a few seconds and pick a fresh target rather than orbit forever.
        if (dist < s.bestDist - 0.1) {
          s.bestDist = dist
          s.stuckT = 0
        } else {
          s.stuckT += dt
          if (s.stuckT > 5) {
            const nt = pickTarget(layout, solids, artSlots)
            s.tx = nt.x
            s.tz = nt.z
            s.tface = nt.face
            s.bestDist = Infinity
            s.stuckT = 0
          }
        }
      }
    }
    // Never let steering nudge a figure through the outer walls
    s.x = THREE.MathUtils.clamp(s.x, -layout.hw + 0.5, layout.hw - 0.5)
    s.z = THREE.MathUtils.clamp(s.z, -layout.hd + 0.5, layout.hd - 0.5)
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

  // Admin-tunable walk speed (site_config). Null until fetched — hold the figures until
  // it resolves so each spawns at the right pace (its per-ghost speed is set once, at
  // mount). The fetch is a single tiny row and resolves well before the glTF chunk.
  const [walkSpeed, setWalkSpeed] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetchGhostConfig()
      .then((c) => alive && setWalkSpeed(c.walkSpeed))
      .catch(() => alive && setWalkSpeed(GHOST_WALK_DEFAULT))
    return () => {
      alive = false
    }
  }, [])

  const count = visitor && !LOW_POWER && walkSpeed != null ? ghostCountForVisits(visitor.visitCount) : 0
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
          <Ghost
            key={i}
            layout={layout}
            solids={solids}
            baseColor={baseColor}
            active={showing}
            artSlots={artSlots}
            walkSpeed={walkSpeed ?? GHOST_WALK_DEFAULT}
          />
        ))}
      </group>
    </Suspense>
  )
}

useGLTF.preload(MODEL_URL, '/draco/')
