// Display-only price points transcribed from REQUIREMENTS.md §11.5 — the
// markdown table is the source of truth for amounts. No billing logic lives
// here; wiring Stripe later means swapping these strings for real Price IDs
// at the same two call sites (PurchaseModal usages), not a redesign.
export const PRICE_SINGLE_ITEM = '¥400'
export const PRICE_THEME_COLLECTION = '¥2,480'
export const PRICE_DESIGN_TOOLS = '¥1,480'
export const PRICE_ROOM = '¥1,480 / room'
export const PRICE_VIDEO_PASS = '¥980 / year'

export interface PurchaseOption {
  key: string
  label: string
  price: string
  description: string
}

/** A single item always offers the solo purchase; themes (not layouts, per
 *  §11.5/§11.8 — no "Layout Collection" is documented) also offer the bundle */
export function purchaseOptionsFor(kind: 'theme' | 'layout', label: string): PurchaseOption[] {
  const solo: PurchaseOption = {
    key: 'solo',
    label: `${label} only`,
    price: PRICE_SINGLE_ITEM,
    description: `Unlocks just this ${kind}, once, forever.`,
  }
  if (kind !== 'theme') return [solo]
  return [
    solo,
    {
      key: 'collection',
      label: 'Theme Collection Vol.1',
      price: PRICE_THEME_COLLECTION,
      description: 'Every theme released up to now, in one purchase. Future volumes are separate.',
    },
  ]
}
