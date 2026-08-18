// Client side of the Stripe checkout flow (REQUIREMENTS.md §11.7). The modal
// calls startCheckout() with what the user picked; the server route owns the
// prices and creates the Checkout Session. When billing isn't configured
// (no STRIPE_SECRET_KEY on the server, no Supabase, signed out) the caller
// falls back to the same honest "not live yet" note as before — a missing
// key must never look like a broken buy button.
import { supabase, accessToken } from './supabase'
import type { PaidKind, Sku } from './pricing'

export interface PurchaseIntent {
  kind: PaidKind | 'capacity' | 'video_pass' | 'room'
  /** theme/layout/frame id being bought; '' for capacity, video_pass and room */
  itemKey: string
  /** the room receiving a capacity add-on (required for kind 'capacity') */
  galleryId?: string
}

export type CheckoutStart =
  | { kind: 'redirect'; url: string }
  /** Billing genuinely isn't switched on (no Stripe key on the server). */
  | { kind: 'unavailable' }
  /** Signed out, or a stored session that could not be refreshed. A different
   *  answer from `unavailable` on purpose: these two used to share one return
   *  value, so a lapsed sign-in told the buyer the feature did not exist yet
   *  (docs/LESSONS 2026-07-29). */
  | { kind: 'signed-out' }

/** Map the modal's selection to the server's SKU vocabulary (lib/pricing). */
export function resolveSku(intent: PurchaseIntent): { sku: Sku; itemKey: string } {
  if (intent.kind === 'capacity') return { sku: 'capacity_addon', itemKey: '' }
  // Video Pass is a flat one-time SKU — no item, no quantity (ユーザー決定 2026-08-03).
  if (intent.kind === 'video_pass') return { sku: 'video_pass', itemKey: '' }
  // An extra room is flat too: its capacity is included, so there is no quantity to
  // pick, and the room itself is built afterwards (ユーザー決定 2026-08-09).
  if (intent.kind === 'room') return { sku: 'room', itemKey: '' }
  // Themes, layouts and frames all travel as one `single_item` SKU; the server
  // prices them per item (ITEM_PRICE_CENTS) from itemKind + itemKey. Design Tools
  // is free and the Theme Collection bundle was retired (DECISIONS 2026-07-24).
  return { sku: 'single_item', itemKey: intent.itemKey }
}

/** @param quantity capacity only — how many slots to add (default 1) */
export async function startCheckout(intent: PurchaseIntent, quantity = 1): Promise<CheckoutStart> {
  if (!supabase) return { kind: 'unavailable' }
  const token = await accessToken()
  if (!token) return { kind: 'signed-out' }

  const { sku, itemKey } = resolveSku(intent)
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      sku,
      itemKey,
      // itemKind only names the single_item flavour (theme/layout/frame); flat SKUs
      // (capacity, video_pass) don't carry one.
      itemKind:
        intent.kind === 'capacity' || intent.kind === 'video_pass' || intent.kind === 'room'
          ? undefined
          : intent.kind,
      galleryId: intent.galleryId,
      quantity: intent.kind === 'capacity' ? quantity : undefined,
    }),
  })
  if (res.status === 501) return { kind: 'unavailable' }
  // The token was accepted by Supabase a moment ago but rejected here — same
  // dead end for the buyer as having no token at all, so say the same thing.
  if (res.status === 401) return { kind: 'signed-out' }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Checkout failed (${res.status}).`)
  }
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error('Checkout failed — no redirect URL returned.')
  return { kind: 'redirect', url }
}
