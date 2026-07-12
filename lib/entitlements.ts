// Entitlement placeholders for the three paid axes in REQUIREMENTS.md §11.5
// (Video Pass / room capacity / room design). No payment integration exists yet,
// so every user currently gets full access — this module is only the shape that
// a future purchase/subscription record will fill in, so call sites can be wired
// once without another pass through the codebase.
import { THEMES, LAYOUTS } from './presets'

export interface Entitlements {
  /** ① Video Pass (subscription) — video exhibits enabled */
  videoEnabled: boolean
  /** ③ Design Tools (buy-once) — custom colour/lighting/branding controls */
  designToolsEnabled: boolean
  /** ③ Themes/layouts owned as individual purchases (ids into THEMES/LAYOUTS) */
  ownedThemeIds: string[]
  ownedLayoutIds: string[]
}

/** Nobody is gated yet — every axis is open until purchases exist */
export const FULL_ACCESS_ENTITLEMENTS: Entitlements = {
  videoEnabled: true,
  designToolsEnabled: true,
  ownedThemeIds: [],
  ownedLayoutIds: [],
}

/** Today this ignores userId entirely; it's the single seam a future
 *  purchases table hooks into without touching every call site again */
export function getEntitlements(_userId: string | null): Entitlements {
  return FULL_ACCESS_ENTITLEMENTS
}

// Snapshot of what shipped free before any paid theme/layout existed (REQUIREMENTS.md
// §11.8) — these ids stay free forever, no matter what a user's entitlements say.
// Only themes/layouts added AFTER this list was captured can ever be gated.
const FOREVER_FREE_THEME_IDS: readonly string[] = Object.keys(THEMES)
const FOREVER_FREE_LAYOUT_IDS: readonly string[] = [...Object.keys(LAYOUTS), 'custom']

export function isThemeUnlocked(themeId: string, ent: Entitlements): boolean {
  return FOREVER_FREE_THEME_IDS.includes(themeId) || ent.ownedThemeIds.includes(themeId)
}

export function isLayoutUnlocked(layoutId: string, ent: Entitlements): boolean {
  return FOREVER_FREE_LAYOUT_IDS.includes(layoutId) || ent.ownedLayoutIds.includes(layoutId)
}
