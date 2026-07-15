'use client'
// Ambient past-visitor presence (§11.19): translucent silhouettes that wander the room,
// their number scaled by the gallery's cumulative visit count (social proof you can feel).
// Async, not realtime — no other-user data, just an aggregate count. Shown only to visitors
// on a public page, never to the owner-editor, and hidden while a work is focused.
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { useGallery, useSettings } from '@/lib/store'
import { resolveLayout, resolveTheme, EYE, type LayoutDef } from '@/lib/presets'
import { getSolids } from '@/lib/exhibition'
import { LOW_POWER } from '@/lib/controller'
import { ghostCountForVisits, MAX_GHOSTS } from '@/lib/ghosts'
import { galleryAudio } from '@/lib/audio'

interface Ghost {
  x: number
  z: number
  tx: number
  tz: number
  speed: number
  pause: number
  phase: number
}

// A soft human silhouette drawn once to a canvas → sprite alpha. Zero asset deps.
function makeSilhouetteTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const w = 128
  const h = 256
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')
  if (!c) return null
  c.fillStyle = '#fff'
  // Head
  c.beginPath()
  c.arc(w / 2, h * 0.16, w * 0.13, 0, Math.PI * 2)
  c.fill()
  // Neck + torso + legs as a rounded, slightly tapered body
  c.beginPath()
  c.moveTo(w * 0.34, h * 0.3)
  c.quadraticCurveTo(w * 0.28, h * 0.55, w * 0.33, h * 0.98)
  c.lineTo(w * 0.67, h * 0.98)
  c.quadraticCurveTo(w * 0.72, h * 0.55, w * 0.66, h * 0.3)
  c.quadraticCurveTo(w * 0.5, h * 0.24, w * 0.34, h * 0.3)
  c.fill()
  const tex = new THREE.CanvasTexture(cv)
  tex.needsUpdate = true
  return tex
}

function luminance(hex: number): number {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function pickTarget(layout: LayoutDef, solids: ReturnType<typeof getSolids>): [number, number] {
  // Loiter in front of a random artwork slot (pulled toward room centre), else a random
  // floor point — reads as "someone looking at the art".
  const slot = layout.slots[Math.floor(Math.random() * layout.slots.length)]
  let x: number
  let z: number
  if (slot && Math.random() < 0.75) {
    const inward = 1.4 + Math.random() * 0.8
    const nx = Math.sin(slot.rotY)
    const nz = Math.cos(slot.rotY)
    x = slot.x + nx * inward
    z = slot.z + nz * inward
  } else {
    x = (Math.random() * 2 - 1) * (layout.hw - 1)
    z = (Math.random() * 2 - 1) * (layout.hd - 1)
  }
  x = THREE.MathUtils.clamp(x, -layout.hw + 0.8, layout.hw - 0.8)
  z = THREE.MathUtils.clamp(z, -layout.hd + 0.8, layout.hd - 0.8)
  // Nudge out of benches / partitions so ghosts don't stand inside furniture
  for (const s of solids) {
    if (Math.abs(x - s.x) < s.hw + 0.5 && Math.abs(z - s.z) < s.hd + 0.5) {
      z = s.z + (z >= s.z ? 1 : -1) * (s.hd + 0.7)
    }
  }
  return [x, z]
}

export default function GhostVisitors() {
  const camera = useThree((s) => s.camera)
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
  const texture = useMemo(makeSilhouetteTexture, [])

  // Ghosts only for visitors on a public page (never the owner-editor), capped, off on
  // low-power devices where the extra draw calls aren't worth it.
  const count = visitor && !LOW_POWER ? ghostCountForVisits(visitor.visitCount) : 0
  const showing = count > 0 && !focused

  // Dark figures on light walls, light figures on dark walls — always a legible shadow.
  const color = useMemo(
    () => (luminance(theme.wall) > 0.5 ? new THREE.Color(0x2a2a30) : new THREE.Color(0xcfcfd6)),
    [theme.wall]
  )

  const solids = useMemo(() => getSolids(layout), [layout])
  const ghosts = useMemo<Ghost[]>(() => {
    return Array.from({ length: count }, () => {
      const [x, z] = pickTarget(layout, solids)
      const [tx, tz] = pickTarget(layout, solids)
      return { x, z, tx, tz, speed: 0.5 + Math.random() * 0.35, pause: 0, phase: Math.random() * Math.PI * 2 }
    })
  }, [count, layout, solids])

  const spriteRefs = useRef<(THREE.Sprite | null)[]>([])

  // Crowd murmur scales with how many ghosts are actually visible (0 when focused/none).
  useEffect(() => {
    galleryAudio.setCrowdLevel(showing ? count : 0, MAX_GHOSTS)
    return () => galleryAudio.setCrowdLevel(0)
  }, [showing, count])

  useFrame((_, delta) => {
    if (!showing) return
    const dt = Math.min(delta, 0.05)
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i]
      const spr = spriteRefs.current[i]
      if (!spr) continue
      if (g.pause > 0) {
        g.pause -= dt
      } else {
        const dx = g.tx - g.x
        const dz = g.tz - g.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.25) {
          // Arrived — dwell in front of the piece, then move on
          g.pause = 2 + Math.random() * 4
          ;[g.tx, g.tz] = pickTarget(layout, solids)
        } else {
          const step = Math.min(dist, g.speed * dt)
          g.x += (dx / dist) * step
          g.z += (dz / dist) * step
        }
      }
      g.phase += dt * 6
      const bob = g.pause > 0 ? 0 : Math.sin(g.phase) * 0.02
      spr.position.set(g.x, EYE - 0.72 + bob, g.z)
      // Fade with distance so a ghost right next to the camera doesn't loom
      const d = Math.hypot(g.x - camera.position.x, g.z - camera.position.z)
      const mat = spr.material as THREE.SpriteMaterial
      mat.opacity = 0.26 * THREE.MathUtils.clamp((d - 1.1) / 1.6, 0, 1)
    }
  })

  if (!texture || count === 0) return null

  return (
    <group visible={showing}>
      {ghosts.map((g, i) => (
        <sprite
          key={i}
          ref={(el) => {
            spriteRefs.current[i] = el
          }}
          position={[g.x, EYE - 0.72, g.z]}
          scale={[0.78, 1.72, 1]}
        >
          <spriteMaterial
            map={texture}
            color={color}
            transparent
            opacity={0.24}
            depthWrite={false}
            fog
          />
        </sprite>
      ))}
    </group>
  )
}
