// GET /api/checkout/verify-session?session_id=... — read back what a completed
// Stripe Checkout session actually charged, so /me can fire a real GA4 `purchase`
// event (リリース前監査 #18: the only purchase signal used to be a bare
// `checkout_return` client event with no value, SKU, or transaction id at all).
//
// Stripe is the only source of truth queried here — not `purchases` — because a
// session's `amount_total`/`currency` is exactly what was charged, whereas the
// ledger row for some kinds (e.g. a Theme Collection: lib/admin.ts) writes the
// price on one row and null on others, which is correct for entitlements but not
// for "what did this specific checkout charge".
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { authenticate } from '@/lib/apiAuth'
import { toMajorUnits } from '@/lib/pricing'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Not configured.' }, { status: 501 })

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const sessionId = req.nextUrl.searchParams.get('session_id') ?? ''
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const stripe = new Stripe(stripeKey)
  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  // `client_reference_id` was set to the buyer's uid at session creation
  // (app/api/checkout/route.ts) — this is what stops one signed-in user from
  // reading back the amount of a session id they merely guessed or copied.
  if (session.client_reference_id !== auth.uid || session.payment_status !== 'paid') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const sku = typeof session.metadata?.sku === 'string' && session.metadata.sku ? session.metadata.sku : 'purchase'
  const itemKey = typeof session.metadata?.item_key === 'string' ? session.metadata.item_key : ''
  const currency = (session.currency ?? 'usd').toLowerCase()
  // `amount_total` is Stripe's smallest-unit integer, and that unit depends on
  // `currency` — a naive `/100` reports ¥500 as ¥5 for JPY (webhook/route.ts's
  // comment on the same field explains why; `toMajorUnits` is the shared fix).
  const value = toMajorUnits(session.amount_total ?? 0, currency)
  // `capacity_addon` is the one SKU sold by quantity (checkout/route.ts sets
  // Stripe's line-item quantity to it and mirrors it into `slot_count`) — GA4's
  // item-level quantity/price should reflect that instead of reporting the
  // whole order total as a single unit.
  const quantity = Math.max(1, Number(session.metadata?.slot_count) || 1)

  return NextResponse.json({
    transactionId: session.id,
    value,
    currency: currency.toUpperCase(),
    items: [
      { item_id: itemKey ? `${sku}:${itemKey}` : sku, item_name: sku, quantity, price: value / quantity },
    ],
  })
}
