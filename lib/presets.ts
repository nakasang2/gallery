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
  /** Wall surface: smooth plaster (default) or board-formed concrete/stone
   *  (formwork seams + tie holes + aggregate — the moody premium look). */
  wallFinish?: 'plaster' | 'concrete'
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
  /**
   * Curated defaults this theme looks best with. Picking a theme applies these
   * (frame / hanging / caption), but each axis stays independently overridable
   * afterwards — they are recommendations, not a hard binding.
   */
  recommends: { frame: string; hanging: string; caption: string }
}

/** Design Tools (buy-once capability, REQUIREMENTS.md §11.5/§11.8) — a small
 *  set of overrides layered on top of whichever preset theme is chosen, so an
 *  owner can recolour the room and add a mark without forking a whole theme.
 *  The title/accent wall and every other theme parameter (fog, mist, ceiling
 *  strip, skylight…) stay theme-controlled; this only ever touches the three
 *  main walls, the floor tint, the spotlight colour/strength, and a logo. */
export interface DesignOverrides {
  /** '#rrggbb' — overrides ThemeDef.wall (north/south/east walls only) */
  wall: string | null
  /** '#rrggbb' — overrides ThemeDef.floorTint */
  floor: string | null
  /** '#rrggbb' — overrides ThemeDef.spotColor ("light temperature") */
  lightColor: string | null
  /** Multiplier on ambient+hemi intensity, ~0.4–1.8 ("light mood") */
  lightIntensity: number | null
  /** Where each work's spotlight sits: a ceiling track angled at the piece ('ceiling',
   *  the default) or directly above the work shining down ('overhead') */
  lightMode: 'ceiling' | 'overhead' | null
  /** Small mark composited into the title wall's corner */
  logoUrl: string | null
}

export const EMPTY_DESIGN_OVERRIDES: DesignOverrides = {
  wall: null,
  floor: null,
  lightColor: null,
  lightIntensity: null,
  lightMode: null,
  logoUrl: null,
}

export function normalizeDesignOverrides(raw: unknown): DesignOverrides {
  const r = (raw ?? {}) as Partial<DesignOverrides>
  return {
    wall: typeof r.wall === 'string' ? r.wall : null,
    floor: typeof r.floor === 'string' ? r.floor : null,
    lightColor: typeof r.lightColor === 'string' ? r.lightColor : null,
    lightIntensity:
      typeof r.lightIntensity === 'number' ? Math.min(1.8, Math.max(0.4, r.lightIntensity)) : null,
    lightMode: r.lightMode === 'overhead' || r.lightMode === 'ceiling' ? r.lightMode : null,
    logoUrl: typeof r.logoUrl === 'string' ? r.logoUrl : null,
  }
}

/** Manual slot placement (§11.13): arrangement[slotIndex] = artworkId | null.
 *  A null (or a gap past the array's end) is an intentionally-empty slot. Anything
 *  that isn't a non-empty string collapses to null, so a malformed blob degrades to
 *  "no manual arrangement" (auto-fill) rather than throwing. */
export function normalizeArrangement(raw: unknown): (string | null)[] {
  if (!Array.isArray(raw)) return []
  return raw.map((x) => (typeof x === 'string' && x ? x : null))
}

function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/** The theme actually rendered: the preset merged with this room's Design Tools
 *  overrides, if any. The single point every 3D consumer (GalleryScene) reads
 *  through, so a new override field only ever needs wiring here once. */
