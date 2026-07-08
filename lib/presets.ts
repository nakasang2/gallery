// Preset definitions for space customization (ported from the prototype src/config.js).

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
  /** Whether to cast a skylight (a soft natural-light effect). */
  skylight?: boolean
  /** Fog density (aerial perspective; the denser it is, the more distant objects recede). */
  fogDensity: number
  /** Opacity of the spotlight's light cone (fake volumetric). */
  coneOpacity: number
  /** Overall strength of the height fog (continuous mist). 0 disables it. */
  mistLevel: number
  /** Mist colour. */
  mistColor: number
  /** Fog density per unit of distance. */
  mistDensity: number
  /** Falloff along the vertical axis (higher values pool the mist lower down). */
  mistFalloff: number
}

export interface SlotDef {
  x: number
  z: number
  rotY: number
  /** Where the ceiling picture rail can't reach (e.g. a center wall), don't draw a hanging wire. */
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
  /** When mat is null there is no frame (stretched canvas). */
  mat: number | null
  bar?: number
  gap?: number
  color?: number
  roughness?: number
  metalness?: number
  /** Surface finish (wood grain / brushed metal / paint's orange-peel texture). */
  finish?: 'wood' | 'metal' | 'paint'
}

/* ================= Themes (walls, floor, lighting) ================= */

export const THEMES: Record<string, ThemeDef> = {
  chic: {
    label: 'Chic',
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
    fogDensity: 0.018,
    coneOpacity: 0.05,
    mistLevel: 0.55,
    mistColor: 0x8f887b,
    mistDensity: 0.05,
    mistFalloff: 0.32,
  },
  whitecube: {
    label: 'White Cube',
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
    fogDensity: 0.013,
    coneOpacity: 0.028,
    mistLevel: 0.4,
    mistColor: 0xe6e0d3,
    mistDensity: 0.04,
    mistFalloff: 0.38,
  },
  noir: {
    label: 'Noir',
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
    fogDensity: 0.024,
    coneOpacity: 0.095,
    mistLevel: 0.8,
    mistColor: 0x3a372f,
    mistDensity: 0.06,
    mistFalloff: 0.26,
  },
}

/* ================= Layouts (room shape and hanging positions) ================= */

// Place count points evenly along one side. When axis='x', vary x and fix z.
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
    label: 'Single Hall',
    hw: 13,
    hd: 8,
    slots: [
      ...wallSlots(4, 9.4, -8 + 0.05, 0, 'x'), // North wall
      ...wallSlots(4, 9.4, 8 - 0.05, Math.PI, 'x'), // South wall
      { x: 13 - 0.05, z: -4, rotY: -Math.PI / 2 }, // East wall
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
    label: 'Corridor',
    hw: 17,
    hd: 4.5,
    slots: [
      ...wallSlots(5, 13.5, -4.5 + 0.05, 0, 'x'), // North wall
      ...wallSlots(5, 13.5, 4.5 - 0.05, Math.PI, 'x'), // South wall
    ],
    benches: [
      { x: -8, z: 0 },
      { x: 8, z: 0 },
    ],
    partitions: [],
    entry: { x: 13.5, z: 1.8, yaw: 1.45 },
  },
  island: {
    label: 'Center Wall',
    hw: 11,
    hd: 7,
    slots: [
      ...wallSlots(3, 7, -7 + 0.05, 0, 'x'), // North wall
      ...wallSlots(3, 7, 7 - 0.05, Math.PI, 'x'), // South wall
      // Both faces of the center wall.
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

/* ================= Framing ================= */
// bar: frame thickness, gap: space between the work and the inner edge of the frame (the visible width of the mat).

export const FRAMES: Record<string, FrameDef> = {
  black: { label: 'Black', bar: 0.07, gap: 0.08, color: 0x141210, roughness: 0.42, metalness: 0.35, mat: 0xf1ede4, finish: 'wood' },
  gold: { label: 'Gold', bar: 0.1, gap: 0.07, color: 0xa8853c, roughness: 0.34, metalness: 1.0, mat: 0xf3eee0, finish: 'metal' },
  white: { label: 'White', bar: 0.07, gap: 0.08, color: 0xf4f1ea, roughness: 0.62, metalness: 0.05, mat: 0xffffff, finish: 'paint' },
  wood: { label: 'Oak', bar: 0.08, gap: 0.07, color: 0x7a5c3e, roughness: 0.58, metalness: 0.05, mat: 0xf1ead9, finish: 'wood' },
  none: { label: 'None', mat: null },
}

export const CEIL_H = 5.2
export const EYE = 1.6
