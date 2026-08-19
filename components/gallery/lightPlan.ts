'use client'
// 部屋のどの面に、どの照明の光を焼くか。**焼く側（LightmapBaker）と貼る側（Room）の
// 唯一の答え。**
//
// 分けた理由は `bakePlan.ts` と同じ壊れ方: 面の並べ方（アトラスのどこに誰が入るか）を
// 2か所で別々に導き出すと、**壁に別の壁の光が貼られる**という、誰も気づかないまま
// 出荷されうる不具合になる（LESSONS「同じ判断を2か所以上に写して書く」×3）。
//
// 焼くのは「壁・床・間仕切り」だけで、**作品と額（立体）は焼かない**
// ── スポットは壁だけでなく立体も照らしているので、そこは別の手当てが要る
// （DECISIONS 2026-08-19 決定2）。
import * as THREE from 'three'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { frameDefFor, applyMat } from '@/lib/presets'
import { frameKeyFor, matKeyFor, lightModeFor } from '@/lib/exhibition'
import type { Settings } from '@/lib/store'
import type { ArtworkData } from '@/lib/artworks'
import { exhibitExtents, exhibitLightRig } from './Exhibit'
import { DOOR_W, DOOR_H, type DoorPlacement, type WallId } from './doorway'
import { POOL_MIX } from './lightMix'

/** 焼く面1枚。世界座標の長方形。texel の位置 = `origin + axisU * u + axisV * v`（u,v は 0..1）。
 *  **`id` は貼る側が自分の区画を引くための鍵**なので、面の作り方を変えたら id も変える。 */
export interface LitSurface {
  id: string
  origin: THREE.Vector3
  /** 長さ＝面の幅（m） */
  axisU: THREE.Vector3
  /** 長さ＝面の高さ（m） */
  axisV: THREE.Vector3
  normal: THREE.Vector3
  w: number
  h: number
  /** この面に割く画素密度（画素/m）。低周波な床は粗くてよい。 */
  ppm: number
}

/** 焼く照明1灯。three.js の `SpotLight` と同じ意味の値だけを持つ（シェーダー側で
 *  `getSpotLightInfo` と同じ式を組み立てるため）。 */
export interface LitSpot {
  pos: THREE.Vector3
  target: THREE.Vector3
  color: THREE.Color
  intensity: number
  angle: number
  penumbra: number
  decay: number
  /** 0 = 打ち切り無し（three.js の既定と同じ） */
  distance: number
}

export interface LightPlan {
  surfaces: LitSurface[]
  spots: LitSpot[]
  /** 焼き直しの要否を決める指紋 */
  key: string
}

// 焼くぶんと実照明の比は葉のモジュールが持つ（循環 import を避けるため）。
// 使う側は `./lightMix` から直接読むこと。

/** 壁1枚を、扉の開口で左・右・まぐさ上の3枚に割る。**`Room` の `Wall` と
 *  `buildLightPlan` の両方がここを通る** ── 割り方がずれると、貼る面と焼いた面が
 *  1枚ずつずれて全部の壁に他人の光が乗る。 */
export function wallPieces(width: number, holeU?: number): { w: number; h: number; offU: number; offV: number }[] {
  if (holeU === undefined) return [{ w: width, h: CEIL_H, offU: 0, offV: 0 }]
  const u0 = holeU - DOOR_W / 2
  const u1 = holeU + DOOR_W / 2
  return [
    { w: u0, h: CEIL_H, offU: 0, offV: 0 }, // 開口の左
    { w: width - u1, h: CEIL_H, offU: u1, offV: 0 }, // 開口の右
    { w: DOOR_W, h: CEIL_H - DOOR_H, offU: u0, offV: DOOR_H }, // 開口の上（まぐさの上）
  ].filter((p) => p.w > 1e-4 && p.h > 1e-4)
}

/** 壁の画素密度（画素/m）。光だまりは低周波なので粗くてよい ── 影（1m あたり68画素）は
 *  別のテクスチャに残るので、ここは輪郭の鮮明さを担っていない。 */
const WALL_PPM = 32
/** 床はさらに粗くてよい。面積が壁の全周ぶんと同じくらいあり、光は縁だけに広がる。 */
const FLOOR_PPM = 16

/** 壁の並び。`Room` が壁を建てる順と同じ。 */
const WALLS: { id: WallId; rotY: number }[] = [
  { id: 'north', rotY: 0 },
  { id: 'south', rotY: Math.PI },
  { id: 'east', rotY: -Math.PI / 2 },
  { id: 'west', rotY: Math.PI / 2 },
]

