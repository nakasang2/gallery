'use client'
// Room (floor, ceiling, walls, baseboards, crown molding, central walls, light strips, benches, overall lighting)
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { walkRef, LOW_POWER, QUALITY } from '@/lib/controller'
import { PERF } from '@/lib/perfFlags'
import { getFloorTextures, getPlasterBump, getPlasterNormal, getConcreteMaps, getBlobShadowTexture, disposeAll } from './textures'
import { useDoorway, DOOR_W, DOOR_H, type WallId } from './doorway'
import { openExhibitionInfo } from './TitleWall'
import SpotWithTarget from './SpotWithTarget'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

// One-time initialization needed to use RectAreaLight (skylight)
let rectAreaInited = false
if (typeof window !== 'undefined' && !rectAreaInited) {
  RectAreaLightUniformsLib.init()
  rectAreaInited = true
}

/** 幅木・回り縁・間仕切りの笠木の色。扉の枠（`RoomPortals`）も同じ色を使う ── 枠は
 *  「部屋の造作の一部」に見えるべきで、値がずれると壁に貼った別物に見える。 */
export const TRIM_COLOR = 0x0e0c0a

// Wall surface maps, tiled to real-world scale (one tile = 3.2m). Plaster =
// normal + roughness only; concrete adds a tinted color map (seams/tie holes/
// stains) and a stronger relief.
type WallFinish = 'plaster' | 'concrete'
/** `w × h` の板1枚ぶんのマップ。壁を切り抜いて複数枚に割ったとき、**タイルが継ぎ目で
 *  ずれない**ように `offU/offV`（その板が壁の左下から何m目に始まるか）をテクスチャの
 *  offset に渡す。1枚のときは `offU = offV = 0` で従来と同じ。 */
function useWallMaps(w: number, h: number, offU: number, offV: number, finish: WallFinish) {
  const maps = useMemo(() => {
    const rep: [number, number] = [w / 3.2, h / 3.2]
    const off: [number, number] = [offU / 3.2, offV / 3.2]
    const fit = (t: THREE.Texture) => {
      t.repeat.set(...rep)
      t.offset.set(...off)
      return t
    }
    if (finish === 'concrete') {
      const base = getConcreteMaps()
      const map = fit(base.map.clone())
      const normalMap = fit(base.normalMap.clone())
      const roughnessMap = fit(base.roughnessMap.clone())
      return { map, normalMap, roughnessMap, normalScale: 1.0 }
    }
    const normalMap = fit(getPlasterNormal().clone())
    const roughnessMap = fit(getPlasterBump().clone())
    return { map: null, normalMap, roughnessMap, normalScale: 0.6 }
  }, [w, h, offU, offV, finish])
  useEffect(() => () => disposeAll([maps.map, maps.normalMap, maps.roughnessMap]), [maps])
  return maps
}

/** 壁の一部（切り抜きが無ければ壁そのもの）。位置は親 `Wall` のローカル座標で決める。
 *  ダッシュボードのテーマプレビュー（`components/Preview3D`）も**この同じ板**を使う
 *  ── 仕上げ（plaster / concrete）とマップの張り方を写すと、テーマを調整した日に
 *  プレビューだけ古い見た目のまま残る（【絶対ルール】2026-08-12）。 */
export function WallPiece({
  w,
  h,
  offU,
  offV,
  wallWidth,
  color,
  finish,
  onSelect,
}: {
  w: number
  h: number
  offU: number
  offV: number
  wallWidth: number
  color: number
  finish: WallFinish
  onSelect?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const gl = useThree((s) => s.gl)
  const { map, normalMap, roughnessMap, normalScale } = useWallMaps(w, h, offU, offV, finish)
  return (
    <mesh
      position={[offU + w / 2 - wallWidth / 2, offV + h / 2 - CEIL_H / 2, 0]}
      receiveShadow
      onClick={onSelect}
      onPointerOver={onSelect ? () => (gl.domElement.style.cursor = 'pointer') : undefined}
      onPointerOut={onSelect ? () => (gl.domElement.style.cursor = '') : undefined}
    >
      <planeGeometry args={[w, h]} />
      {/* The normal map catches grazing light and the roughness map gives uneven sheen */}
      <meshStandardMaterial
        color={color}
        map={map}
        roughness={0.93}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(normalScale, normalScale)}
        roughnessMap={roughnessMap}
        envMapIntensity={0.25}
      />
    </mesh>
  )
}

