'use client'
// Real-3D preview for the dashboard: the SAME Exhibit component the room uses,
// hung on a themed wall inside a small on-demand canvas — frame bevel, spotlight,
// hanging hardware and name plaque are the actual renderer's output, not a mock.
// Loaded lazily (next/dynamic) so three.js never weighs down the dashboard itself.
import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { assetUrl } from '@/lib/publicUrl'
import { Canvas, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { getNeutralEnvTexture } from './gallery/textures'
import { resolveTheme, frameDefFor, HANGINGS, CAPTIONS, CEIL_H, applyMat, type SlotDef, type DesignOverrides, type ThemeDef } from '@/lib/presets'
import { artSize } from '@/lib/exhibition'
import Exhibit from '@/components/gallery/Exhibit'
import { WallPiece, ThemedFloor, ThemedCeiling, ThemedSkylight, ThemeLights } from '@/components/gallery/Room'
import { useThemeAtmosphere } from '@/components/gallery/atmosphere'
import Effects from '@/components/gallery/Effects'
import { LOW_POWER } from '@/lib/controller'
import type { ArtworkData } from '@/lib/artworks'

const SLOT: SlotDef = { x: 0, z: 0, rotY: 0 }

/** room モードのカメラ。**この2つが部屋の寸法も決める**ので、Rig と PreviewRoom が
 *  同じ式を通す（別々に持つと、片方を触った日に左右の壁が画角の外へ出て「奥行きが
 *  出ない」に逆戻りする）。 */
const ROOM_FOV = 42
function roomCamDist(art: ArtworkData): number {
  const { height } = artSize(art.ratio, art)
  const tanV = Math.tan((ROOM_FOV * Math.PI) / 360)
  // 作品の上下に余白を取りつつ、最低でも 3.6m ぶんの高さが入る位置まで下がる
  const spanY = Math.max(3.6, ART_CY + height / 2 + 1.3)
  return spanY / (2 * tanV)
}

/** テーマプレビューの部屋。床・天井・壁・天窓・地明かりは**実際の展示室と同じ部品**を
 *  呼ぶ（`components/gallery/Room` からの export）。写して作ると、テーマを調整した日に
 *  プレビューだけ古い見た目で残る（【絶対ルール】2026-08-12）。
 *  実際の部屋と違って**扉・幅木・回り縁・ベンチ・間仕切りは建てない** ── どれも間取り
 *  （`LayoutDef`）が決めるもので、テーマの見え方には関係しないため。 */
function PreviewRoom({ theme, art }: { theme: ThemeDef; art: ArtworkData }) {
  useThemeAtmosphere(theme)
  const size = useThree((s) => s.size)
  const finish = theme.wallFinish ?? 'plaster'
  // 左右の壁は「画角に入る位置」に立てないと意味がない。奥の壁の面での画面端は
  // `dist * tanH` なので、その 0.82 倍に置くと**奥では画面端の少し内側から始まり、
  // 手前に向かって開いていく**＝遠近の楔になる。3.1m は実際の部屋に近い上限で、
  // 横長のプレビューではそちらで頭打ちにする。
  const dist = roomCamDist(art)
  const tanH = Math.tan((ROOM_FOV * Math.PI) / 360) * (size.width / Math.max(1, size.height))
  // 下限は**作品が壁に収まる幅**から出す。1.7m のような固定値にすると、縦長のプレビュー枠
  // （幅300 × 高320 など）で下限が勝ち、側壁が画面端の101%＝画角の外へ出て奥行きが消える
  // ── 算数で確かめて見つけた（実測できない3Dの代わりに、見える条件を式で押さえる）。
  const hw = Math.min(3.1, Math.max(artSize(art.ratio, art).width / 2 + 0.45, 0.66 * dist * tanH))
  // カメラより手前まで床と天井を伸ばす（足りないと足元と頭上で床天井が途切れる）
  const hd = (dist + 2.2) / 2
  const wallOf = (width: number, color: number, position: [number, number, number], rotationY: number) => (
    <group position={position} rotation-y={rotationY}>
      <WallPiece w={width} h={CEIL_H} offU={0} offV={0} wallWidth={width} color={color} finish={finish} />
    </group>
  )
  return (
    <group>
      <group position={[0, 0, hd]}>
        <ThemedFloor theme={theme} hw={hw} hd={hd} />
        <ThemedCeiling theme={theme} hw={hw} hd={hd} />
        <ThemedSkylight theme={theme} hw={hw} hd={hd} />
      </group>
      {/* 作品の掛かる壁（奥）。実際の部屋の北壁と同じ向き */}
      {wallOf(hw * 2, theme.wall, [0, CEIL_H / 2, 0], 0)}
      {/* 左右の壁。奥行きはここで出る。左はアクセント壁（実際の部屋の西壁と同じ役） */}
      {wallOf(hd * 2, theme.accentWall, [-hw, CEIL_H / 2, hd], Math.PI / 2)}
      {wallOf(hd * 2, theme.wall, [hw, CEIL_H / 2, hd], -Math.PI / 2)}
      <ThemeLights theme={theme} />
    </group>
  )
}

/** 空気のもや・AO・ブルーム・トーンマッピングは実際の展示室と**同じ `Effects`**。
 *  `mistLevel` / `mistColor` / `mistDensity` / `mistFalloff` はここでしか絵にならないので、
 *  これが無いとテーマの「空気」は出ない。実際の展示室と同じ条件で低性能端末では外す
 *  （`LOW_POWER` は `lib/controller` の1か所が決めている）。 */
function PreviewEffects({ theme }: { theme: ThemeDef }) {
  if (LOW_POWER) return null
  return <Effects theme={theme} />
}

// The scale reference is the SAME rigged glTF character the room uses for its ambient
// visitors (public/models/visitor.glb) — a proper human silhouette, not a flat sketch —
// so a 30 cm study reads tiny beside it and a 1.6 m canvas nearly its height. It stands
// idle to the art's left; the art centres at 1.62 m (eye level) whatever its size, so the
// relative scale always shows honestly.
const PERSON_URL = assetUrl('models/visitor.glb')
useGLTF.setDecoderPath('/draco/')

const ART_CY = 1.62
// The glTF model ships at real human scale (~1.72 m). These are its approximate extents,
// used only to frame the camera (Rig) so both art and figure fit — the model itself is
// rendered un-scaled, so the reference stays honest.
const PERSON_TOP = 1.72
const PERSON_HALF_W = 0.28
// Clearance off the wall. The dashboard camera looks straight on (no tilt), so the ONLY
// way a flat front view reads "standing in the room" rather than "pasted on the wall" is
// a visible strip of floor between the wall's base line and the figure's feet — too close
// (it used to be 0.12 m) and that gap vanishes, so the figure reads as sunk into the wall.
const PERSON_Z = 0.55

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

// The rigged character, posed once in a relaxed idle stance and rendered as a flat,
// wall-contrast silhouette — the room's own visitor look. frameloop="demand" won't advance
// a mixer, so we sample the idle clip a fixed way in (past the T-pose at t=0). A depth
// pre-pass twin per skinned mesh writes depth first so the translucent body blends exactly
// once (no darker seams where limbs overlap), giving one even opacity like the gallery.
function ScaleFigure({ art, wall }: { art: ArtworkData; wall: number }) {
  const { scene, animations } = useGLTF(PERSON_URL, '/draco/')
  const { model, mats } = useMemo(() => {
    const model = skeletonClone(scene)
    const color = luminance(wall) > 0.5 ? new THREE.Color(0x3b3b45) : new THREE.Color(0xc7c7d0)
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      depthTest: true,
    })
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false })

    const skinned: THREE.SkinnedMesh[] = []
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh
      if (sm.isMesh) {
        sm.material = mat
        sm.castShadow = false
        sm.receiveShadow = false
        sm.frustumCulled = false
        sm.renderOrder = 1
        if (sm.isSkinnedMesh) skinned.push(sm)
      }
    })
    for (const sm of skinned) {
      const twin = new THREE.SkinnedMesh(sm.geometry, depthMat)
      twin.bind(sm.skeleton, sm.bindMatrix)
      twin.bindMode = sm.bindMode
      twin.frustumCulled = false
      twin.renderOrder = 0
      twin.position.copy(sm.position)
      twin.quaternion.copy(sm.quaternion)
      twin.scale.copy(sm.scale)
      sm.parent?.add(twin)
    }

    // Pose it: longest clip = idle. Sample a fixed way in so it isn't the bind-pose T.
    if (animations.length) {
      const idle = [...animations].sort((a, b) => b.duration - a.duration)[0]
      const mixer = new THREE.AnimationMixer(model)
      mixer.clipAction(idle).play()
      mixer.setTime(idle.duration > 2 ? 1.4 : idle.duration * 0.5)
    }

    return { model, mats: [mat, depthMat] }
  }, [scene, animations, wall])
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats])

  // The model ships at real-world human scale with its feet at the origin (the room places
  // it the same way, un-scaled), so it stands on the floor as-is — no fitting needed. A 3/4
  // turn gives the body volume rather than a paper cut-out. A soft contact shadow anchors
  // the feet to the floor so the figure reads as standing IN the room, not stuck to the wall.
  return (
    <group position={[personX(art), 0, PERSON_Z]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.32, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <group rotation-y={0.5}>
        <primitive object={model} />
      </group>
    </group>
  )
}

