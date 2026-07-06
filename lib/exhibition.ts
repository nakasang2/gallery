// 展示リストの導出ロジック(3Dシーンと UI パネルの両方が同じ結果を参照する)
import { ARTWORKS, type ArtworkData } from './artworks'
import { LAYOUTS, FRAMES, type LayoutDef } from './presets'
import type { Settings } from './store'

export function currentExhibitionList(s: Settings): ArtworkData[] {
  const layout = LAYOUTS[s.layout]
  const list = [...s.artworks, ...(s.showDemo ? ARTWORKS : [])]
  return list.slice(0, layout.slots.length)
}

export function overflowCount(s: Settings): number {
  const layout = LAYOUTS[s.layout]
  const total = s.artworks.length + (s.showDemo ? ARTWORKS.length : 0)
  return Math.max(0, total - layout.slots.length)
}

export function frameKeyFor(s: Settings, art: ArtworkData): string {
  const key = s.frameOverrides[art.id]
  return key && FRAMES[key] ? key : s.frame
}

// アスペクト比から展示サイズを決める(横長は幅、縦長は高さを基準に)
export function artSize(ratio: [number, number]): { width: number; height: number } {
  const [rw, rh] = ratio
  let height = rw >= rh ? 1.3 : 1.6
  let width = (height * rw) / rh
  if (width > 2.6) {
    // 極端なパノラマは幅で頭打ちにする
    width = 2.6
    height = (width * rh) / rw
  }
  return { width, height }
}

export interface Solid {
  x: number
  z: number
  hw: number
  hd: number
}

// 歩行の当たり判定(ベンチ・中央壁)
export function getSolids(layout: LayoutDef): Solid[] {
  return [
    ...layout.benches.map((b) => ({ x: b.x, z: b.z, hw: 1.25, hd: 0.5 })),
    ...layout.partitions.map((p) => ({ x: p.x, z: p.z, hw: p.w / 2 + 0.35, hd: p.t / 2 + 0.35 })),
  ]
}
