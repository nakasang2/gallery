'use client'
// Assembles the whole scene (applies theme/layout/exhibit list and bakes static shadows)
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { getNeutralEnvTexture } from './textures'
import { frameDefFor, HANGINGS, CAPTIONS, resolveLayout, resolveTheme, applyMat } from '@/lib/presets'
import { usePlacement, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor } from '@/lib/exhibition'
import { useSettings } from '@/lib/store'
import { LOW_POWER, camPose } from '@/lib/controller'
import Room from './Room'
import Exhibit from './Exhibit'
import TitleWall from './TitleWall'
import Dust from './Dust'
import WalkControls from './WalkControls'
import GhostVisitors from './GhostVisitors'
import Effects from './Effects'
import { CONE_LAYER } from './LightCone'
import { VideoPlaybackManager } from './VideoArt'
import { getListener } from '@/lib/videohub'

export default function GalleryScene() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  // Attach the spatial-audio listener (ears) to the camera
  useEffect(() => {
    const listener = getListener()
    camera.add(listener)
    // Fake light shafts live on their own layer so the floor's reflection camera
    // (layer 0 only) skips them — the main camera still needs to opt in.
    camera.layers.enable(CONE_LAYER)
    // Prototype debugging
    ;(window as unknown as Record<string, unknown>).__scene = scene
    ;(window as unknown as Record<string, unknown>).__gl = gl
    ;(window as unknown as Record<string, unknown>).__camObj = camera
    return () => {
      camera.remove(listener)
    }
  }, [camera, scene])

  const settings = useSettings()
  // Falls back to chic when the published data key is outdated; layers this
  // room's Design Tools overrides (wall/floor/light colour) on top (§11.5/§11.8)
  const theme = resolveTheme(settings.theme, settings.designOverrides)
  const layout = resolveLayout(settings.layout, settings.layoutParams)
  const { list, slots } = usePlacement()

  // Real-shadow budget, assigned DYNAMICALLY to the works nearest the camera.
  // Every shadow-casting light costs one texture unit in every material shader
  // (WebGL guarantees only 16), so at most SHADOW_BUDGET exhibit spots cast at a
  // time — but which ones follows the visitor, so every work reads as shadowed
  // where it matters (up close). The count stays constant, so swapping members
  // reuses the same shader programs; only the maps re-bake (cheap, one frame).
  const SHADOW_BUDGET = 5
  const [shadowIdxs, setShadowIdxs] = useState<number[]>(() =>
    Array.from({ length: Math.min(SHADOW_BUDGET, list.length) }, (_, i) => i)
  )
  const shadowRef = useRef(shadowIdxs)
  const lastEval = useRef({ x: Infinity, z: Infinity })
  useFrame(() => {
    if (list.length <= SHADOW_BUDGET) return // everyone casts; nothing to rotate
    const dx = camPose.x - lastEval.current.x
    const dz = camPose.z - lastEval.current.z
    if (Number.isFinite(lastEval.current.x) && dx * dx + dz * dz < 2.25) return // re-evaluate every ~1.5m
    lastEval.current = { x: camPose.x, z: camPose.z }
    const next = list
      .map((_, i) => i)
      .sort((a, b) => {
        const sa = layout.slots[slots[a]]
        const sb = layout.slots[slots[b]]
        return (
          Math.hypot(sa.x - camPose.x, sa.z - camPose.z) -
          Math.hypot(sb.x - camPose.x, sb.z - camPose.z)
        )
      })
      .slice(0, SHADOW_BUDGET)
      .sort((a, b) => a - b)
    if (next.join() !== shadowRef.current.join()) {
      shadowRef.current = next
      setShadowIdxs(next)
    }
  })
  // Swapping which lights cast requires a re-bake (maps are static otherwise)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      gl.shadowMap.needsUpdate = true
    })
    return () => cancelAnimationFrame(id)
  }, [gl, shadowIdxs])

  // Environment map: faint room light reflects in the floor sheen and metal frame parts
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    // Rotationally symmetric gradient — NOT RoomEnvironment, whose one-sided hot
    // "window" painted a white sheen onto whichever wall/floor faced it
    const envTex = pmrem.fromEquirectangular(getNeutralEnvTexture()).texture
    scene.environment = envTex
    scene.environmentIntensity = 1.0
    pmrem.dispose()
    return () => {
      scene.environment = null
      envTex.dispose()
    }
  }, [gl, scene])

  // Background and fog (per-theme density gives atmospheric perspective)
  useEffect(() => {
    scene.background = new THREE.Color(theme.fog)
    scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity)
  }, [scene, theme])

  // The scene is static, so re-bake shadows only once when the composition changes.
  // Also force all materials to recompile: when swapping exhibits recreates shadowed
  // lights and the light count is unchanged, three reuses the program, and the type
  // mismatch between the old shadow sampler and the new shadow map wipes out rendering
  // (GL_INVALID_OPERATION: Mismatch between texture format and sampler type)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.material) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) m.needsUpdate = true
      })
      gl.shadowMap.needsUpdate = true
    })
    return () => cancelAnimationFrame(id)
  }, [gl, scene, settings.theme, settings.layout, settings.layoutParams, settings.frame, settings.mat, settings.hanging, settings.caption, settings.frameOverrides, settings.matOverrides, settings.hangingOverrides, settings.captionOverrides, settings.designOverrides, list])

  return (
    <>
      <Room theme={theme} layout={layout} />
      {list.map((art, i) => (
        <Exhibit
          key={art.id}
          art={art}
          index={i}
          slot={layout.slots[slots[i]]}
          theme={theme}
          castRealShadow={shadowIdxs.includes(i)}
          frameDef={applyMat(frameDefFor(frameKeyFor(settings, art)), matKeyFor(settings, art))}
          hangingDef={HANGINGS[hangingKeyFor(settings, art)] ?? HANGINGS.wire}
          captionDef={CAPTIONS[captionKeyFor(settings, art)] ?? CAPTIONS.side}
          lightMode={settings.designOverrides.lightMode ?? 'ceiling'}
        />
      ))}
      <TitleWall theme={theme} layout={layout} />
      <Dust layout={layout} />
      <WalkControls layout={layout} list={list} slots={slots} />
      <GhostVisitors />
      <VideoPlaybackManager />
      {!LOW_POWER && <Effects theme={theme} />}
    </>
  )
}
