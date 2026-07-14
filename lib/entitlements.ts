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

/** Video Pass and Design Tools still ignore userId — flipping those to
 *  real gating is a monetization decision, not just wiring, so they stay
 *  open until that's made explicitly. Theme/layout ownership, meanwhile,
 *  has nothing to gate yet (every existing one is forever-free — see
 *  below), so it's safe to already read the real ledger (lib/purchases.ts)
 *  here: today `owned` is always empty and this changes no behavior, but
 *  the day a new paid theme/layout ships, ownership just works. */
export function getEntitlements(
  _userId: string | null,
  owned: { themeIds: string[]; layoutIds: string[] } = { themeIds: [], layoutIds: [] }
): Entitlements {
  return {
    ...FULL_ACCESS_ENTITLEMENTS,
    ownedThemeIds: owned.themeIds,
    ownedLayoutIds: owned.layoutIds,
  }
}

// Snapshot of what shipped free before any paid theme/layout existed (REQUIREMENTS.md
// §11.8) — these ids stay free forever, no matter what a user's entitlements say.
// Only themes/layouts added AFTER this list was captured can ever be gated.
//
// MUST be a hardcoded list, NOT Object.keys(THEMES/LAYOUTS): deriving it from the
// live presets would make every future theme/layout forever-free too, so nothing
// could ever be sold. The dev tests below assert these ids still exist in the
// presets, so a rename is caught immediately rather than silently un-gating.
const FOREVER_FREE_THEME_IDS: readonly string[] = ['chic', 'whitecube', 'noir']
const FOREVER_FREE_LAYOUT_IDS: readonly string[] = ['hall', 'corridor', 'island', 'portrait', 'custom']

// Dev guard (stripped from prod): if a forever-free id is renamed/removed in the
// presets, fail loudly here instead of accidentally locking a shipped-free option.
if (process.env.NODE_ENV !== 'production') {
  for (const id of FOREVER_FREE_THEME_IDS) {
    if (id !== 'custom' && !(id in THEMES)) console.error(`entitlements: forever-free theme "${id}" is missing from THEMES`)
  }
  for (const id of FOREVER_FREE_LAYOUT_IDS) {
    if (id !== 'custom' && !(id in LAYOUTS)) console.error(`entitlements: forever-free layout "${id}" is missing from LAYOUTS`)
  }
}

export function isThemeUnlocked(themeId: string, ent: Entitlements): boolean {
  return FOREVER_FREE_THEME_IDS.includes(themeId) || ent.ownedThemeIds.includes(themeId)
}

export function isLayoutUnlocked(layoutId: string, ent: Entitlements): boolean {
  return FOREVER_FREE_LAYOUT_IDS.includes(layoutId) || ent.ownedLayoutIds.includes(layoutId)
}
