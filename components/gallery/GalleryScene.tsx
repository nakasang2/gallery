'use client'
// Assembles the whole scene (applies theme/layout/exhibit list and bakes static shadows)
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { THEMES, LAYOUTS, FRAMES } from '@/lib/presets'
import { useExhibitionList, frameKeyFor } from '@/lib/exhibition'
import { useSettings } from '@/lib/store'
import { LOW_POWER } from '@/lib/controller'
import Room from './Room'
import Exhibit from './Exhibit'
import TitleWall from './TitleWall'
import Dust from './Dust'
import WalkControls from './WalkControls'
import Effects from './Effects'
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
    // Prototype debugging
    ;(window as unknown as Record<string, unknown>).__scene = scene
    ;(window as unknown as Record<string, unknown>).__gl = gl
    ;(window as unknown as Record<string, unknown>).__camObj = camera
    return () => {
      camera.remove(listener)
    }
  }, [camera, scene])

  const settings = useSettings()
  // Fall back in case the published data keys are outdated
  const theme = THEMES[settings.theme] ?? THEMES.chic
  const layout = LAYOUTS[settings.layout] ?? LAYOUTS.hall
  const list = useExhibitionList()

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
  }, [gl, scene, settings.theme, settings.layout, settings.frame, settings.frameOverrides, list])

  return (
    <>
      <Room theme={theme} layout={layout} />
      {list.map((art, i) => (
        <Exhibit
          key={art.id}
          art={art}
          index={i}
          slot={layout.slots[i]}
          theme={theme}
          frameDef={FRAMES[frameKeyFor(settings, art)]}
        />
      ))}
      <TitleWall theme={theme} layout={layout} />
      <Dust layout={layout} />
      <WalkControls layout={layout} list={list} />
      <VideoPlaybackManager />
      {!LOW_POWER && <Effects theme={theme} />}
    </>
  )
}
