// Entitlements for the paid axes in REQUIREMENTS.md §11.5 (Video Pass /
// Design Tools / owned themes, layouts & frames). Resolved from the real
// purchases ledger (lib/purchases.ts): the free tier locks Video Pass and Design
// Tools until purchased; forever-free themes/layouts/frames (below) stay open to
// everyone. This is the intended release base — buying is what unlocks these.
import { THEMES, LAYOUTS, FRAMES, CUSTOM_LAYOUT_RELEASED } from './presets'

export interface Entitlements {
  /** ① Video Pass (subscription) — video exhibits enabled */
  videoEnabled: boolean
  /** Design Tools (custom colour/lighting/branding) — now FREE for everyone
   *  (docs/DECISIONS 2026-07-24); kept as a flag so callers don't change. */
  designToolsEnabled: boolean
  /** ③ Themes/layouts/frames owned as individual purchases (ids into the presets) */
  ownedThemeIds: string[]
  ownedLayoutIds: string[]
  ownedFrameIds: string[]
}

/** The free tier: Video Pass + paid themes/layouts locked; Design Tools is free
 *  for everyone. What a signed-out / unpurchased user gets. */
export const FREE_TIER_ENTITLEMENTS: Entitlements = {
  videoEnabled: false,
  designToolsEnabled: true,
  ownedThemeIds: [],
  ownedLayoutIds: [],
  ownedFrameIds: [],
}

export interface OwnedEntitlements {
  themeIds: string[]
  layoutIds: string[]
  frameIds: string[]
  designTools: boolean
  videoPass: boolean
}

/** Resolve a user's entitlements from what they own (usePurchasedIds). With
 *  nothing owned this returns the free tier — Video Pass and Design Tools locked,
 *  no paid themes/layouts. Forever-free themes/layouts are handled separately by
 *  isThemeUnlocked / isLayoutUnlocked below and remain open regardless. */
export function getEntitlements(
  _userId: string | null,
  owned: OwnedEntitlements = { themeIds: [], layoutIds: [], frameIds: [], designTools: false, videoPass: false }
): Entitlements {
  return {
    videoEnabled: owned.videoPass,
    designToolsEnabled: true, // free for everyone (docs/DECISIONS 2026-07-24)
    ownedThemeIds: owned.themeIds,
    ownedLayoutIds: owned.layoutIds,
    ownedFrameIds: owned.frameIds,
  }
}

// The free tier's themes/layouts — everyone gets these without paying; everything
// else in THEMES/LAYOUTS requires a purchase. Set pre-launch to a single free
// theme + layout (whitecube / corridor); the rest (chic, noir; hall, island,
// portrait, custom) are paid. These are also the defaults new free galleries
// start from (the "studio" template in lib/galleries → createGallery).
//
// MUST be a hardcoded list, NOT Object.keys(THEMES/LAYOUTS): deriving it from the
// live presets would make every future theme/layout free too, so nothing could
// ever be sold. The dev guard below asserts these ids still exist in the presets,
// so a rename is caught immediately rather than silently un-gating.
const FOREVER_FREE_THEME_IDS: readonly string[] = ['whitecube']
const FOREVER_FREE_LAYOUT_IDS: readonly string[] = ['corridor']

// Frames: EVERY frame that existed when frames became sellable stays free
// (ユーザー判断 2026-07-29 — 今あるものは全部無料のまま、今後追加する額を有料に).
// Making an already-shipped frame paid would retroactively lock rooms that are
// hanging their works in it, so this list is a snapshot and only ever grows for
// frames someone should NOT have to pay for. Frames added after this line ships
// are paid by default.
const FOREVER_FREE_FRAME_IDS: readonly string[] = ['black', 'gold', 'white', 'wood', 'none']

/** The default theme/layout a new free gallery starts on (the free-tier options). */
export const FREE_DEFAULT_THEME_ID = FOREVER_FREE_THEME_IDS[0]
export const FREE_DEFAULT_LAYOUT_ID = FOREVER_FREE_LAYOUT_IDS[0]