export function resolveTheme(themeKey: string, overrides?: DesignOverrides | null): ThemeDef {
  const base = THEMES[themeKey] ?? THEMES.chic
  if (!overrides) return base
  const intensity = overrides.lightIntensity ?? 1
  return {
    ...base,
    ...(overrides.wall ? { wall: hexToNum(overrides.wall) } : {}),
    ...(overrides.floor ? { floorTint: hexToNum(overrides.floor) } : {}),
    ...(overrides.lightColor ? { spotColor: hexToNum(overrides.lightColor) } : {}),
    ambient: base.ambient * intensity,
    hemi: base.hemi * intensity,
  }
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
    wallFinish: 'concrete',
    fogDensity: 0.018,
    coneOpacity: 0.05,
    mistLevel: 0.55,
    mistColor: 0x8f887b,
    mistDensity: 0.05,
    mistFalloff: 0.32,
    recommends: { frame: 'gold', hanging: 'wire', caption: 'side' },
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
    recommends: { frame: 'white', hanging: 'flush', caption: 'under' },
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
    wallFinish: 'concrete',
    fogDensity: 0.024,
    coneOpacity: 0.095,
    mistLevel: 0.8,
    mistColor: 0x3a372f,
    mistDensity: 0.06,
    mistFalloff: 0.26,
    recommends: { frame: 'black', hanging: 'wire', caption: 'side' },
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
  portrait: {
    // A tall, narrow room walked lengthwise. Works line the long east wall and
    // both short end walls; the west wall is left for the title.
    label: 'Portrait Hall',
    hw: 4.5,
    hd: 11,
    slots: [
      ...wallSlots(5, 8.5, 4.5 - 0.05, -Math.PI / 2, 'z'), // East long wall
      ...wallSlots(2, 2.4, -11 + 0.05, 0, 'x'), // North end wall
      ...wallSlots(2, 2.4, 11 - 0.05, Math.PI, 'x'), // South end wall
    ],
    benches: [
      { x: -1.4, z: -3 },
      { x: -1.4, z: 3 },
    ],
    partitions: [],
    entry: { x: -1.4, z: 11 - 1.6, yaw: 0 },
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

/* ================= Parametric frames (material × colour × thickness) =================
   The presets above are curated bundles; the structured design panel decomposes a
   frame into material / colour / bar width. A custom combination serialises to the
   key "c:<material>:<hex6>:<barMm>", which travels through the exact same string
   columns (frame_default / frame_override / localStorage) as a preset key — no
   schema change. frameDefFor() is THE resolution point for both shapes. */

export type FrameMaterial = 'wood' | 'metal' | 'paint'

export const FRAME_MATERIALS: Record<FrameMaterial, { label: string; roughness: number; metalness: number }> = {
  wood: { label: 'Wood', roughness: 0.52, metalness: 0.08 },
  metal: { label: 'Metal', roughness: 0.34, metalness: 1.0 },
  paint: { label: 'Paint', roughness: 0.62, metalness: 0.05 },
}

export const FRAME_COLORS: { key: string; label: string; hex: number }[] = [
  { key: 'ink', label: 'Ink', hex: 0x141210 },
  { key: 'white', label: 'White', hex: 0xf4f1ea },
  { key: 'gold', label: 'Gold', hex: 0xa8853c },
  { key: 'silver', label: 'Silver', hex: 0xb9babd },
  { key: 'oak', label: 'Oak', hex: 0x7a5c3e },
  { key: 'walnut', label: 'Walnut', hex: 0x46311f },
  { key: 'navy', label: 'Navy', hex: 0x2e3f54 },
  { key: 'wine', label: 'Wine', hex: 0x6e2f36 },
]

export interface FrameSpec {
  framed: boolean
  material: FrameMaterial
  color: number
  /** Bar (frame border) width in millimetres */
  barMm: number
}

const CUSTOM_FRAME_RE = /^c:(wood|metal|paint):([0-9a-f]{6}):(\d{2,3})$/
export const FRAME_BAR_MM = { min: 10, max: 150 } // 1cm–15cm (custom-frame key encodes mm as 2–3 digits, so ≥10)

const clampBarMm = (mm: number) => Math.min(FRAME_BAR_MM.max, Math.max(FRAME_BAR_MM.min, Math.round(mm)))

export function isFrameKey(key?: string | null): boolean {
  return !!key && (!!FRAMES[key] || CUSTOM_FRAME_RE.test(key))
}

/** Resolve a preset OR custom frame key to a renderable FrameDef */
export function frameDefFor(key?: string | null): FrameDef {
  if (key && FRAMES[key]) return FRAMES[key]
  const m = key?.match(CUSTOM_FRAME_RE)
  if (m) {
    const material = m[1] as FrameMaterial
    const props = FRAME_MATERIALS[material]
    const color = parseInt(m[2], 16)
    return {
      label: `${FRAME_COLORS.find((c) => c.hex === color)?.label ?? 'Custom'} ${props.label.toLowerCase()}`,
      mat: 0xf1ede4,
      bar: clampBarMm(parseInt(m[3], 10)) / 1000,
      gap: 0.07,
      color,
      roughness: props.roughness,
      metalness: props.metalness,
      finish: material,
    }
  }
  return FRAMES.black
}

/** Read a frame key back as its structured spec (for the design panel controls) */
export function frameSpecFor(key?: string | null): FrameSpec {
  const def = frameDefFor(key)
  if (def.mat === null) return { framed: false, material: 'wood', color: 0x141210, barMm: 70 }
  return {
    framed: true,
    material: def.finish ?? 'wood',
    color: def.color ?? 0x141210,
    barMm: clampBarMm((def.bar ?? 0.07) * 1000),
  }
}

/** Serialise a spec to a key — collapsing back to a preset key when it matches one,
 *  so "same as the gallery default" keeps clearing per-work overrides */
export function makeFrameKey(spec: Omit<FrameSpec, 'framed'>): string {
  const barMm = clampBarMm(spec.barMm)
  for (const [k, f] of Object.entries(FRAMES)) {
    if (f.mat !== null && f.finish === spec.material && f.color === spec.color && Math.round(f.bar! * 1000) === barMm) {
      return k
    }
  }
  return `c:${spec.material}:${spec.color.toString(16).padStart(6, '0')}:${barMm}`
}

/* ================= Mats (the paper border inside the frame) ================= */

export interface MatDef {
  label: string
  /** Mat colour; null = keep the frame's own recommended mat colour */
  color: number | null
  /** Mat width in metres; null = keep the frame's own; 0 = no mat at all */
  gap: number | null
}

export const MATS: Record<string, MatDef> = {
  auto: { label: 'Frame default', color: null, gap: null },
  none: { label: 'No mat', color: null, gap: 0 },
  white: { label: 'White', color: 0xf6f3ea, gap: 0.07 },
  ivory: { label: 'Ivory', color: 0xe9dfc8, gap: 0.07 },
  grey: { label: 'Grey', color: 0x8d8880, gap: 0.07 },
  black: { label: 'Black', color: 0x17140f, gap: 0.07 },
}

/** A frame with the chosen mat applied. EVERY renderer (3D room, dashboard
 *  preview, 2D chips) resolves through this, so "no mat" and mat colours mean
 *  exactly the same thing everywhere. Stretched canvas has nothing to mat. */
export function applyMat(f: FrameDef, matKey?: string | null): FrameDef {
  if (f.mat === null) return f
  const m = MATS[matKey ?? 'auto'] ?? MATS.auto
  if (m.gap === null && m.color === null) return f
  return { ...f, gap: m.gap ?? f.gap, mat: m.color ?? f.mat }
}

/* ================= Custom (parametric) layout ================= */
// The 'custom' layout is generated from a few knobs instead of a preset table.
// Kept close to the preset proportions so lighting/benches/entry stay sensible.

export interface CustomLayoutParams {
  /** Half width in metres (room is hw*2 wide) */
  hw: number
  /** Half depth in metres */
  hd: number
  /** Free-standing centre wall with 4 extra slots */
  island: boolean
}

export const CUSTOM_LAYOUT_DEFAULTS: CustomLayoutParams = { hw: 12, hd: 7, island: false }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function normalizeLayoutParams(p?: Partial<CustomLayoutParams> | null): CustomLayoutParams {
  return {
    hw: clamp(Number(p?.hw) || CUSTOM_LAYOUT_DEFAULTS.hw, 8, 18),
    hd: clamp(Number(p?.hd) || CUSTOM_LAYOUT_DEFAULTS.hd, 4, 10),
    island: !!p?.island,
  }
}

export function buildCustomLayout(raw?: Partial<CustomLayoutParams> | null): LayoutDef {
  const p = normalizeLayoutParams(raw)
  const { hw, hd, island } = p
  // Works per long wall scale with width (hall: hw13 → 4, corridor: hw17 → 5)
  const nLong = clamp(Math.round(hw / 3.2), 2, 6)
  const span = hw * 0.72
  const slots: SlotDef[] = [
    ...wallSlots(nLong, span, -hd + 0.05, 0, 'x'), // North wall
    ...wallSlots(nLong, span, hd - 0.05, Math.PI, 'x'), // South wall
  ]
  if (island) {
    const w = Math.min(7.6, hw * 0.62)
    const sx = Math.min(1.9, w / 4)
    slots.push(
      { x: -sx, z: -0.26, rotY: Math.PI, noWire: true },
      { x: sx, z: -0.26, rotY: Math.PI, noWire: true },
      { x: -sx, z: 0.26, rotY: 0, noWire: true },
      { x: sx, z: 0.26, rotY: 0, noWire: true }
    )
  } else if (hd >= 5.5) {
    // Deep room without a centre wall: hang on the east end wall too
    const nEnd = clamp(Math.round(hd / 4), 1, 2)
    slots.push(...wallSlots(nEnd, hd * 0.5, hw - 0.05, -Math.PI / 2, 'z'))
  }
  const benchZ = island ? Math.min(2.2, hd - 1.6) : 0
  return {
    label: 'Custom',
    hw,
    hd,
    slots,
    benches: [
      { x: -hw * 0.5, z: benchZ },
      { x: hw * 0.5, z: benchZ },
    ],
    partitions: island ? [{ x: 0, z: 0, w: Math.min(7.6, hw * 0.62), t: 0.44, h: 3.5 }] : [],
    entry: { x: hw - 2.2, z: hd - 1.8, yaw: 1.37 },
  }
}

/** Resolve a layout key (+ params for 'custom') to a concrete LayoutDef */
export function resolveLayout(key: string, params?: Partial<CustomLayoutParams> | null): LayoutDef {
  if (key === 'custom') return buildCustomLayout(params)
  return LAYOUTS[key] ?? LAYOUTS.hall
}

/* ================= Hanging (how the frame is affixed to the wall) ================= */

export interface HangingDef {
  label: string
  /** wire = twin picture-rail cords, flush = no visible hardware, ledge = the work rests on a shelf */
  kind: 'wire' | 'flush' | 'ledge'
}

export const HANGINGS: Record<string, HangingDef> = {
  wire: { label: 'Rail wires', kind: 'wire' },
  flush: { label: 'Flush mount', kind: 'flush' },
  ledge: { label: 'Shelf ledge', kind: 'ledge' },
}

/* ================= Captions (how the name plate is shown) ================= */

export interface CaptionDef {
  label: string
  /** side = plate to the right, under = plate below the work, none = no plate */
  place: 'side' | 'under' | 'none'
}

export const CAPTIONS: Record<string, CaptionDef> = {
  side: { label: 'Side plate', place: 'side' },
  under: { label: 'Under plate', place: 'under' },
  none: { label: 'None', place: 'none' },
}

/* ================= Templates (a starting bundle across every axis) ================= */
// A template just sets several axes at once. After applying it, each axis stays
// independently editable — it is a curated starting point, not a lock.

export interface TemplateDef {
  label: string
  theme: string
  layout: string
  frame: string
  hanging: string
  caption: string
}

export const TEMPLATES: Record<string, TemplateDef> = {
  salon: { label: 'Classic Salon', theme: 'chic', layout: 'hall', frame: 'gold', hanging: 'wire', caption: 'side' },
  studio: { label: 'White Cube', theme: 'whitecube', layout: 'corridor', frame: 'white', hanging: 'flush', caption: 'under' },
  noir: { label: 'Noir Screening', theme: 'noir', layout: 'island', frame: 'black', hanging: 'wire', caption: 'side' },
  tower: { label: 'Portrait Tower', theme: 'whitecube', layout: 'portrait', frame: 'wood', hanging: 'ledge', caption: 'under' },
}

export const CEIL_H = 5.2
export const EYE = 1.6
