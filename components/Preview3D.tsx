'use client'
// Real-3D preview for the dashboard: the SAME Exhibit component the room uses,
// hung on a themed wall inside a small on-demand canvas — frame bevel, spotlight,
// hanging hardware and name plaque are the actual renderer's output, not a mock.
// Loaded lazily (next/dynamic) so three.js never weighs down the dashboard itself.
import { useEffect } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { THEMES, frameDefFor, HANGINGS, CAPTIONS, CEIL_H, applyMat, type SlotDef } from '@/lib/presets'
import { artSize } from '@/lib/exhibition'
import Exhibit from '@/components/gallery/Exhibit'
import type { ArtworkData } from '@/lib/artworks'

const SLOT: SlotDef = { x: 0, z: 0, rotY: 0 }

// Frame the camera to the work: wide panoramas step back, portraits step in,
// side captions get breathing room on the right. The camera is fully owned
// here (no Canvas camera prop) — a straight-on, level view like a visitor's
function Rig({ art, captionKey }: { art: ArtworkData; captionKey: string }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const { width, height } = artSize(art.ratio)
    const side = (CAPTIONS[captionKey]?.place ?? 'side') === 'side'
    const halfW = width / 2 + 0.25 + (side ? 0.8 : 0)
    const halfH = height / 2 + 0.6 // frame bar + wire/ledge headroom
    const z = Math.min(4.8, Math.max(halfW * 1.9, halfH * 2.9, 2.7))
    camera.fov = 38
    camera.position.set(side ? 0.3 : 0, 1.58, z) // level with the art — no tilt
    camera.rotation.set(0, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [art, captionKey, camera, invalidate])
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
}: {
  art: ArtworkData
  /** Slot number shown on the name plate (NO. xx) */
  index?: number
  themeKey: string
  frameKey: string
  matKey?: string
  hangingKey: string
  captionKey: string
}) {
  const theme = THEMES[themeKey] ?? THEMES.chic
  const floor = new THREE.Color(theme.floorTint).multiply(new THREE.Color(0x9a7a55))
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.5]}
    >
      <color attach="background" args={[theme.fog]} />
      <Env />
      <Rig art={art} captionKey={captionKey} />
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
