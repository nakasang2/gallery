// Client side of the Stripe checkout flow (REQUIREMENTS.md §11.7). The modal
// calls startCheckout() with what the user picked; the server route owns the
// prices and creates the Checkout Session. When billing isn't configured
// (no STRIPE_SECRET_KEY on the server, no Supabase, signed out) the caller
// falls back to the same honest "not live yet" note as before — a missing
// key must never look like a broken buy button.
import { supabase } from './supabase'
import type { Sku } from './pricing'

export interface PurchaseIntent {
  kind: 'theme' | 'layout' | 'capacity' | 'design-tools'
  /** theme/layout id being bought; '' for capacity and design-tools */
  itemKey: string
  /** the room receiving a capacity add-on (required for kind 'capacity') */
  galleryId?: string
}

export type CheckoutStart = { kind: 'redirect'; url: string } | { kind: 'unavailable' }

/** Map the modal's selection to the server's SKU vocabulary (lib/pricing PRICE_JPY). */
export function resolveSku(intent: PurchaseIntent, optionKey: string): { sku: Sku; itemKey: string } {
  if (intent.kind === 'capacity') return { sku: 'capacity_addon', itemKey: '' }
  if (intent.kind === 'design-tools') return { sku: 'design_tools', itemKey: '' }
  if (optionKey === 'collection') return { sku: 'theme_collection', itemKey: '' }
  return { sku: 'single_item', itemKey: intent.itemKey }
}

export async function startCheckout(intent: PurchaseIntent, optionKey: string): Promise<CheckoutStart> {
  if (!supabase) return { kind: 'unavailable' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { kind: 'unavailable' }

  const { sku, itemKey } = resolveSku(intent, optionKey)
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      sku,
      itemKey,
      itemKind: intent.kind === 'theme' || intent.kind === 'layout' ? intent.kind : undefined,
      galleryId: intent.galleryId,
    }),
  })
  if (res.status === 501) return { kind: 'unavailable' }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Checkout failed (${res.status}).`)
  }
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error('Checkout failed — no redirect URL returned.')
  return { kind: 'redirect', url }
}
