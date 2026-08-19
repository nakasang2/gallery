'use client'
// Assembles the whole scene (applies theme/layout/exhibit list and bakes static shadows)
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { getNeutralEnvTexture } from './textures'
import { useThemeAtmosphere } from './atmosphere'
import { frameDefFor, HANGINGS, CAPTIONS, resolveLayout, resolveTheme, applyMat } from '@/lib/presets'
import { usePlacement, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor, lightModeFor } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'
import { bakeMatches } from '@/lib/shadowBake'
import { LOW_POWER, QUALITY } from '@/lib/controller'
import { PERF } from '@/lib/perfFlags'
import Room from './Room'
import Exhibit from './Exhibit'
import WallShadowBaker, { tileUvOf, type BakedShadow } from './WallShadowBaker'
import LightmapBaker, { type LightAtlas } from './LightmapBaker'
import { SpotPoolProvider } from './SpotPool'
import { buildBakePlan } from './bakePlan'
import { buildLightPlan } from './lightPlan'
import { useDoorway } from './doorway'
import TitleWall from './TitleWall'
import RoomPortals from './RoomPortals'
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
  // 焼く対象と指紋は **`buildBakePlan` の1本だけ**が決める。出展時に焼く側
  // （`ShadowBakeRunner`）が同じ関数を通るので、保存した控えが必ずここと一致する
  // ── 別々に導出すると、作家が焼いた控えを来場者が毎回「古い」と捨てる。
  const plan = useMemo(
    () => buildBakePlan(settings, list, slots, layout),
    [settings, list, slots, layout]
  )
  const bakeSpecs = plan.specs
  const bakeKey = plan.key

  // id → the room's bake atlas plus the tile inside it that holds this work's
  // shadow. Every entry points at the SAME texture (one image per room).
  // 出展時に焼いて保存しておいたアトラス（migration 0067）。**指紋が今の構成と一致すれば、
  // 来場者は焼かずにこの1枚を読むだけ** ── 入場が速くなり、焼けない端末（`QUALITY === 'low'`）
  // にも初めて本物の影が出る（DECISIONS 2026-08-18 ①）。一致しなければ今までどおり焼く。
  const savedBake = useGallery((s) => s.visitor?.shadowBake ?? null)
  const useSaved = useMemo(
    () => bakeMatches(savedBake, bakeKey, bakeSpecs.map((sp) => sp.id)),
    [savedBake, bakeKey, bakeSpecs]
  )
  // 部屋の光の焼き込み（照明の焼き込み ②・DECISIONS 2026-08-19）。壁・床・間仕切りは
  // これ1枚で明るさが決まるようになる。**影と違って保存しない**（1フレームで焼けるので、
  // 保存の仕組みを増やす理由が無い。`LightmapBaker` の冒頭に理由を書いた）。
  const door = useDoorway(layout)
  const lightPlan = useMemo(
    () => buildLightPlan(theme, layout, door, settings, list, slots),
    [theme, layout, door, settings, list, slots]
  )
  const [lightmap, setLightmap] = useState<LightAtlas | null>(null)
  // 焼き直しの合図。**古い1枚を貼ったままにしない** ── 構成が変わると面の詰め方も変わるので、
  // 前の区画を読み続けると壁に別の壁の光が乗る（画面は壊れないので気づけない）。
  const shownLightKey = useRef(lightPlan.key)
  if (shownLightKey.current !== lightPlan.key) {
    shownLightKey.current = lightPlan.key
    setLightmap(null)
  }

  const [bakedShadows, setBakedShadows] = useState<Record<string, BakedShadow>>({})
  // Cleared during render, not in an effect: the baker drops the old atlas the
  // moment the work count changes, and an effect would leave the exhibits holding
  // a disposed texture for one frame.
  const shownKey = useRef(bakeKey)
  if (shownKey.current !== bakeKey) {
    shownKey.current = bakeKey
    setBakedShadows({}) // composition changed → draw no shadow while re-baking
  }

  // 保存済みアトラスの読み込み。**焼く器と同じ `tileUvOf` を通す** ── 区画の出し方が
  // 少しでも違うと、どの作品も隣の影を薄く覗かせる。
  useEffect(() => {
    if (!useSaved || !savedBake) return
    let alive = true
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous') // CDN は読み取りを `*` で許可している（DECISIONS 2026-07-27）
    const tex = loader.load(
      savedBake.url,
      () => {
        if (!alive) return
        const next: Record<string, BakedShadow> = {}
        savedBake.ids.forEach((id, i) => {
          next[id] = { tex, tile: tileUvOf(i, savedBake.cols, savedBake.rows, savedBake.tile) }
        })
        setBakedShadows(next)
      },
      // 読めなかったら何もしない = 影なしのまま。焼き直しに落とさないのは、
      // 「一致しているのに読めない」は一時的な事故（CDN・回線）で、次の入場で直るため。
      () => {}
    )
    // **上下を反転させない。** ここが焼き込みで一番間違いやすい。焼いた画像は
    // `readRenderTargetPixels` の順（GLの下から上）そのままで書き出してあり、
    // レンダーターゲットのテクスチャは `flipY` を無視する（`isRenderTargetTexture`）。
    // 一方、画像から読んだテクスチャは既定で `flipY = true` ＝**アップロード時に上下を
    // 返す**ので、そのままだと**影が上下逆に貼られる**（額の上に影が落ちる絵になる）。
    // 焼いた側と同じ向きにするために明示的に false にする。
    tex.flipY = false
    // レンダーターゲットと同じ扱いに揃える: ミップマップを作らせない。
    // 作ると縮小レベルで**隣の区画と混ざり**、遠くの作品の影に別の作品の輪郭が滲む。
    tex.generateMipmaps = false
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    return () => {
      alive = false
      tex.dispose()
    }
  }, [useSaved, savedBake])

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

  // Background and fog (per-theme density gives atmospheric perspective).
  // ダッシュボードのテーマプレビューと同じ1か所を通す（./atmosphere）
  useThemeAtmosphere(theme)

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
  }, [gl, scene, settings.theme, settings.layout, settings.layoutParams, settings.frame, settings.mat, settings.hanging, settings.caption, settings.frameOverrides, settings.matOverrides, settings.hangingOverrides, settings.captionOverrides, settings.lightOverrides, settings.designOverrides, list])

  return (
    // 作品スポットは実体を持たず、共有プール（シーン直下の6灯）を近い順に借りる。
    // **`Exhibit` を囲っていないとプールが見つからず、各作品が自前の実照明を出す**
    // （テーマプレビュー用の逃げ道がそのまま効いてしまい、照明が減らない）。
    <SpotPoolProvider>
      <Room theme={theme} layout={layout} lightmap={lightmap} />
      <LightmapBaker plan={lightPlan} onBaked={setLightmap} />
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
          lightMode={lightModeFor(settings, art)}
        />
      ))}
      {/* 保存済みのアトラスがあるなら焼かない（それが保存の目的）。
          medium tier bakes too (its shadow pipeline is on); only low skips */}
      {!useSaved && QUALITY !== 'low' && (
        <WallShadowBaker
          specs={bakeSpecs}
          bakeKey={bakeKey}
          onBaked={(id, baked) => setBakedShadows((prev) => ({ ...prev, [id]: baked }))}
        />
      )}
      <TitleWall theme={theme} layout={layout} />
      {/* Doorways to this artist's other public rooms. Renders nothing at all for a
          single-room show, so it costs one filtered array on every other scene. */}
      <RoomPortals layout={layout} />
      <Dust layout={layout} />
      <WalkControls layout={layout} list={list} slots={slots} />
      <GhostVisitors />
      <VideoPlaybackManager />
      {/* 診断スイッチ `?perf=nofx` で後処理をまるごと外せる（既定は出す） */}
      {!LOW_POWER && PERF.fx && <Effects theme={theme} />}
    </SpotPoolProvider>
  )
}
