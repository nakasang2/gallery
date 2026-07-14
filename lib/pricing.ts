// Display-only price points transcribed from REQUIREMENTS.md §11.5 — the
// markdown table is the source of truth for amounts. No billing logic lives
// here; wiring Stripe later means swapping these strings for real Price IDs
// at the same two call sites (PurchaseModal usages), not a redesign.
export const PRICE_SINGLE_ITEM = '¥400'
export const PRICE_THEME_COLLECTION = '¥2,480'
export const PRICE_DESIGN_TOOLS = '¥1,480'
export const PRICE_ROOM = '¥1,480 / room'
export const PRICE_VIDEO_PASS = '¥980 / year'

// Numeric amounts (JPY) keyed by SKU — the single source of truth a future Stripe
// webhook writes into purchases.amount_jpy, and what the admin revenue view sums.
// Kept in step with the display strings above.
export const PRICE_JPY = {
  room: 1480,
  capacity_addon: 580,
  single_item: 400,
  theme_collection: 2480,
  design_tools: 1480,
  video_pass: 980,
} as const
export type Sku = keyof typeof PRICE_JPY

export const SKU_LABEL: Record<Sku, string> = {
  room: 'Extra room',
  capacity_addon: '+5 work slots',
  single_item: 'Theme / layout',
  theme_collection: 'Theme Collection Vol.1',
  design_tools: 'Design Tools',
  video_pass: 'Video Pass',
}

/** Format a JPY integer the way the rest of the UI shows prices (¥1,480). */
export function yen(n: number): string {
  return `¥${n.toLocaleString('en-US')}`
}
/** §11.5 axis ② — an add-on for an EXISTING room, distinct from "展示室を追加"
 *  (a whole new room). Cheaper than a new room since there's no new URL/theme
 *  bundled in, just more slots in the room you already have. */
export const PRICE_CAPACITY_ADDON = '¥580'
export const CAPACITY_ADDON_SIZE = 5

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

/** Capacity add-on for the room you're already in — a single option, not a
 *  catalog (there's nothing to bundle into a "collection" here) */
export function capacityPurchaseOptions(): PurchaseOption[] {
  return [
    {
      key: 'addon',
      label: `+${CAPACITY_ADDON_SIZE} works`,
      price: PRICE_CAPACITY_ADDON,
      description: `Raises this room's cap by ${CAPACITY_ADDON_SIZE}, once, forever — stacks with future purchases.`,
    },
  ]
}

/** Design Tools — a single capability unlock, not sold per item */
export function designToolsPurchaseOptions(): PurchaseOption[] {
  return [
    {
      key: 'unlock',
      label: 'Design Tools',
      price: PRICE_DESIGN_TOOLS,
      description: 'Every wall/floor colour, light mood and logo placement — once, forever, in every room you own.',
    },
  ]
}

/** Small eyebrow label above the modal title — gives the price context at a glance */
export function purchaseEyebrow(kind: 'theme' | 'layout' | 'capacity' | 'design-tools'): string {
  switch (kind) {
    case 'theme':
      return 'New theme'
    case 'layout':
      return 'New layout'
    case 'capacity':
      return 'Room capacity'
    case 'design-tools':
      return 'Design Tools'
  }
}
