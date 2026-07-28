// Prices in USD cents. Stripe's unit_amount for USD is cents, so these values
// are passed straight to Checkout, written by the webhook into
// purchases.amount_jpy (legacy column name — it now stores USD cents; see
// docs/DECISIONS 2026-07-24), and summed by the admin revenue view.
export const PRICE_USD_CENTS = {
  room: 0, // not sold (no UI / entitlement effect yet)
  capacity_addon: 300, // PER SLOT — capacity is sold by quantity now ($3/slot)
  single_item: 500, // one layout ($5); themes cost PRICE_THEME_CENTS (priced apart)
  theme_collection: 0, // retired (docs/DECISIONS 2026-07-24)
  design_tools: 0, // now free for everyone
  video_pass: 0, // not sold (subscription, unwired)
} as const
export type Sku = keyof typeof PRICE_USD_CENTS

export const SKU_LABEL: Record<Sku, string> = {
  room: 'Extra room',
  capacity_addon: 'Work slot',
  single_item: 'Theme / layout',
  theme_collection: 'Theme Collection Vol.1',
  design_tools: 'Design Tools',
  video_pass: 'Video Pass',
}

/** Format USD cents the way the UI shows prices ($5, $3, $12.34). */
export function usd(cents: number): string {
  const d = cents / 100
  return `$${d % 1 === 0 ? d.toFixed(0) : d.toFixed(2)}`
}

// Currencies whose smallest unit IS the unit — no cents to divide by. Stripe
// reports amounts for these as whole yen/won, not hundredths.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

/**
 * Format a recorded charge. Unlike `usd()` this takes the currency Stripe
 * actually billed in (purchases.currency, migration 0031) — a ledger row is
 * only meaningful together with its currency, and ¥500 must never be rendered
 * as $5.00.
 */
export function money(amount: number, currency: string): string {
  const code = (currency || 'usd').toLowerCase()
  const value = ZERO_DECIMAL.has(code) ? amount : amount / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code.toUpperCase(),
      maximumFractionDigits: ZERO_DECIMAL.has(code) ? 0 : 2,
    }).format(value)
  } catch {
    // Unknown/invalid code — show the number with the raw code rather than lie
    return `${value} ${code.toUpperCase()}`
  }
}

/** Per-slot price for capacity add-ons (sold by quantity via a picker, §11.5). */
export const PRICE_PER_SLOT_CENTS = PRICE_USD_CENTS.capacity_addon
export const PRICE_SLOT = usd(PRICE_PER_SLOT_CENTS) // '$3'
// Themes and layouts are both `single_item` purchases but priced apart
// (docs/DECISIONS 2026-07-24): a theme is a bigger visual change than a layout.
export const PRICE_THEME_CENTS = 800
export const PRICE_LAYOUT_CENTS = PRICE_USD_CENTS.single_item // 500
export const PRICE_THEME = usd(PRICE_THEME_CENTS) // '$8'
export const PRICE_LAYOUT = usd(PRICE_LAYOUT_CENTS) // '$5'

export interface PurchaseOption {
  key: string
  label: string
  price: string
  description: string
}

/** Themes and layouts are sold only as a single, solo purchase ($5). The
 *  "Theme Collection Vol.1" bundle was retired (docs/DECISIONS 2026-07-24). */
export function purchaseOptionsFor(kind: 'theme' | 'layout', label: string): PurchaseOption[] {
  return [
    {
      key: 'solo',
      label: `${label} only`,
      price: kind === 'theme' ? PRICE_THEME : PRICE_LAYOUT,
      description: `Unlocks just this ${kind}, once, forever.`,
    },
  ]
}

/** Small eyebrow label above the modal title — gives the price context at a glance */
export function purchaseEyebrow(kind: 'theme' | 'layout' | 'capacity'): string {
  switch (kind) {
    case 'theme':
      return 'New theme'
    case 'layout':
      return 'New layout'
    case 'capacity':
      return 'Room capacity'
  }
}
