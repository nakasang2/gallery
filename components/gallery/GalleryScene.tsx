'use client'
// Assembles the whole scene (applies theme/layout/exhibit list and bakes static shadows)
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { getNeutralEnvTexture } from './textures'
import { frameDefFor, HANGINGS, CAPTIONS, resolveLayout, resolveTheme, applyMat } from '@/lib/presets'
import { usePlacement, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor } from '@/lib/exhibition'
import { useSettings } from '@/lib/store'
import { LOW_POWER, QUALITY } from '@/lib/controller'
import Room from './Room'
import Exhibit, { exhibitExtents, exhibitLightRig, shadowPatch } from './Exhibit'
import WallShadowBaker, { type BakeSpec } from './WallShadowBaker'
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

  // Baked wall shadows (decision 2026-07-23 案C): each work's real silhouette
  // shadow is baked once into a small texture by WallShadowBaker, so no exhibit
  // spot ever needs castShadow — only the two bench downlights remain as live
  // shadow lights, far under the WebGL 16-texture-unit ceiling at any room size.
  const frameDefs = useMemo(
    () => list.map((art) => applyMat(frameDefFor(frameKeyFor(settings, art)), matKeyFor(settings, art))),
    [list, settings]
  )
  const lightMode = settings.designOverrides.lightMode ?? 'ceiling'
  const bakeSpecs = useMemo<BakeSpec[]>(
    () =>
      list.map((art, i) => {
        const slot = layout.slots[slots[i]]
        const { halfW, halfH } = exhibitExtents(art, frameDefs[i])
        const rig = exhibitLightRig(slot, lightMode, halfH, halfW)
        const patch = shadowPatch(halfW, halfH)
        return {
          id: art.id,
          slotX: slot.x,
          slotZ: slot.z,
          rotY: slot.rotY,
          patchW: patch.w,
          patchH: patch.h,
          patchOffsetY: patch.offsetY,
          lightPos: rig.position,
          target: rig.target,
          angle: rig.angle,
          penumbra: rig.penumbra,
          // The picture light's virtual emitter sits ~1.2m from its casters
          // (rig pulls it back off the lamp head) — still closer than the track
          near: lightMode === 'overhead' ? 0.1 : 0.5,
          // A close light throws a broader penumbra than a distant track
          softPx: lightMode === 'overhead' ? 12 : 9,
          // …and its pool still falls off faster, so the ambient floor sits a
          // bit lower or the shadow below the frame washes out
          ambient: lightMode === 'overhead' ? 0.22 : 0.35,
        }
      }),
    [list, slots, layout, frameDefs, lightMode]
  )
  // Fingerprint of everything that changes a baked silhouette: geometry/slot via
  // the spec numbers, PLUS hanging (ledge shelf casts) and caption (plaque casts).
  const bakeKey = useMemo(
    () =>
      bakeSpecs
        .map((s, i) => {
          const art = list[i]
          return `${s.id}:${s.slotX.toFixed(2)},${s.slotZ.toFixed(2)},${s.rotY.toFixed(3)},${s.patchW.toFixed(2)},${s.patchH.toFixed(2)},${s.angle},${hangingKeyFor(settings, art)},${captionKeyFor(settings, art)}`
        })
        .join('|'),
    [bakeSpecs, list, settings]
  )
  const [bakedShadows, setBakedShadows] = useState<Record<string, THREE.Texture>>({})
  useEffect(() => setBakedShadows({}), [bakeKey]) // composition changed → fall back to fakes while re-baking

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
          castRealShadow={false}
          bakedShadow={bakedShadows[art.id] ?? null}
          frameDef={frameDefs[i]}
          hangingDef={HANGINGS[hangingKeyFor(settings, art)] ?? HANGINGS.wire}
          captionDef={CAPTIONS[captionKeyFor(settings, art)] ?? CAPTIONS.side}
          lightMode={lightMode}
        />
      ))}
      {/* medium tier bakes too (its shadow pipeline is on); only low skips */}
      {QUALITY !== 'low' && (
        <WallShadowBaker
          specs={bakeSpecs}
          bakeKey={bakeKey}
          onBaked={(id, tex) => setBakedShadows((prev) => ({ ...prev, [id]: tex }))}
        />
      )}
      <TitleWall theme={theme} layout={layout} />
      <Dust layout={layout} />
      <WalkControls layout={layout} list={list} slots={slots} />
      <GhostVisitors />
      <VideoPlaybackManager />
      {!LOW_POWER && <Effects theme={theme} />}
    </>
  )
}
