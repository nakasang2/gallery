// 空間カスタマイズのプリセット定義(プロトタイプ src/config.js から移植)

export interface ThemeDef {
  label: string
  wall: number
  accentWall: number
  ceiling: number
  floorTint: number
  ambient: number
  hemi: number
  spotColor: number
  spotIntensity: number
  stripColor: number
  fog: number
  titleInk: 'light' | 'dark'
  /** 天窓(柔らかい自然光の演出)を出すか */
  skylight?: boolean
}

export interface SlotDef {
  x: number
  z: number
  rotY: number
  /** 中央壁など、天井のピクチャーレールが届かない位置では吊りワイヤーを出さない */
  noWire?: boolean
}

export interface PartitionDef {
  x: number
  z: number
  w: number
  t: number
  h: number
}

export interface LayoutDef {
  label: string
  hw: number
  hd: number
  slots: SlotDef[]
  benches: { x: number; z: number }[]
  partitions: PartitionDef[]
  entry: { x: number; z: number; yaw: number }
}

export interface FrameDef {
  label: string
  /** mat が null のとき額なし(キャンバス張り) */
  mat: number | null
  bar?: number
  gap?: number
  color?: number
  roughness?: number
  metalness?: number
}

/* ================= テーマ(壁・床・照明) ================= */

export const THEMES: Record<string, ThemeDef> = {
  chic: {
    label: 'シック',
    wall: 0xd8d2c6,
    accentWall: 0x2b2620,
    ceiling: 0x3a332c,
    floorTint: 0xffffff,
    ambient: 0.32,
    hemi: 0.55,
    spotColor: 0xffe9c4,
    spotIntensity: 21,
    stripColor: 0xfff0d8,
    fog: 0x0b0a09,
    titleInk: 'light',
  },
  whitecube: {
    label: 'ホワイトキューブ',
    wall: 0xf0eee9,
    accentWall: 0xe9e6df,
    ceiling: 0xe8e4dd,
    floorTint: 0xf2ece0,
    ambient: 0.6,
    hemi: 0.85,
    spotColor: 0xfff6e8,
    spotIntensity: 15,
    stripColor: 0xffffff,
    fog: 0x141312,
    titleInk: 'dark',
    skylight: true,
  },
  noir: {
    label: 'ノワール',
    wall: 0x262320,
    accentWall: 0x15130f,
    ceiling: 0x14120f,
    floorTint: 0x9a9086,
    ambient: 0.1,
    hemi: 0.18,
    spotColor: 0xffe2b8,
    spotIntensity: 27,
    stripColor: 0xffd9a0,
    fog: 0x050404,
    titleInk: 'light',
  },
}

/* ================= レイアウト(部屋の形と展示位置) ================= */

// 一辺に count 点を等間隔で並べる。axis='x' なら x を振って z 固定
function wallSlots(count: number, span: number, fixed: number, rotY: number, axis: 'x' | 'z'): SlotDef[] {
  const slots: SlotDef[] = []
  for (let i = 0; i < count; i++) {
    const p = count === 1 ? 0 : -span + (2 * span * i) / (count - 1)
    slots.push(axis === 'x' ? { x: p, z: fixed, rotY } : { x: fixed, z: p, rotY })
  }
  return slots
}

export const LAYOUTS: Record<string, LayoutDef> = {
  hall: {
    label: 'ワンルーム',
    hw: 13,
    hd: 8,
    slots: [
      ...wallSlots(4, 9.4, -8 + 0.05, 0, 'x'), // 北面
      ...wallSlots(4, 9.4, 8 - 0.05, Math.PI, 'x'), // 南面
      { x: 13 - 0.05, z: -4, rotY: -Math.PI / 2 }, // 東面
      { x: 13 - 0.05, z: 4, rotY: -Math.PI / 2 },
    ],
    benches: [
      { x: -6.5, z: 0 },
      { x: 6.5, z: 0 },
    ],
    partitions: [],
    entry: { x: 8.5, z: 4.5, yaw: 1.37 },
  },
  corridor: {
    label: '回廊',
    hw: 17,
    hd: 4.5,
    slots: [
      ...wallSlots(5, 13.5, -4.5 + 0.05, 0, 'x'), // 北面
      ...wallSlots(5, 13.5, 4.5 - 0.05, Math.PI, 'x'), // 南面
    ],
    benches: [
      { x: -8, z: 0 },
      { x: 8, z: 0 },
    ],
    partitions: [],
    entry: { x: 13.5, z: 1.8, yaw: 1.45 },
  },
  island: {
    label: '中央壁',
    hw: 11,
    hd: 7,
    slots: [
      ...wallSlots(3, 7, -7 + 0.05, 0, 'x'), // 北面
      ...wallSlots(3, 7, 7 - 0.05, Math.PI, 'x'), // 南面
      // 中央壁の両面
      { x: -1.9, z: -0.26, rotY: Math.PI, noWire: true },
      { x: 1.9, z: -0.26, rotY: Math.PI, noWire: true },
      { x: -1.9, z: 0.26, rotY: 0, noWire: true },
      { x: 1.9, z: 0.26, rotY: 0, noWire: true },
    ],
    benches: [
      { x: -6.8, z: 0 },
      { x: 6.8, z: 0 },
    ],
    partitions: [{ x: 0, z: 0, w: 7.6, t: 0.44, h: 3.5 }],
    entry: { x: 7, z: 4.6, yaw: 1.1 },
  },
}

/* ================= 額装 ================= */
// bar: 枠の太さ, gap: 作品と枠内縁の間(マット紙が見える幅)

export const FRAMES: Record<string, FrameDef> = {
  black: { label: '墨', bar: 0.07, gap: 0.08, color: 0x141210, roughness: 0.35, metalness: 0.4, mat: 0xf1ede4 },
  gold: { label: '金', bar: 0.1, gap: 0.07, color: 0xa8853c, roughness: 0.32, metalness: 1.0, mat: 0xf3eee0 },
  white: { label: '白', bar: 0.07, gap: 0.08, color: 0xf4f1ea, roughness: 0.6, metalness: 0.05, mat: 0xffffff },
  wood: { label: '木', bar: 0.08, gap: 0.07, color: 0x7a5c3e, roughness: 0.55, metalness: 0.05, mat: 0xf1ead9 },
  none: { label: 'なし', mat: null },
}

export const CEIL_H = 5.2
export const EYE = 1.6
