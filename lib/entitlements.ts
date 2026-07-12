// Entitlement placeholders for the three paid axes in REQUIREMENTS.md §11.5
// (Video Pass / room capacity / room design). No payment integration exists yet,
// so every user currently gets full access — this module is only the shape that
// a future purchase/subscription record will fill in, so call sites can be wired
// once without another pass through the codebase.

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
