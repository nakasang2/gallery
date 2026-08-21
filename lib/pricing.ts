import { paidThemeIds, paidLayoutIds, paidFrameIds } from './entitlements'

// Prices in USD cents. Stripe's unit_amount for USD is cents, so these values
// are passed straight to Checkout, written by the webhook into
// purchases.amount_jpy (legacy column name — it now stores USD cents; see
// docs/DECISIONS 2026-07-24), and summed by the admin revenue view.
export const PRICE_USD_CENTS = {
  // An extra exhibition room, with that room's full physical capacity
  // (MAX_WORKS_PER_ROOM slots) included — ユーザー決定 2026-08-09. Repeat-purchasable:
  // each one raises `roomAllowance()` by 1. The room's theme and layout are NOT
  // included; those stay their own single_item purchases, chosen per room.
  room: 2500,
  capacity_addon: 300, // PER SLOT — capacity is sold by quantity now ($3/slot)
  single_item: 500, // base for one layout ($5); themes/frames have their own base
  theme_collection: 0, // retired (docs/DECISIONS 2026-07-24)
  design_tools: 0, // now free for everyone
  video_pass: 2000, // one-time $20 — buy once, exhibit video forever (ユーザー決定 2026-08-03)
  // 合同展示の場所代（ユーザー決定 2026-08-09）。**会期の長さで決まる**一律料金で、
  // 主催者が**公開時に1回**払う。参加作家は無料。会期ごとに別SKUにしてあるのは、
  // 価格が SKU から一意に決まる＝**クライアントが金額にも日数にも触れない**ため
  // （日数を引数で受けると、そこが値段を動かす入口になる）。
  // DB 側の `expo_days_allowed()`（migration 0044）と対で保つこと。
  expo_7: 1500,
  expo_14: 2500,
  expo_30: 4000,
} as const
export type Sku = keyof typeof PRICE_USD_CENTS

export const SKU_LABEL: Record<Sku, string> = {
  room: 'Extra exhibition room',
  capacity_addon: 'Work slot',
  single_item: 'Theme / layout / frame',
  theme_collection: 'Theme Collection Vol.1',
  design_tools: 'Design Tools',
  video_pass: 'Video Pass',
  // i18n-ok: Stripe の決済ページに出る商品名。Stripe 側は英語なので訳さない
  // （既存の SKU_LABEL と同じ扱い）。
  expo_7: 'Joint exhibition — 7 days',
  expo_14: 'Joint exhibition — 14 days',
  expo_30: 'Joint exhibition — 30 days',
}

/** 合同展示の会期SKU。価格も日数もここから一意に決まる。 */
export const EXPO_SKUS = ['expo_7', 'expo_14', 'expo_30'] as const
export type ExpoSku = (typeof EXPO_SKUS)[number]

/** その SKU が合同展示の場所代か。 */
export function isExpoSku(sku: string): sku is ExpoSku {
  return (EXPO_SKUS as readonly string[]).includes(sku)
}

/** SKU → 会期の日数。**SKU名から機械的に出す**ので、価格表と日数がずれない。 */
export function expoDaysForSku(sku: ExpoSku): number {
  return Number(sku.slice('expo_'.length))
}

/** 日数 → SKU。無い長さなら null（DBの `expo_days_allowed` と同じ集合）。 */
export function expoSkuForDays(days: number): ExpoSku | null {
  const sku = `expo_${days}`
  return isExpoSku(sku) ? sku : null
}

/** 主催者に見せる選択肢（短い順）。 */
export function expoRunOptions(): { sku: ExpoSku; days: number; cents: number }[] {
  return EXPO_SKUS.map((sku) => ({ sku, days: expoDaysForSku(sku), cents: PRICE_USD_CENTS[sku] }))
}

/** Format USD cents the way the UI shows prices ($5, $3, $12.34). */
export function usd(cents: number): string {
  const d = cents / 100
  return `$${d % 1 === 0 ? d.toFixed(0) : d.toFixed(2)}`
}

/**
 * 合同展示の場所代を公開の価格表示で名乗るときの幅（'$15–$40'）。会期ごとに値段が
 * 違うので、**会期の集合から導出する** — 会期を1つ足しても、LPが古い幅を名乗ったまま
 * 置き去りにならない（`priceRangeLabel` と同じ作法・AGENTS.md 5.3）。
 *
 * `EXPO_SKUS` は空になりえない const タプルなので、`priceRangeLabel` が持っている
 * 「売り物ゼロ」の分岐はここには要らない（要らない分岐を書くと、通らないコードが
 * 検証済みのふりをする — docs/LESSONS「保険として書いたコード」）。
 *
 * @param rangeFormat 幅の書式。`t('lp.priceRange')` を渡す（日本語の幅は – ではなく 〜）。
 */
export function expoPriceRangeLabel(rangeFormat = '{min}–{max}'): string {
  const prices = expoRunOptions().map((o) => o.cents)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  if (min === max) return usd(min)
  return rangeFormat.replace('{min}', usd(min)).replace('{max}', usd(max))
}

// Currencies whose smallest unit IS the unit — no cents to divide by. Stripe
// reports amounts for these as whole yen/won, not hundredths.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