/** 壁1枚。扉の開口がある壁だけ、**開口の左・右・上の3枚**に割って穴を開ける
 *  （ユーザー選択 2026-08-13・A案）。開口は床まで届くので「下」の板は無い。
 *  `holeU` は壁の左端からの距離で、`./doorway` の `useDoorway` が返す値をそのまま使う
 *  ── 扉を建てる `RoomPortals` と同じ答えなので、穴と扉がずれることがない。 */
function Wall({
  width,
  color,
  finish,
  position,
  rotationY,
  holeU,
  onSelect,
}: {
  width: number
  color: number
  finish: WallFinish
  position: [number, number, number]
  rotationY: number
  holeU?: number
  /** 渡した壁は押せるようになる（西壁＝タイトルウォールだけ。展示情報を開く） */
  onSelect?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const pieces = useMemo(() => {
    if (holeU === undefined) return [{ w: width, h: CEIL_H, offU: 0, offV: 0 }]
    const u0 = holeU - DOOR_W / 2
    const u1 = holeU + DOOR_W / 2
    return [
      { w: u0, h: CEIL_H, offU: 0, offV: 0 }, // 開口の左
      { w: width - u1, h: CEIL_H, offU: u1, offV: 0 }, // 開口の右
      { w: DOOR_W, h: CEIL_H - DOOR_H, offU: u0, offV: DOOR_H }, // 開口の上（まぐさの上）
    ].filter((p) => p.w > 1e-4 && p.h > 1e-4)
  }, [width, holeU])
  return (
    <group position={position} rotation-y={rotationY}>
      {pieces.map((p) => (
        <WallPiece key={`${p.offU},${p.offV}`} {...p} wallWidth={width} color={color} finish={finish} onSelect={onSelect} />
      ))}
    </group>
  )
}

function Trim({ w, x, z, rotY, y, h, d }: { w: number; x: number; z: number; rotY: number; y: number; h: number; d: number }) {
  return (
    <mesh position={[x, y, z]} rotation-y={rotY}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
    </mesh>
  )
}

function Bench({ x, z, theme }: { x: number; z: number; theme: ThemeDef }) {
  // The seat reuses the same floor wood-grain texture in a darker tint
  const topTex = useMemo(() => {
    const t = getFloorTextures().map.clone()
    t.repeat.set(0.5, 0.14)
    return t
  }, [])
  useEffect(() => () => disposeAll([topTex]), [topTex])
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.09, 0.55]} />
        <meshStandardMaterial map={topTex} color={0x8a6a4a} roughness={0.62} />
      </mesh>
      {[-0.85, 0.85].map((lx) => (
        <mesh key={lx} position={[lx, 0.22, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.44, 0.45]} />
          <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
        </mesh>
      ))}
      {/* Low tier renders no real shadows, so fake the bench's contact shadow with
          the shared blurred-blob texture (same trick as the wall drop shadows) */}
      {QUALITY === 'low' && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
          <planeGeometry args={[2.5, 0.95]} />
          {/* radially uniform blob — the wall-shadow texture has a vertical
              gradient that would point along +Z when laid flat */}
          <meshBasicMaterial
            map={getBlobShadowTexture()}
            transparent
            opacity={0.34}
            color={0x000000}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* Downlight directly above the bench (casts a contact shadow). Kept to a
          tight cone — a wide one paints a huge unexplained bright patch across
          the floor in dark themes */}
      <SpotWithTarget
        position={[0, CEIL_H - 0.1, 0]}
        targetPosition={[0, 0, 0]}
        color={theme.spotColor}
        intensity={22}
        angle={0.62}
        penumbra={0.9}
        decay={2}
        castShadow
      />
    </group>
  )
}

/** 床。**実際の部屋とダッシュボードのテーマプレビューが同じものを使う**
 *  ── 反射のパラメータ（下のコメントにある白飛びの経緯を含む）を写すと、片方だけ
 *  古い設定のまま残る（【絶対ルール】2026-08-12）。 */