// Dev guard (stripped from prod): if a forever-free id is renamed/removed in the
// presets, fail loudly here instead of accidentally locking a shipped-free option.
if (process.env.NODE_ENV !== 'production') {
  for (const id of FOREVER_FREE_THEME_IDS) {
    if (id !== 'custom' && !(id in THEMES)) console.error(`entitlements: forever-free theme "${id}" is missing from THEMES`)
  }
  for (const id of FOREVER_FREE_LAYOUT_IDS) {
    if (id !== 'custom' && !(id in LAYOUTS)) console.error(`entitlements: forever-free layout "${id}" is missing from LAYOUTS`)
  }
  for (const id of FOREVER_FREE_FRAME_IDS) {
    if (!(id in FRAMES)) console.error(`entitlements: forever-free frame "${id}" is missing from FRAMES`)
  }
}

export function isThemeUnlocked(themeId: string, ent: Entitlements): boolean {
  return FOREVER_FREE_THEME_IDS.includes(themeId) || ent.ownedThemeIds.includes(themeId)
}

export function isLayoutUnlocked(layoutId: string, ent: Entitlements): boolean {
  return FOREVER_FREE_LAYOUT_IDS.includes(layoutId) || ent.ownedLayoutIds.includes(layoutId)
}

/**
 * Frames come in two shapes and only one of them can be paid: a preset id
 * ('gold') or a parametric key ('c:wood:46311f:110', material × colour × width).
 * The parametric panel is free for everyone, so any key that isn't a preset id
 * is unlocked — a paid frame therefore has to bring something the knobs cannot
 * express (a new finish or profile), not just a colour and a width, or it can be
 * rebuilt for free. makeFrameKey() only ever collapses a spec onto a free preset
 * for the same reason (lib/presets).
 */
export function isFrameUnlocked(frameKey: string, ent: Entitlements): boolean {
  if (!(frameKey in FRAMES)) return true // parametric / unknown → the free panel
  return FOREVER_FREE_FRAME_IDS.includes(frameKey) || ent.ownedFrameIds.includes(frameKey)
}

/** A starting template is usable only when the user has BOTH its theme and its
 *  layout — otherwise creating from it would hand a free user paid content. */
export function isTemplateUnlocked(
  tpl: { theme: string; layout: string },
  ent: Entitlements
): boolean {
  return isThemeUnlocked(tpl.theme, ent) && isLayoutUnlocked(tpl.layout, ent)
}

/**
 * Order a list of options so the ones the viewer can use right now come first,
 * keeping the catalogue's own order inside each group (ユーザー判断 2026-07-29:
 * 「初期状態ですでに無料開放されてるものは、全部左に表示してほしい」).
 *
 * Free-by-default options are always unlocked, so they always lead — and a
 * purchase moves that item up to join them instead of leaving the owner hunting
 * for what they paid for among the locks.
 */
export function unlockedFirst<T>(items: T[], isUnlocked: (item: T) => boolean): T[] {
  const open: T[] = []
  const locked: T[] = []
  for (const item of items) (isUnlocked(item) ? open : locked).push(item)
  return [...open, ...locked]
}

/* ================= The paid catalog ================= */
// Everything in the presets that isn't forever-free is, by definition, for sale.
// Derived (not a second hand-written list), so a theme added to THEMES is
// sellable the moment it lands. THE single answer to "what do we sell?", read by
// lib/pricing (per-item amount + the public price range), /api/checkout (which
// refuses an id that is free or doesn't exist) and /admin (the grantable list).

export function paidThemeIds(): string[] {
  return Object.keys(THEMES).filter((id) => !isThemeUnlocked(id, FREE_TIER_ENTITLEMENTS))
}

/** 'custom' has no LAYOUTS row (it is generated from parameters) and is only on
 *  sale once released — until then it must not be buyable or grantable, or we
 *  would be selling something no chip can select. */
export function paidLayoutIds(): string[] {
  const ids = CUSTOM_LAYOUT_RELEASED ? [...Object.keys(LAYOUTS), 'custom'] : Object.keys(LAYOUTS)
  return ids.filter((id) => !isLayoutUnlocked(id, FREE_TIER_ENTITLEMENTS))
}

/** Empty today: every frame that exists is forever-free. It fills in by itself
 *  when a frame is added to FRAMES, which is the whole point — the frame then
 *  shows a lock, gets a price, appears in /admin's grant list, and can be bought,
 *  with no further code change. */
export function paidFrameIds(): string[] {
  return Object.keys(FRAMES).filter((id) => !isFrameUnlocked(id, FREE_TIER_ENTITLEMENTS))
}