/**
 * Stripe's smallest-unit integer (`amount_total` etc.) → the actual currency
 * value. Exported so every reader of a Stripe amount — not just `money()` —
 * shares the same zero-decimal-currency rule instead of re-deriving it (a
 * naive `/100` under-reports JPY/KRW by 100x — this bit an earlier GA4
 * purchase-value read, see app/api/checkout/verify-session/route.ts).
 */
export function toMajorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has((currency || 'usd').toLowerCase()) ? amount : amount / 100
}

/**
 * Format a recorded charge. Unlike `usd()` this takes the currency Stripe
 * actually billed in (purchases.currency, migration 0031) — a ledger row is
 * only meaningful together with its currency, and ¥500 must never be rendered
 * as $5.00.
 */
export function money(amount: number, currency: string): string {
  const code = (currency || 'usd').toLowerCase()
  const value = toMajorUnits(amount, code)
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
/** One-time Video Pass price — unlock exhibiting video works forever (§ pricing). */
export const PRICE_VIDEO_PASS = usd(PRICE_USD_CENTS.video_pass) // '$20'
/** One extra exhibition room, its full capacity included (ユーザー決定 2026-08-09). */
export const PRICE_ROOM = usd(PRICE_USD_CENTS.room) // '$25'
// Themes and layouts are both `single_item` purchases but priced apart
// (docs/DECISIONS 2026-07-24): a theme is a bigger visual change than a layout.
// These are the BASE prices — what an item costs unless ITEM_PRICE_CENTS below
// gives that particular theme/layout its own price.
export const PRICE_THEME_CENTS = 800
export const PRICE_LAYOUT_CENTS = PRICE_USD_CENTS.single_item // 500
// A frame is a smaller change than a whole room and it is chosen per work, so it
// sits at the slot price rather than the layout's (ユーザー判断 2026-07-29).
export const PRICE_FRAME_CENTS = 300

/* ================= Per-item prices ================= */

export type PaidKind = 'theme' | 'layout' | 'frame'

/**
 * Prices for individual themes/layouts/frames, in USD cents. An id that isn't listed
 * here costs its kind's base price above, so shipping a normally-priced theme
 * stays a one-line change in lib/presets — put an id here only to charge
 * something different (a more elaborate theme, an introductory price).
 *
 * THE price table: /api/checkout reads it for Stripe's unit_amount, the purchase
 * modal reads it for the price it shows, and the public price copy derives its
 * range from it — so the amount charged, the amount shown and the amount
 * advertised cannot drift apart.
 *
 * Prices live in code rather than in the database on purpose: a theme and its
 * price ship in the same commit, and an amount nobody can edit at runtime is one
 * fewer way to charge the wrong number.
 */
export const ITEM_PRICE_CENTS: Record<PaidKind, Record<string, number>> = {
  theme: {},
  layout: {},
  frame: {},
}

const BASE_PRICE_CENTS: Record<PaidKind, number> = {
  theme: PRICE_THEME_CENTS,
  layout: PRICE_LAYOUT_CENTS,
  frame: PRICE_FRAME_CENTS,
}

const PAID_IDS: Record<PaidKind, () => string[]> = {
  theme: paidThemeIds,
  layout: paidLayoutIds,
  frame: paidFrameIds,
}

/** Everything of this kind that is on sale. Empty is a real answer (no paid frame
 *  has shipped yet) — callers must not read an empty list as "not implemented". */
export function paidIdsFor(kind: PaidKind): string[] {
  return PAID_IDS[kind]()
}

/** What this one theme/layout costs, in USD cents. */
export function itemPriceCents(kind: PaidKind, itemKey: string): number {
  return ITEM_PRICE_CENTS[kind][itemKey] ?? BASE_PRICE_CENTS[kind]
}

/**
 * The price to quote publicly for a whole kind: a single price while every
 * theme (or layout) on sale costs the same, a range ('$8–$12') as soon as one
 * differs. Derived from the table rather than written into the copy, so a new
 * price can never leave the landing page or the 特商法 page claiming a flat
 * "$8 each" (AGENTS.md 5.3).
 *
 * @param rangeFormat how to join the two ends — pass `t('lp.priceRange')` so the
 *        punctuation follows the language (Japanese ranges read 〜, not –). The
 *        default keeps the function usable without a dictionary.
 */
export function priceRangeLabel(kind: PaidKind, rangeFormat = '{min}–{max}'): string {
  const prices = paidIdsFor(kind).map((id) => itemPriceCents(kind, id))
  // Nothing of this kind on sale (every one is forever-free): quote the base
  // price rather than an empty string — the copy still has a slot to fill.
  if (!prices.length) return usd(BASE_PRICE_CENTS[kind])
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  if (min === max) return usd(min)
  return rangeFormat.replace('{min}', usd(min)).replace('{max}', usd(max))
}

// The modal's own copy (eyebrow, "{name} only", "Unlocks just this…") used to be
// built here as English strings. It now lives in the dictionary and is assembled
// in components/PurchaseModal — this file only decides amounts. `check:i18n` does
// not scan lib/, so English written here is invisible to the guardian and shipped
// to every language (docs/LESSONS 2026-07-29).