export function ThemedFloor({
  theme,
  hw,
  hd,
  onClick,
}: {
  theme: ThemeDef
  hw: number
  hd: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  // Floor: keep the plank grain at real scale (about 5.3m x 2.7m per tile)
  const floorTex = useMemo(() => {
    const base = getFloorTextures()
    const out = {
      map: base.map.clone(),
      bumpMap: base.bumpMap.clone(),
      roughnessMap: base.roughnessMap.clone(),
    }
    for (const t of Object.values(out)) t.repeat.set((hw * 2) / 5.3, (hd * 2) / 2.66)
    return out
  }, [hw, hd])
  useEffect(() => () => disposeAll(Object.values(floorTex)), [floorTex])
  return (
      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={onClick}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        {/* 診断スイッチ `?perf=norefl` でも光沢床側に落とせる（既定は従来どおり） */}
        {LOW_POWER || !PERF.reflector ? (
          // Mobile/low-power: the real-time reflection pass is too costly, so keep the
          // cheap clearcoat sheen.
          <meshPhysicalMaterial
            {...floorTex}
            color={theme.floorTint}
            bumpScale={0.5}
            roughness={0.9}
            clearcoat={0.25}
            clearcoatRoughness={0.55}
            envMapIntensity={0.6}
          />
        ) : (
          // Desktop: a polished floor that softly reflects the works and room (planar
          // reflection). Blurred + roughness kept high so it reads as waxed wood, not a
          // mirror; the wood grain stays via map/roughnessMap/bumpMap.
          // Deliberately NO depthScale: the depth-fade branch samples a 16-bit depth
          // texture and is the reflector's only GPU-dependent path — on some machines
          // it blows out into white patches exactly where the mirrored ray travels far
          // (the artless stretches of wall; user-reported, not reproducible here).
          <MeshReflectorMaterial
            map={floorTex.map}
            roughnessMap={floorTex.roughnessMap}
            bumpMap={floorTex.bumpMap}
            bumpScale={0.5}
            color={theme.floorTint}
            resolution={1024} // 512 sparkles/crawls when the camera moves
            blur={[360, 100]}
            mixBlur={1}
            // Raised back up (user request) now that the real white-wash culprits
            // are gone (floor specular killed via roughness/metalness, symmetric
            // env map, no depth-fade branch, bloom threshold 1.0) — the artworks
            // and room should visibly mirror in the polished floor.
            mixStrength={0.5}
            mixContrast={1}
            mirror={0.38}
            // roughness high + metalness 0: the spotlights otherwise paint a huge
            // view-dependent specular hotspot on the floor when you face a wall
            // head-on (eye/light/floor angles align) — the "white patch" that only
            // shows from straight-on viewpoints. The planar reflection (mixStrength/
            // mirror above) is unaffected; only the direct light specular dims.
            roughness={0.93}
            metalness={0}
            envMapIntensity={0.5}
          />
        )}
      </mesh>
  )
}

/** 天井。床と同じ理由で部品にしてある。 */
export function ThemedCeiling({ theme, hw, hd }: { theme: ThemeDef; hw: number; hd: number }) {
  // The ceiling reuses the plaster normal map: dead-flat white overhead is a big
  // CG tell once the emissive strips and skylight graze it
  const ceilingNormal = useMemo(() => {
    const t = getPlasterNormal().clone()
    t.repeat.set((hw * 2) / 3.2, (hd * 2) / 3.2)
    return t
  }, [hw, hd])
  useEffect(() => () => disposeAll([ceilingNormal]), [ceilingNormal])
  return (
      <mesh rotation-x={Math.PI / 2} position={[0, CEIL_H, 0]}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        <meshStandardMaterial
          color={theme.ceiling}
          roughness={0.95}
          normalMap={ceilingNormal}
          normalScale={new THREE.Vector2(0.35, 0.35)}
        />
      </mesh>
  )
}

/** 天窓（White Cube）。**実際の部屋とダッシュボードのテーマプレビューが同じものを使う。**
 *  枠は「4本の桟」で組む。一枚板にしない（ユーザー報告 2026-08-13「天井に不自然な
 *  メッシュがあるんだけど」）── それまで枠は `boxGeometry(w+0.16, 0.06, d+0.16)` を
 *  `y = +0.005` に置いた**中身の詰まった箱**で、ガラス（`y = 0` の発光面）より 25mm 下に
 *  底面がある上に footprint も一回り大きいので、下から見ると**ガラスを完全に覆っていた**。
 *  天窓が光らず、天井の真ん中に「灰色の板が貼ってある」ようにしか見えなかったのがこれ。 */
export function ThemedSkylight({ theme, hw, hd }: { theme: ThemeDef; hw: number; hd: number }) {
  if (!theme.skylight) return null
  const sw = Math.min(7, hw)
  const sd = Math.min(3.4, hd * 0.8)
  /** 桟の見付（幅）と厚み。厚みはガラスより下に出さない ── 出すと天井から
   *  出っ張った箱に見えるので、ガラスと同じ面から上へ伸ばす。 */
  const bar = 0.09
  const barH = 0.06
  return (
    <group position={[0, CEIL_H - 0.012, 0]}>
      <mesh rotation-x={Math.PI / 2}>
        <planeGeometry args={[sw, sd]} />
        <meshStandardMaterial color={0x000000} emissive={0xf3f6ff} emissiveIntensity={1.5} />
      </mesh>
      {/* 4本の桟。ガラスの外側に置き、上へ伸ばす（下から見えるのは桟の底面だけ） */}
      {(
        [
          [sw + bar * 2, bar, 0, (sd + bar) / 2],
          [sw + bar * 2, bar, 0, -(sd + bar) / 2],
          [bar, sd, (sw + bar) / 2, 0],
          [bar, sd, -(sw + bar) / 2, 0],
        ] as [number, number, number, number][]
      ).map(([bx, bz, x, z]) => (
        <mesh key={`sf${x},${z}`} position={[x, barH / 2, z]}>
          <boxGeometry args={[bx, barH, bz]} />
          <meshStandardMaterial color={0xdcd8d0} roughness={0.9} />
        </mesh>
      ))}
      <rectAreaLight args={[0xf3f6ff, 3.2, sw, sd]} rotation-x={-Math.PI / 2} />
    </group>
  )
}

export default function Room({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const { hw, hd } = layout
  const h = CEIL_H

  const finish: WallFinish = theme.wallFinish ?? 'plaster'
  const partitionMaps = useWallMaps(8, CEIL_H, 0, 0, finish)
  // 扉の開口。`RoomPortals` が扉を建てるのと同じ関数なので、穴と扉は必ず同じ場所。
  // 扉が建たない部屋（他の部屋が無い・どの壁にも収まらない）では `null` / `hole: null`
  // になり、**壁は切り抜かれない**（穴の向こうに何も無いので開けてはいけない）。
  const door = useDoorway(layout)
  const holeU = (id: WallId) => (door?.hole?.wall === id ? door.hole.u : undefined)
  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 10) return // it was a drag (matches WalkControls.TAP_THRESHOLD)
    walkRef.current?.walkTo(e.point)
  }

  // Number of ceiling indirect-light strips (based on room depth)
  const stripZs = useMemo(() => {
    const n = Math.max(1, Math.floor(hd / 2.5))
    return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 4)
  }, [hd])

  return (
    <group>
      <ThemedFloor theme={theme} hw={hw} hd={hd} onClick={onFloorClick} />

      <ThemedCeiling theme={theme} hw={hw} hd={hd} />

      {/* Walls (the west face uses the accent color for the title wall) */}
      <Wall width={hw * 2} color={theme.wall} finish={finish} position={[0, h / 2, -hd]} rotationY={0} holeU={holeU('north')} />
      <Wall width={hw * 2} color={theme.wall} finish={finish} position={[0, h / 2, hd]} rotationY={Math.PI} holeU={holeU('south')} />
      <Wall width={hd * 2} color={theme.wall} finish={finish} position={[hw, h / 2, 0]} rotationY={-Math.PI / 2} holeU={holeU('east')} />
      {/* 西壁＝タイトルウォール。**壁のどこを押しても展示情報が開く**（ユーザー要望
          2026-08-13「奥の壁を押下したときに表示したい」）。板（`TitleWall`）だけが
          押せた頃は、板の外＝壁の端を押しても何も起きなかった。振る舞いは
          `openExhibitionInfo` の1か所が決めている。 */}
      <Wall
        width={hd * 2}
        color={theme.accentWall}
        finish={finish}
        position={[-hw, h / 2, 0]}
        rotationY={Math.PI / 2}
        holeU={holeU('west')}
        onSelect={openExhibitionInfo}
      />

      {/* Baseboards and crown molding.
          **幅木は開口で切る**（ユーザー選択 2026-08-13・A案の付随。実際の戸口も幅木は
          回り込まない）。切らないと 12cm の暗いバーが開口の足元を横切り、まさに前回
          「明るい灰色の板」と言われたのと同じ「開口を塞ぐ帯」になる。回り縁（`h-0.09`）は
          開口の上端 2.62m よりずっと高いので、割る必要がない。 */}
      {(
        [
          ['north', hw * 2, 0, -hd + 0.02, 0],
          ['south', hw * 2, 0, hd - 0.02, 0],
          ['east', hd * 2, hw - 0.02, 0, Math.PI / 2],
          ['west', hd * 2, -hw + 0.02, 0, Math.PI / 2],
        ] as [WallId, number, number, number, number][]
      ).map(([id, w, x, z, rotY]) => {
        // 幅木が伸びる軸（南北の壁なら x、東西の壁なら z）の世界座標で2本に割る。
        const along: 'x' | 'z' = rotY === 0 ? 'x' : 'z'
        const center = door?.hole?.wall === id ? (along === 'x' ? door.pos.x : door.pos.z) : null
        const segs =
          center === null
            ? [{ w, at: 0 }]
            : [
                { w: center - DOOR_W / 2 + w / 2, at: (-w / 2 + (center - DOOR_W / 2)) / 2 },
                { w: w / 2 - (center + DOOR_W / 2), at: (center + DOOR_W / 2 + w / 2) / 2 },
              ].filter((s) => s.w > 1e-4)
        return (
          <group key={id}>
            {segs.map((s) => (
              <Trim
                key={s.at}
                w={s.w}
                x={along === 'x' ? s.at : x}
                z={along === 'x' ? z : s.at}
                rotY={rotY}
                y={0.06}
                h={0.12}
                d={0.04}
              />
            ))}
            <Trim w={w} x={x} z={z} rotY={rotY} y={h - 0.09} h={0.18} d={0.07} />
          </group>
        )
      })}

      {/* Central free-standing walls (depending on layout) */}
      {layout.partitions.map((p, i) => (
        <group key={i}>
          <mesh position={[p.x, p.h / 2, p.z]} castShadow receiveShadow>
            <boxGeometry args={[p.w, p.h, p.t]} />
            <meshStandardMaterial
              color={theme.accentWall}
              map={partitionMaps.map}
              roughness={0.95}
              normalMap={partitionMaps.normalMap}
              normalScale={new THREE.Vector2(partitionMaps.normalScale, partitionMaps.normalScale)}
              roughnessMap={partitionMaps.roughnessMap}
              envMapIntensity={0.25}
            />
          </mesh>
          <mesh position={[p.x, p.h + 0.03, p.z]}>
            <boxGeometry args={[p.w + 0.06, 0.06, p.t + 0.06]} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Ceiling indirect-light strips (emissive in HDR so they pick up bloom) */}
      {stripZs.map((z) => (
        <mesh key={z} position={[0, h - 0.02, z]}>
          <boxGeometry args={[hw * 1.6, 0.02, 0.09]} />
          <meshStandardMaterial color={0x000000} emissive={theme.stripColor} emissiveIntensity={2.4} />
        </mesh>
      ))}

      {/* Picture rail (thin rail that holds the frame hanging wires) */}
      {(
        [
          [hw * 2, 0, -hd + 0.05, 0],
          [hw * 2, 0, hd - 0.05, 0],
          [hd * 2, hw - 0.05, 0, Math.PI / 2],
          [hd * 2, -hw + 0.05, 0, Math.PI / 2],
        ] as [number, number, number, number][]
      ).map(([w, x, z, rotY], i) => (
        <mesh key={`rail-${i}`} position={[x, h - 0.34, z]} rotation-y={rotY}>
          <boxGeometry args={[w, 0.05, 0.035]} />
          <meshStandardMaterial color={0x1c1916} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}

      <ThemedSkylight theme={theme} hw={hw} hd={hd} />

      {/* Benches */}
      {layout.benches.map((b) => (
        <Bench key={`${b.x},${b.z}`} x={b.x} z={b.z} theme={theme} />
      ))}

      <ThemeLights theme={theme} />
    </group>
  )
}

/** テーマの地明かり。**部屋とダッシュボードのプレビューが同じものを使う**
 *  ── プレビュー側は長らく `ambientLight 0.45` のベタ書きで、Noir の暗さも
 *  White Cube の明るさも出ていなかった（【絶対ルール】2026-08-12）。
 *  Keep ambient light low to bring out shadow and spotlight contrast. */
export function ThemeLights({ theme }: { theme: ThemeDef }) {
  return (
    <>
      <ambientLight color={0xfff4e0} intensity={theme.ambient} />
      <hemisphereLight color={0xfff8ea} groundColor={0x4a4136} intensity={theme.hemi} />
    </>
  )
}