function rectSurface(
  id: string,
  center: THREE.Vector3,
  tangent: THREE.Vector3,
  up: THREE.Vector3,
  w: number,
  h: number,
  ppm: number
): LitSurface {
  const axisU = tangent.clone().multiplyScalar(w)
  const axisV = up.clone().multiplyScalar(h)
  const normal = new THREE.Vector3().crossVectors(axisU, axisV).normalize()
  return {
    id,
    origin: center.clone().addScaledVector(axisU, -0.5).addScaledVector(axisV, -0.5),
    axisU,
    axisV,
    // 面の表（部屋の内側）を向く法線。`axisU × axisV` の順序を逆にすると**全部の面が裏を向き**、
    // どの texel も `dot(N, L) <= 0` になって部屋がまるごと真っ暗になる。
    normal,
    w,
    h,
    ppm,
  }
}

/** この部屋で焼く面と照明を1つの答えとして組み立てる。 */
export function buildLightPlan(
  theme: ThemeDef,
  layout: LayoutDef,
  door: DoorPlacement | null,
  settings: Settings,
  list: ArtworkData[],
  slots: number[]
): LightPlan {
  const { hw, hd } = layout
  const surfaces: LitSurface[] = []

  // ---- 壁4枚（開口があれば3枚に割れる） ----
  for (const { id, rotY } of WALLS) {
    const width = id === 'north' || id === 'south' ? hw * 2 : hd * 2
    // 壁の中心（世界）。`Room` の `<Wall position>` から高さを外したもの。
    const wallCenter =
      id === 'north'
        ? new THREE.Vector3(0, 0, -hd)
        : id === 'south'
          ? new THREE.Vector3(0, 0, hd)
          : id === 'east'
            ? new THREE.Vector3(hw, 0, 0)
            : new THREE.Vector3(-hw, 0, 0)
    // 親 `group` の rotation-y をそのまま解く（Exhibit / WallShadowBaker と同じ式）
    const tangent = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY))
    const up = new THREE.Vector3(0, 1, 0)
    const holeU = door?.hole?.wall === id ? door.hole.u : undefined
    wallPieces(width, holeU).forEach((p, i) => {
      // 板の中心（壁のローカル）→ 世界。`WallPiece` の position と同じ式。
      const center = wallCenter
        .clone()
        .addScaledVector(tangent, p.offU + p.w / 2 - width / 2)
        .setY(p.offV + p.h / 2)
      surfaces.push(rectSurface(`wall:${id}:${i}`, center, tangent, up, p.w, p.h, WALL_PPM))
    })
  }

  // ---- 床 ----
  surfaces.push(
    rectSurface(
      'floor',
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      hw * 2,
      hd * 2,
      FLOOR_PPM
    )
  )

  // ---- 間仕切り（自立壁）。**見える5面すべて**を焼く。作品が掛かるのは大きな2面だけだが、
  //      端と天面を外すと、そこだけライトマップの外を読んで真っ黒になる（箱は材質が1つで、
  //      面ごとに材質を変えられない）。底面は床に接していて見えないので外す。
  //      `BoxGeometry` の面の並びは +X, -X, +Y, -Y, +Z, -Z なので、id もその綴りで持つ。 ----
  const UP = new THREE.Vector3(0, 1, 0)
  layout.partitions.forEach((p, i) => {
    const c = (dx: number, dy: number, dz: number) => new THREE.Vector3(p.x + dx, p.h / 2 + dy, p.z + dz)
    surfaces.push(
      // 大きな2面（作品が掛かる側）
      rectSurface(`part:${i}:pz`, c(0, 0, p.t / 2), new THREE.Vector3(1, 0, 0), UP, p.w, p.h, WALL_PPM),
      rectSurface(`part:${i}:nz`, c(0, 0, -p.t / 2), new THREE.Vector3(-1, 0, 0), UP, p.w, p.h, WALL_PPM),
      // 端2面
      rectSurface(`part:${i}:px`, c(p.w / 2, 0, 0), new THREE.Vector3(0, 0, -1), UP, p.t, p.h, WALL_PPM),
      rectSurface(`part:${i}:nx`, c(-p.w / 2, 0, 0), new THREE.Vector3(0, 0, 1), UP, p.t, p.h, WALL_PPM),
      // 天面（上向き）
      rectSurface(`part:${i}:py`, c(0, p.h / 2, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), p.t, p.w, WALL_PPM)
    )
  })

  // ---- 照明: 作品のスポット（`Exhibit` と同じ器で位置を出す） ----
  const spotColor = new THREE.Color(theme.spotColor)
  const spots: LitSpot[] = list.map((art, i) => {
    const slot = layout.slots[slots[i]]
    const lightMode = lightModeFor(settings, art)
    const frameDef = applyMat(frameDefFor(frameKeyFor(settings, art)), matKeyFor(settings, art))
    const { halfW, halfH } = exhibitExtents(art, frameDef)
    const rig = exhibitLightRig(slot, lightMode, halfH, halfW)
    return {
      pos: rig.position,
      target: rig.target,
      color: spotColor,
      // `Exhibit` の `<SpotWithTarget intensity>` と同じ係数。**焼くのは `1 - POOL_MIX` ぶん**
      // ── 残りは共有プールの実照明が出すので、ここで全部焼くと近くの面だけ二重に明るくなる。
      intensity: theme.spotIntensity * (lightMode === 'overhead' ? 0.5 : 2.6) * (1 - POOL_MIX),
      angle: rig.angle,
      penumbra: rig.penumbra,
      decay: 2,
      distance: 0,
    }
  })

  const key = [
    layout.label,
    hw,
    hd,
    door?.hole ? `${door.hole.wall}:${door.hole.u.toFixed(2)}` : 'nohole',
    theme.spotIntensity,
    theme.spotColor,
    ...spots.map(
      (s) =>
        `${s.pos.x.toFixed(2)},${s.pos.y.toFixed(2)},${s.pos.z.toFixed(2)}>${s.target.x.toFixed(2)},${s.target.z.toFixed(2)}:${s.angle.toFixed(3)},${s.penumbra},${s.intensity.toFixed(2)}`
    ),
  ].join('|')

  return { surfaces, spots, key }
}

