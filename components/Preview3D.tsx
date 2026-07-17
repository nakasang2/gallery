'use client'
// Real-3D preview for the dashboard: the SAME Exhibit component the room uses,
// hung on a themed wall inside a small on-demand canvas — frame bevel, spotlight,
// hanging hardware and name plaque are the actual renderer's output, not a mock.
// Loaded lazily (next/dynamic) so three.js never weighs down the dashboard itself.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { resolveTheme, frameDefFor, HANGINGS, CAPTIONS, CEIL_H, applyMat, type SlotDef, type DesignOverrides } from '@/lib/presets'
import { artSize } from '@/lib/exhibition'
import Exhibit from '@/components/gallery/Exhibit'
import type { ArtworkData } from '@/lib/artworks'

const SLOT: SlotDef = { x: 0, z: 0, rotY: 0 }

// A 1.7 m human reference stands beside the art so its real size reads at a glance —
// a 30 cm sketch looks tiny next to it, a 1.6 m canvas nearly its height. The art centres
// at 1.62 m (eye level) whatever its size, so relative scale shows honestly.
const ART_CY = 1.62
const PERSON_TOP = 1.72
const PERSON_HALF_W = 0.28

function personX(art: ArtworkData): number {
  const { width } = artSize(art.ratio, art)
  return -(width / 2 + 0.5 + PERSON_HALF_W) // ~0.5 m clearance left of the art's edge
}

function luminance(hex: number): number {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function makePersonTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 140
  c.height = 440
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.beginPath() // head
  g.arc(70, 52, 30, 0, Math.PI * 2)
  g.fill()
  g.beginPath() // torso (shoulders → hips)
  g.moveTo(38, 96)
  g.quadraticCurveTo(70, 78, 102, 96)
  g.lineTo(96, 248)
  g.quadraticCurveTo(70, 262, 44, 248)
  g.closePath()
  g.fill()
  g.fillRect(30, 100, 12, 150) // arms
  g.fillRect(98, 100, 12, 150)
  g.fillRect(50, 244, 18, 188) // legs
  g.fillRect(72, 244, 18, 188)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  return t
}

function ScaleFigure({ art, wall }: { art: ArtworkData; wall: number }) {
  const color = luminance(wall) > 0.5 ? '#3b3b45' : '#c7c7d0'
  const tex = useMemo(() => makePersonTexture(color), [color])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[personX(art), PERSON_TOP / 2, 0.12]}>
      <planeGeometry args={[PERSON_HALF_W * 2, PERSON_TOP]} />
      <meshBasicMaterial map={tex} transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Fit BOTH the art and the human reference into view (no longer fit-to-art, which hid
// scale — a 60 cm and a 120 cm piece of the same ratio looked identical). Straight-on,
// level, camera fully owned here.
function Rig({ art }: { art: ArtworkData }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  useEffect(() => {
    const { width, height } = artSize(art.ratio, art)
    const px = personX(art)
    const artHalfW = width / 2
    const minX = Math.min(-artHalfW, px - PERSON_HALF_W)
    const maxX = Math.max(artHalfW, px + PERSON_HALF_W)
    const minY = 0
    const maxY = Math.max(PERSON_TOP, ART_CY + height / 2) + 0.12
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const spanX = maxX - minX + 0.5
    const spanY = maxY - minY + 0.3
    const fov = 40
    const t = Math.tan((fov * Math.PI) / 360)
    const aspect = size.width / Math.max(1, size.height)
    const dist = Math.max(spanY / 2 / t, spanX / 2 / (t * aspect), 2.4)
    camera.fov = fov
    camera.position.set(cx, cy, dist)
    camera.rotation.set(0, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [art, camera, invalidate, size])
  return null
}

// Same faint environment reflections as the room (floor sheen, metal frames)
function Env() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    scene.environmentIntensity = 0.3
    pmrem.dispose()
    return () => {
      scene.environment = null
      envTex.dispose()
    }
  }, [gl, scene])
  return null
}

// frameloop="demand" + async texture loads: poke the render loop for a few
// seconds after the art changes so the image pops in once it arrives
function SettleFrames({ artId }: { artId: string }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const tick = setInterval(invalidate, 250)
    const stop = setTimeout(() => clearInterval(tick), 4000)
    return () => {
      clearInterval(tick)
      clearTimeout(stop)
    }
  }, [artId, invalidate])
  return null
}

export default function Preview3D({
  art,
  index = 0,
  themeKey,
  frameKey,
  matKey,
  hangingKey,
  captionKey,
  designOverrides,
}: {
  art: ArtworkData
  /** Slot number shown on the name plate (NO. xx) */
  index?: number
  themeKey: string
  frameKey: string
  matKey?: string
  hangingKey: string
  captionKey: string
  /** Design Tools overrides (wall/floor/light colour) — same resolveTheme path
   *  the real room uses, so the preview reflects the edits live */
  designOverrides?: DesignOverrides | null
}) {
  const theme = resolveTheme(themeKey, designOverrides)
  const floor = new THREE.Color(theme.floorTint).multiply(new THREE.Color(0x9a7a55))
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.5]}
    >
      <color attach="background" args={[theme.fog]} />
      <Env />
      <Rig art={art} />
      <ScaleFigure art={art} wall={theme.wall} />
      <SettleFrames artId={art.id} />
      <ambientLight intensity={0.45} />
      <mesh position={[0, CEIL_H / 2, 0]} receiveShadow>
        <planeGeometry args={[9, CEIL_H]} />
        <meshStandardMaterial color={theme.wall} roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 2.75]} receiveShadow>
        <planeGeometry args={[9, 5.5]} />
        <meshStandardMaterial color={floor} roughness={0.85} metalness={0.05} />
      </mesh>
      <Exhibit
        art={art}
        index={index}
        slot={SLOT}
        theme={theme}
        frameDef={applyMat(frameDefFor(frameKey), matKey)}
        hangingDef={HANGINGS[hangingKey] ?? HANGINGS.wire}
        captionDef={CAPTIONS[captionKey] ?? CAPTIONS.side}
      />
    </Canvas>
  )
}
