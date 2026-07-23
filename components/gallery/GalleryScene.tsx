'use client'
// Assembles the whole scene (applies theme/layout/exhibit list and bakes static shadows)
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { frameDefFor, HANGINGS, CAPTIONS, resolveLayout, resolveTheme, applyMat } from '@/lib/presets'
import { usePlacement, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor } from '@/lib/exhibition'
import { useSettings } from '@/lib/store'
import { LOW_POWER } from '@/lib/controller'
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

  // Environment map: faint room light reflects in the floor sheen and metal frame parts
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