/** アトラスの区画。貼る側は uv1 をこの矩形へ写す。 */
export interface LitRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

export interface LightAtlasLayout {
  size: number
  /** 面の id → アトラス上の区画（0..1） */
  rects: Record<string, LitRect>
  /** 焼くときに使う画素矩形（左下原点・GLのビューポートと同じ向き） */
  px: Record<string, { x: number; y: number; w: number; h: number }>
}

/** 面を1枚のアトラスへ棚詰めする。**高い順に並べてから左から詰める**（棚方式）。
 *  入り切らなければアトラスを倍にして詰め直し、上限に当たったら画素密度を落とす
 *  ── 「入り切らないので1枚諦める」は**その壁だけ真っ黒になる**ので絶対にしない。 */
export function packLightAtlas(surfaces: LitSurface[], maxSize = 2048): LightAtlasLayout {
  const PAD = 2
  for (let scale = 1; scale >= 0.125; scale /= 2) {
    for (let size = 256; size <= maxSize; size *= 2) {
      const items = surfaces
        .map((s) => ({
          id: s.id,
          w: Math.max(2, Math.ceil(s.w * s.ppm * scale)) + PAD * 2,
          h: Math.max(2, Math.ceil(s.h * s.ppm * scale)) + PAD * 2,
        }))
        .sort((a, b) => b.h - a.h)
      if (items.some((it) => it.w > size || it.h > size)) continue
      const rects: Record<string, LitRect> = {}
      const px: Record<string, { x: number; y: number; w: number; h: number }> = {}
      let shelfY = 0
      let shelfH = 0
      let x = 0
      let ok = true
      for (const it of items) {
        if (x + it.w > size) {
          shelfY += shelfH
          shelfH = 0
          x = 0
        }
        if (shelfY + it.h > size) {
          ok = false
          break
        }
        const ix = x + PAD
        const iy = shelfY + PAD
        const iw = it.w - PAD * 2
        const ih = it.h - PAD * 2
        px[it.id] = { x: ix, y: iy, w: iw, h: ih }
        // 半テクセル内側へ寄せる（線形補間が隣の面のテクセルに届かない。`tileUvOf` と同じ作法）
        rects[it.id] = {
          u0: (ix + 0.5) / size,
          v0: (iy + 0.5) / size,
          u1: (ix + iw - 0.5) / size,
          v1: (iy + ih - 0.5) / size,
        }
        x += it.w
        shelfH = Math.max(shelfH, it.h)
      }
      if (ok) return { size, rects, px }
    }
  }
  // ここには来ない（scale 0.125 まで落とせば 2048 に必ず入る）が、
  // 来たときに黙って壁を消さないよう、最小構成で返す。
  return { size: maxSize, rects: {}, px: {} }
}
