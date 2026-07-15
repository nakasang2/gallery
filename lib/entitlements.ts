// Entitlements for the paid axes in REQUIREMENTS.md §11.5 (Video Pass /
// Design Tools / owned themes & layouts). Resolved from the real purchases
// ledger (lib/purchases.ts): the free tier locks Video Pass and Design Tools
// until purchased; forever-free themes/layouts (below) stay open to everyone.
// This is the intended release base — buying is what unlocks these.
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

/** The free tier: paid axes locked, nothing owned. What a signed-out / unpurchased user gets. */
export const FREE_TIER_ENTITLEMENTS: Entitlements = {
  videoEnabled: false,
  designToolsEnabled: false,
  ownedThemeIds: [],
  ownedLayoutIds: [],
}

export interface OwnedEntitlements {
  themeIds: string[]
  layoutIds: string[]
  designTools: boolean
  videoPass: boolean
}

/** Resolve a user's entitlements from what they own (usePurchasedIds). With
 *  nothing owned this returns the free tier — Video Pass and Design Tools locked,
 *  no paid themes/layouts. Forever-free themes/layouts are handled separately by
 *  isThemeUnlocked / isLayoutUnlocked below and remain open regardless. */
export function getEntitlements(
  _userId: string | null,
  owned: OwnedEntitlements = { themeIds: [], layoutIds: [], designTools: false, videoPass: false }
): Entitlements {
  return {
    videoEnabled: owned.videoPass,
    designToolsEnabled: owned.designTools,
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
