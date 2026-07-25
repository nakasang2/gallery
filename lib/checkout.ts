// Client side of the Stripe checkout flow (REQUIREMENTS.md §11.7). The modal
// calls startCheckout() with what the user picked; the server route owns the
// prices and creates the Checkout Session. When billing isn't configured
// (no STRIPE_SECRET_KEY on the server, no Supabase, signed out) the caller
// falls back to the same honest "not live yet" note as before — a missing
// key must never look like a broken buy button.
import { supabase } from './supabase'
import type { Sku } from './pricing'

export interface PurchaseIntent {
  kind: 'theme' | 'layout' | 'capacity'
  /** theme/layout id being bought; '' for capacity */
  itemKey: string
  /** the room receiving a capacity add-on (required for kind 'capacity') */
  galleryId?: string
}

/** Why checkout could not start. The two cases look identical to a user staring
 *  at the modal but have completely different fixes — 'signed-out' is on them,
 *  'not-configured' means the server has no STRIPE_SECRET_KEY yet — so they must
 *  never collapse into one message (that ambiguity is what made a live-looking
 *  build indistinguishable from an unconfigured one). */
export type CheckoutUnavailableReason = 'signed-out' | 'not-configured'

export type CheckoutStart =
  | { kind: 'redirect'; url: string }
  | { kind: 'unavailable'; reason: CheckoutUnavailableReason }

/** Map the modal's selection to the server's SKU vocabulary (lib/pricing). */
export function resolveSku(intent: PurchaseIntent): { sku: Sku; itemKey: string } {
  if (intent.kind === 'capacity') return { sku: 'capacity_addon', itemKey: '' }
  // Themes and layouts are sold only as single items ($5 each); Design Tools is
  // free and the Theme Collection bundle was retired (docs/DECISIONS 2026-07-24).
  return { sku: 'single_item', itemKey: intent.itemKey }
}

/** @param quantity capacity only — how many slots to add (default 1) */
export async function startCheckout(intent: PurchaseIntent, quantity = 1): Promise<CheckoutStart> {
  if (!supabase) return { kind: 'unavailable', reason: 'not-configured' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { kind: 'unavailable', reason: 'signed-out' }

  const { sku, itemKey } = resolveSku(intent)
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      sku,
      itemKey,
      itemKind: intent.kind === 'theme' || intent.kind === 'layout' ? intent.kind : undefined,
      galleryId: intent.galleryId,
      quantity: intent.kind === 'capacity' ? quantity : undefined,
    }),
  })
  if (res.status === 501) {
    // The server is up and the route exists — it just has no billing env. Say so
    // in the console: from the outside this is indistinguishable from a dead
    // button, and it's the single most common reason a "shipped" checkout does
    // nothing (env added in Vercel but never redeployed — env is baked per build).
    console.warn(
      '[checkout] /api/checkout returned 501 — billing env is missing on the server ' +
        '(STRIPE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). ' +
        'Check GET /api/checkout for which one, then redeploy.'
    )
    return { kind: 'unavailable', reason: 'not-configured' }
  }
  if (res.status === 401) return { kind: 'unavailable', reason: 'signed-out' }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Checkout failed (${res.status}).`)
  }
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error('Checkout failed — no redirect URL returned.')
  return { kind: 'redirect', url }
}
