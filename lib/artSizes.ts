// Standard artwork size presets, so artists pick a size instead of typing cm.
// A preset just fills the width/height fields, which stay editable ("Other").
// Dimensions in cm. Canvas 号 (F/Figure) are given landscape (W > H); paper A/B
// portrait (W < H) — the editor has a swap button for the other orientation.

export interface SizePreset {
  /** value/key, also what's shown, e.g. "F10" or "A1" */
  label: string
  w: number
  h: number
}
export interface SizeGroup {
  label: string
  options: SizePreset[]
}

export const SIZE_GROUPS: SizeGroup[] = [
  {
    label: '号 (F・Figure)',
    options: [
      { label: 'F0', w: 18.0, h: 14.0 },
      { label: 'F3', w: 27.3, h: 22.0 },
      { label: 'F4', w: 33.3, h: 24.2 },
      { label: 'F6', w: 41.0, h: 31.8 },
      { label: 'F8', w: 45.5, h: 38.0 },
      { label: 'F10', w: 53.0, h: 45.5 },
      { label: 'F12', w: 60.6, h: 50.0 },
      { label: 'F15', w: 65.2, h: 53.0 },
      { label: 'F20', w: 72.7, h: 60.6 },
      { label: 'F30', w: 91.0, h: 72.7 },
      { label: 'F40', w: 100.0, h: 80.3 },
      { label: 'F50', w: 116.7, h: 91.0 },
      { label: 'F80', w: 145.5, h: 112.0 },
      { label: 'F100', w: 162.0, h: 130.3 },
    ],
  },
  {
    label: 'Paper — A',
    options: [
      { label: 'A4', w: 21.0, h: 29.7 },
      { label: 'A3', w: 29.7, h: 42.0 },
      { label: 'A2', w: 42.0, h: 59.4 },
      { label: 'A1', w: 59.4, h: 84.1 },
      { label: 'A0', w: 84.1, h: 118.9 },
    ],
  },
  {
    label: 'Paper — B',
    options: [
      { label: 'B4', w: 25.7, h: 36.4 },
      { label: 'B3', w: 36.4, h: 51.5 },
      { label: 'B2', w: 51.5, h: 72.8 },
      { label: 'B1', w: 72.8, h: 103.0 },
      { label: 'B0', w: 103.0, h: 145.6 },
    ],
  },
]

const ALL = SIZE_GROUPS.flatMap((g) => g.options)

/** Match entered cm to a preset (either orientation), else null → "Custom". */
export function matchPreset(w: number | undefined, h: number | undefined): string | null {
  if (!w || !h) return null
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.15
  const hit = ALL.find((p) => (eq(p.w, w) && eq(p.h, h)) || (eq(p.w, h) && eq(p.h, w)))
  return hit ? hit.label : null
}

export function presetByLabel(label: string): SizePreset | undefined {
  return ALL.find((p) => p.label === label)
}
