'use client'
// First-person movement and view control (drag / WASD / floor tap / joystick / artwork focus)
// Values updated every frame live in refs and stay off React's re-render path
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { EYE, type LayoutDef } from '@/lib/presets'
import { artSize, getSolids } from '@/lib/exhibition'
import { walkRef, camPose } from '@/lib/controller'
import { useGallery } from '@/lib/store'
import { galleryAudio } from '@/lib/audio'
import type { ArtworkData } from '@/lib/artworks'

interface Tween {
  t: number
  dur: number
  onUpdate: (t: number) => void
  onDone?: () => void
}

// Steering (auto-heading) turn rate at full input, radians per second
const TURN_SPEED = 2.0
// Below this many px of pointer travel it's a tap (click), above it's a drag.
// Must match the click guards in Exhibit/Room (e.delta) so there is no dead zone.
export const TAP_THRESHOLD = 10

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function shortestAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export default function WalkControls({
  layout,
  list,
  slots,
}: {
  layout: LayoutDef
  list: ArtworkData[]
  /** Physical slot index for each work in `list` (§11.13 manual placement) */
  slots: number[]
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const state = useRef({
    yaw: layout.entry.yaw,
    pitch: 0,
    keys: new Set<string>(),
    vel: new THREE.Vector3(),
    // Drag anywhere = floating stick: the press point becomes the stick centre,
    // dragging from it walks (vertical) and steers (horizontal)
    dragging: false,
    dragActive: false,
    // Two-finger vertical drag = explicit look up/down (tilt)
    tilting: false,
    // Preview mode (info panel open): a horizontal swipe steps between works
    // instead of walking — the mode only ends via the panel's close button
    previewDrag: false,
    swipeConsumed: false,
    startX: 0,
    startY: 0,
    dragX: 0,
    dragY: 0,
    // Walking feel (head bob and footsteps)
    bobPhase: 0,
    bobAmp: 0,
    lastPos: new THREE.Vector3(),
    stepDist: 0,
    introPlayed: false,
    // Which work the prev/next stepper is anchored to (-1 = free-walking).
    // Tracked here (not from the store) so rapid taps step correctly before the glide finishes.
    targetIndex: -1,
  })
  const tweens = useRef<Tween[]>([])

  // Metadata used to compute exhibit focus (position, normal, size)
  const exhibitsMeta = useMemo(
    () =>
      list.map((art, i) => {
        const slot = layout.slots[slots[i]]
        const { width, height } = artSize(art.ratio, art)
        const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY)
        return { center: new THREE.Vector3(slot.x, 1.62, slot.z), normal, width, height }
      }),
    [list, slots, layout]
  )
  const metaRef = useRef(exhibitsMeta)
  metaRef.current = exhibitsMeta
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const solidsRef = useRef(getSolids(layout))
  useEffect(() => {
    solidsRef.current = getSolids(layout)
  }, [layout])

  function cancelTweens() {
    tweens.current.length = 0
    // Any glide being cancelled means we're no longer anchored to a work
    state.current.targetIndex = -1
  }

  function clampToRoom(v: THREE.Vector3) {
    const { hw, hd } = layoutRef.current
    v.x = THREE.MathUtils.clamp(v.x, -hw + 1.0, hw - 1.0)
    v.z = THREE.MathUtils.clamp(v.z, -hd + 1.0, hd - 1.0)
    // Don't let the camera enter benches or central walls
    for (const b of solidsRef.current) {
      const inX = Math.abs(v.x - b.x) < b.hw + 0.35
      const inZ = Math.abs(v.z - b.z) < b.hd + 0.35
      if (inX && inZ) {
        const pushX = (b.hw + 0.35 - Math.abs(v.x - b.x)) * Math.sign(v.x - b.x || 1)
        const pushZ = (b.hd + 0.35 - Math.abs(v.z - b.z)) * Math.sign(v.z - b.z || 1)
        if (Math.abs(pushX) < Math.abs(pushZ)) v.x += pushX
        else v.z += pushZ
      }
    }
    return v
  }

  function tween(dur: number, onUpdate: (t: number) => void, onDone?: () => void) {
    tweens.current.push({ t: 0, dur, onUpdate, onDone })
  }

  function stopTourAndPanel() {
    const g = useGallery.getState()
    if (g.tourActive) g.setTourActive(false)
    if (g.focusedIndex >= 0) g.setFocused(-1)
  }

  function walkTo(point: THREE.Vector3) {
    // Preview mode is sticky: floor taps must not dismiss it (close button only)
    if (useGallery.getState().focusedIndex >= 0) return
    cancelTweens()
    const from = camera.position.clone()
    const to = clampToRoom(new THREE.Vector3(point.x, EYE, point.z))
    const dist = from.distanceTo(to)
    if (dist < 0.3) return
    useGallery.getState().setFocused(-1)
    // Auto-heading: turn to face the direction of travel as we walk there
    const heading = to.clone().sub(from)
    const targetYaw = Math.atan2(-heading.x, -heading.z)
    const fromYaw = state.current.yaw
    const dYaw = shortestAngle(targetYaw - fromYaw)
    tween(Math.min(2.2, 0.45 + dist * 0.22), (t) => {
      const k = easeInOut(t)
      camera.position.lerpVectors(from, to, k)
      // Finish the turn a little before arriving so we're already facing forward
      state.current.yaw = fromYaw + dYaw * Math.min(1, k * 1.8)
    })
  }

  function focusExhibit(i: number) {
    const ex = metaRef.current[i]
    if (!ex) return
    cancelTweens()
    state.current.targetIndex = i // anchor the stepper here (cancelTweens cleared it)

    // On phones the info panel is a bottom sheet; on wider screens it's a right drawer
    const isPhone = window.innerWidth <= 640
    // Distance that fits the whole frame on screen (pull back a bit on phones so the
    // lifted artwork clears the bottom sheet)
    const viewDist = Math.max(2.4, (ex.width + 0.3) * 2.0, (ex.height + 0.3) * 1.7) * (isPhone ? 1.18 : 1)
    // Right drawer: shift sideways to keep the artwork left of center. Bottom sheet: keep it centered.
    const side = new THREE.Vector3(ex.normal.z, 0, -ex.normal.x)
    const shift = isPhone ? 0 : viewDist * 0.2
    const to = clampToRoom(
      ex.center.clone().add(ex.normal.clone().multiplyScalar(viewDist)).add(side.multiplyScalar(shift))
    )
    to.y = EYE
    const from = camera.position.clone()

    // Orientation facing the wall head-on
    const targetYaw = Math.atan2(ex.normal.x, ex.normal.z)
    // Tilt down on phones so the artwork rises into the upper area above the bottom sheet
    const targetPitch = isPhone ? -0.26 : 0
    const fromYaw = state.current.yaw
    const fromPitch = state.current.pitch
    const dYaw = shortestAngle(targetYaw - fromYaw)

    tween(
      1.15,
      (t) => {
        const k = easeInOut(t)
        camera.position.lerpVectors(from, to, k)
        state.current.yaw = fromYaw + dYaw * k
        state.current.pitch = fromPitch + (targetPitch - fromPitch) * k
      },
      () => useGallery.getState().setFocused(i)
    )
  }

  // Index of the work whose center is closest to the camera on the floor plane
  function nearestIndex() {
    const meta = metaRef.current
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < meta.length; i++) {
      const dx = meta[i].center.x - camera.position.x
      const dz = meta[i].center.z - camera.position.z
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  // One action = glide to the next/previous work AND face it (reuses focusExhibit).
  // From free-walking, the first step goes to the nearest work.
  function focusStep(dir: number) {
    const meta = metaRef.current
    if (!meta.length) return
    useGallery.getState().setTourActive(false)
    const cur = state.current.targetIndex
    const i = cur < 0 ? nearestIndex() : (cur + dir + meta.length) % meta.length
    focusExhibit(i)
  }

  function resetToEntry() {
    cancelTweens()
    const entry = layoutRef.current.entry
    camera.position.set(entry.x, EYE, entry.z)
    state.current.yaw = entry.yaw
    state.current.pitch = 0

    // On the first time only, a slow walk-in from the entrance
    if (!state.current.introPlayed) {
      state.current.introPlayed = true
      const dir = new THREE.Vector3(-Math.sin(entry.yaw), 0, -Math.cos(entry.yaw))
      const from = clampToRoom(camera.position.clone().addScaledVector(dir, -1.3))
      const to = camera.position.clone()
      camera.position.copy(from)
      tween(2.4, (t) => {
        camera.position.lerpVectors(from, to, easeInOut(t))
      })
    }
  }

  // Expose so the UI (panel, tour, joystick) can call it
  useEffect(() => {
    walkRef.current = { focusExhibit, focusStep, walkTo, cancel: cancelTweens, resetToEntry }
    return () => {
      walkRef.current = null
    }
  })

  // On layout change, return to the entry position (including first mount)
  useEffect(() => {
    resetToEntry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  // Pointer (drag anywhere = floating stick) and keyboard
  useEffect(() => {
    const el = gl.domElement
    const s = state.current

    // Visual affordance for the invisible stick: a ring at the press point with a
    // knob that follows the drag (DOM overlay — imperative, no React re-renders)
    const stick = document.createElement('div')
    stick.className = 'drag-stick'
    const knob = document.createElement('div')
    knob.className = 'drag-stick-knob'
    stick.appendChild(knob)
    document.body.appendChild(stick)

    const pointers = new Map<number, { x: number; y: number }>()

    const hideStick = () => {
      stick.classList.remove('on')
      knob.style.transform = ''
    }

    const onPointerDown = (e: PointerEvent) => {
      const preview = useGallery.getState().focusedIndex >= 0
      // Preview mode: drags become swipes, they must not end the tour or the panel
      if (!preview) useGallery.getState().setTourActive(false)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // Ignore when pointerId is invalid, e.g. for synthetic events
      }
      if (pointers.size >= 2) {
        // Second finger switches from walking to tilting
        s.dragging = false
        s.dragActive = false
        s.previewDrag = false
        s.dragX = 0
        s.dragY = 0
        s.tilting = true
        hideStick()
        return
      }
      if (preview) {
        s.previewDrag = true
        s.swipeConsumed = false
        s.dragging = false
        s.startX = e.clientX
        s.startY = e.clientY
        return
      }
      s.dragging = true
      s.dragActive = false
      s.startX = e.clientX
      s.startY = e.clientY
      s.dragX = 0
      s.dragY = 0
      el.style.cursor = 'grabbing'
    }
    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (s.tilting && p) {
        // Two-finger vertical drag: look up / down
        s.pitch = THREE.MathUtils.clamp(s.pitch + (p.y - e.clientY) * 0.005, -1.15, 1.15)
        p.x = e.clientX
        p.y = e.clientY
        return
      }
      if (p) {
        p.x = e.clientX
        p.y = e.clientY
      }
      // Preview swipe: a clear horizontal gesture steps to the next/previous work
      // (once per gesture); the panel stays open the whole time
      if (s.previewDrag && !s.swipeConsumed) {
        const dx = e.clientX - s.startX
        const dy = e.clientY - s.startY
        if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          s.swipeConsumed = true
          focusStep(dx < 0 ? 1 : -1)
        }
        return
      }
      if (!s.dragging) return
      const dx = e.clientX - s.startX
      const dy = e.clientY - s.startY
      const R = 70 // px of drag for full speed
      s.dragX = THREE.MathUtils.clamp(dx / R, -1, 1)
      s.dragY = THREE.MathUtils.clamp(dy / R, -1, 1)
      // Once it's clearly a drag (not a tap), take over from any glide/tour/panel
      if (!s.dragActive && Math.hypot(dx, dy) > TAP_THRESHOLD) {
        s.dragActive = true
        cancelTweens()
        stopTourAndPanel()
        stick.style.left = `${s.startX}px`
        stick.style.top = `${s.startY}px`
        stick.classList.add('on')
      }
      if (s.dragActive) knob.style.transform = `translate(${s.dragX * 34}px, ${s.dragY * 34}px)`
    }
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) s.tilting = false
      if (pointers.size > 0) return
      s.dragging = false
      s.dragActive = false
      s.previewDrag = false
      s.swipeConsumed = false
      s.dragX = 0
      s.dragY = 0
      el.style.cursor = ''
      hideStick()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore while typing anywhere editable (settings inputs, guestbook/bio textareas, …)
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        // Preview mode is sticky: sideways keys page through works, the rest do
        // nothing — walking out of the mode is reserved for the close button
        if (useGallery.getState().focusedIndex >= 0) {
          if (k === 'a' || k === 'arrowleft') focusStep(-1)
          if (k === 'd' || k === 'arrowright') focusStep(1)
          return
        }
        s.keys.add(k)
        cancelTweens()
        stopTourAndPanel()
      }
      if (k === 'escape') {
        const g = useGallery.getState()
        g.setFocused(-1)
        g.setSettingsOpen(false)
      }
      // Step through the exhibition (move + face the next/previous work)
      if (k === '.' || k === '>') focusStep(1)
      if (k === ',' || k === '<') focusStep(-1)
    }
    const onKeyUp = (e: KeyboardEvent) => s.keys.delete(e.key.toLowerCase())

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      stick.remove()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const s = state.current

    // Tweens
    for (let i = tweens.current.length - 1; i >= 0; i--) {
      const tw = tweens.current[i]
      tw.t += dt
      const t = Math.min(1, tw.t / tw.dur)
      tw.onUpdate(t)
      if (t >= 1) {
        tweens.current.splice(i, 1)
        tw.onDone?.()
      }
    }

    // Steer-based movement (auto-heading): forward walks along the facing,
    // left/right turns the view so you're always facing where you go.
    let forward =
      (s.keys.has('w') || s.keys.has('arrowup') ? 1 : 0) - (s.keys.has('s') || s.keys.has('arrowdown') ? 1 : 0)
    let turn =
      (s.keys.has('d') || s.keys.has('arrowright') ? 1 : 0) - (s.keys.has('a') || s.keys.has('arrowleft') ? 1 : 0)
    if (s.dragActive) {
      // Drag anywhere: vertical walks, horizontal steers (invisible floating stick)
      forward += -s.dragY
      turn += s.dragX
    }
    forward = THREE.MathUtils.clamp(forward, -1, 1)
    turn = THREE.MathUtils.clamp(turn, -1, 1)
    if (turn) s.yaw -= turn * TURN_SPEED * dt
    if (forward) {
      const dir = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw))
      s.vel.lerp(dir.multiplyScalar(forward * 3.1), 1 - Math.pow(0.0008, dt))
    } else {
      s.vel.lerp(new THREE.Vector3(), 1 - Math.pow(0.0001, dt))
    }
    // Explicit tilt: Q looks up, E looks down (two-finger drag does the same on touch)
    const tilt = (s.keys.has('q') ? 1 : 0) - (s.keys.has('e') ? 1 : 0)
    if (tilt) s.pitch = THREE.MathUtils.clamp(s.pitch + tilt * dt * 1.1, -1.15, 1.15)
    // While moving, gently level the view (clears the phone focus tilt once you walk off) —
    // unless the user is deliberately tilting right now
    if ((forward || turn) && !tilt && !s.tilting) s.pitch += (0 - s.pitch) * Math.min(1, dt * 2.5)
    if (s.vel.lengthSq() > 1e-6) {
      camera.position.addScaledVector(s.vel, dt)
      clampToRoom(camera.position)
    }

    // Walking feel: derive head bob and footsteps from actual movement (applies to keys/tap/tour alike)
    const moved = Math.hypot(camera.position.x - s.lastPos.x, camera.position.z - s.lastPos.z)
    s.lastPos.copy(camera.position)
    const speed = dt > 0 ? moved / dt : 0
    const targetAmp = THREE.MathUtils.clamp(speed / 3.1, 0, 1)
    s.bobAmp += (targetAmp - s.bobAmp) * Math.min(1, dt * 8)
    if (s.bobAmp > 0.02) s.bobPhase += dt * (7.5 + speed * 1.2)
    camera.position.y = EYE + Math.sin(s.bobPhase) * 0.02 * s.bobAmp

    // Footsteps for on-foot movement (keys / joystick / floor-tap walk). Suppressed during an
    // artwork-focus or tour glide (targetIndex >= 0): those slide the camera fast to inspect a
    // piece and would patter like a sprint. A longer stride = a calmer, slower walking pace.
    const focusGlide = tweens.current.length > 0 && state.current.targetIndex >= 0
    if (!focusGlide) {
      s.stepDist += moved
      if (s.stepDist > 1.15 && speed > 0.4) {
        s.stepDist = 0
        galleryAudio.step(targetAmp)
      }
    } else {
      s.stepDist = 0 // don't let distance pile up mid-glide and dump a burst when it ends
    }

    camera.rotation.set(s.pitch, s.yaw, 0)

    // Publish the pose for the minimap
    camPose.x = camera.position.x
    camPose.z = camera.position.z
    camPose.yaw = s.yaw
  })

  return null
}