// Fit BOTH the art and the human reference into view (no longer fit-to-art, which hid
// scale — a 60 cm and a 120 cm piece of the same ratio looked identical). Straight-on,
// level, camera fully owned here. The art sits flush on the wall (z=0) but the person
// now stands PERSON_Z out from it (see above) — being nearer the camera it would fill
// more of the frame than a flat same-depth fit assumes, so each is fit by projecting its
// own extents from ITS OWN depth, and the camera backs up to the farther requirement.
function Rig({ art, mode }: { art: ArtworkData; mode: 'work' | 'room' }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  useEffect(() => {
    // Room mode (theme preview): no scale figure — pull back to show the SPACE (wall,
    // floor, the spotlight pool) with the art as a smaller subject, so the theme's mood
    // reads rather than a work's size. Straight-on, target dropped a touch to reveal floor.
    if (mode === 'room') {
      camera.fov = ROOM_FOV
      camera.position.set(0, 1.4, roomCamDist(art))
      camera.rotation.set(0, 0, 0)
      camera.updateProjectionMatrix()
      invalidate()
      return
    }
    const { width, height } = artSize(art.ratio, art)
    const px = personX(art)
    const artHalfW = width / 2
    const minX = Math.min(-artHalfW, px - PERSON_HALF_W)
    const maxX = Math.max(artHalfW, px + PERSON_HALF_W)
    const minY = 0
    const maxY = Math.max(PERSON_TOP, ART_CY + height / 2) + 0.12
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const fov = 40
    const tanV = Math.tan((fov * Math.PI) / 360)
    const aspect = size.width / Math.max(1, size.height)
    const tanH = tanV * aspect
    const marginX = 0.25
    const marginY = 0.15
    // Required camera Z for one object: its own depth, plus however far back its
    // farthest-from-centre edge needs to be to stay inside the FOV cone from there.
    const requiredZ = (z: number, dxMax: number, dyMax: number) =>
      z + Math.max((dxMax + marginX) / tanH, (dyMax + marginY) / tanV)
    const artDx = Math.max(Math.abs(-artHalfW - cx), Math.abs(artHalfW - cx))
    const artDyLo = Math.abs(ART_CY - height / 2 - cy)
    const artDyHi = Math.abs(ART_CY + height / 2 - cy)
    const personDx = Math.max(Math.abs(px - PERSON_HALF_W - cx), Math.abs(px + PERSON_HALF_W - cx))
    const personDy = Math.max(Math.abs(0 - cy), Math.abs(PERSON_TOP - cy))
    const dist = Math.max(
      requiredZ(0, artDx, Math.max(artDyLo, artDyHi)),
      requiredZ(PERSON_Z, personDx, personDy),
      2.4
    )
    camera.fov = fov
    camera.position.set(cx, cy, dist)
    camera.rotation.set(0, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [art, camera, invalidate, size, mode])
  return null
}

// Same faint environment reflections as the room (floor sheen, metal frames)
function Env() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    // Symmetric gradient env — matches GalleryScene (RoomEnvironment's one-sided
    // window painted a directional white sheen)
    const envTex = pmrem.fromEquirectangular(getNeutralEnvTexture()).texture
    scene.environment = envTex
    scene.environmentIntensity = 1.0
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
  mode = 'work',
  preserveBuffer = false,
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
  /** 'work' = art + human scale figure (default). 'room' = no figure, pulled back to
   *  show the space's atmosphere — used for the theme preview. */
  mode?: 'work' | 'room'
  /** 描いた絵を canvas に残す。**テーマカードの画像を焼く `/theme-capture` だけが true**
   *  にする（既定の false だと `toDataURL` が空の画像を返す）。常時 true にはしない
   *  ── ドライバの最適化が効かなくなるので、見るだけの用途では損しかない。 */
  preserveBuffer?: boolean
}) {
  const theme = resolveTheme(themeKey, designOverrides)
  const floor = new THREE.Color(theme.floorTint).multiply(new THREE.Color(0x9a7a55))
  const isRoom = mode === 'room'
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ preserveDrawingBuffer: preserveBuffer }}
    >
      {!isRoom && <color attach="background" args={[theme.fog]} />}
      <Env />
      <Rig art={art} mode={mode} />
      {mode === 'work' && (
        <Suspense fallback={null}>
          <ScaleFigure art={art} wall={theme.wall} />
        </Suspense>
      )}
      <SettleFrames artId={art.id} />
      {isRoom ? (
        // テーマプレビューは**実際の展示室と同じ部品**で建てる（壁の仕上げ・床の反射・
        // 天井・天窓・地明かり・フォグ）。以前は1枚の平らな壁と `ambientLight 0.45` の
        // ベタ書きで、テーマ定義18項目のうち4項目しか絵に出ていなかった。
        <>
          <PreviewRoom theme={theme} art={art} />
          <PreviewEffects theme={theme} />
        </>
      ) : (
        <>
          <ambientLight intensity={0.45} />
          <mesh position={[0, CEIL_H / 2, 0]} receiveShadow>
            <planeGeometry args={[9, CEIL_H]} />
            <meshStandardMaterial color={theme.wall} roughness={0.95} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0, 2.75]} receiveShadow>
            <planeGeometry args={[9, 5.5]} />
            <meshStandardMaterial color={floor} roughness={0.85} metalness={0.05} />
          </mesh>
        </>
      )}
      <Exhibit
        art={art}
        index={index}
        slot={SLOT}
        theme={theme}
        frameDef={applyMat(frameDefFor(frameKey), matKey)}
        hangingDef={HANGINGS[hangingKey] ?? HANGINGS.wire}
        captionDef={CAPTIONS[captionKey] ?? CAPTIONS.side}
        lightMode={designOverrides?.lightMode ?? 'ceiling'}
        castRealShadow
      />
    </Canvas>
  )
}

useGLTF.preload(PERSON_URL, '/draco/')
