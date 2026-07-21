// POST /api/checkout — creates a Stripe Checkout Session for a one-time SKU
// (REQUIREMENTS.md §11.7: 買い切り = one-time Checkout). The client only says
// WHAT it wants; amounts always come from lib/pricing on this side, so a
// tampered request can't change a price. Returns 501 while billing isn't
// configured — the modal then falls back to the honest "not live yet" note.
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { PRICE_JPY, SKU_LABEL, CAPACITY_ADDON_SIZE, type Sku } from '@/lib/pricing'

export const runtime = 'nodejs'

// video_pass is a subscription (§11.5's only recurring SKU) and 'room' has no
// UI nor entitlement effect yet — selling either here would charge money for
// nothing, so only the wired one-time SKUs are purchasable.
const ONE_TIME_SKUS: readonly Sku[] = ['capacity_addon', 'single_item', 'theme_collection', 'design_tools']

interface CheckoutBody {
  sku?: string
  itemKey?: string
  itemKind?: string
  galleryId?: string
}

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!stripeKey || !supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Billing is not configured yet.' }, { status: 501 })
  }

  // Who is buying — the Supabase access token the signed-in client sent
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!token) return NextResponse.json({ error: 'Sign in to purchase.' }, { status: 401 })
  const asAnon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const { data: userData, error: userErr } = await asAnon.auth.getUser(token)
  const user = userData?.user
  if (userErr || !user) return NextResponse.json({ error: 'Sign in to purchase.' }, { status: 401 })

  let body: CheckoutBody
  try {
    body = (await req.json()) as CheckoutBody
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const sku = body.sku as Sku
  if (!ONE_TIME_SKUS.includes(sku)) {
    return NextResponse.json({ error: 'Unknown or unavailable SKU.' }, { status: 400 })
  }

  const itemKey = (body.itemKey ?? '').trim()
  const itemKind = body.itemKind === 'theme' || body.itemKind === 'layout' ? body.itemKind : ''
  if (sku === 'single_item' && (!itemKey || !itemKind)) {
    return NextResponse.json({ error: 'This purchase needs a theme or layout id.' }, { status: 400 })
  }

  // Capacity add-ons target one specific room — make sure it's the buyer's
  // before charging (the webhook re-verifies via the owner-scoped RPC)
  const galleryId = (body.galleryId ?? '').trim()
  if (sku === 'capacity_addon') {
    if (!galleryId) return NextResponse.json({ error: 'This purchase needs a gallery id.' }, { status: 400 })
    const asUser = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: g } = await asUser.from('galleries').select('id, owner_id').eq('id', galleryId).maybeSingle()
    if (!g || (g as { owner_id?: string }).owner_id !== user.id) {
      return NextResponse.json({ error: 'That room is not yours to upgrade.' }, { status: 403 })
    }
  }

  const amount = PRICE_JPY[sku]
  const label =
    sku === 'capacity_addon'
      ? `${SKU_LABEL[sku]} (+${CAPACITY_ADDON_SIZE})`
      : sku === 'single_item' && itemKey
        ? `${SKU_LABEL[sku]}: ${itemKey}`
        : SKU_LABEL[sku]

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin
  const stripe = new Stripe(stripeKey)
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'jpy', // zero-decimal: unit_amount IS the yen amount
            unit_amount: amount,
            product_data: { name: `Xibit360 — ${label}` },
          },
        },
      ],
      client_reference_id: user.id,
      metadata: { user_id: user.id, sku, item_kind: itemKind, item_key: itemKey, gallery_id: galleryId },
      success_url: `${origin}/me?purchase=success`,
      cancel_url: `${origin}/me?purchase=cancelled`,
    })
    if (!session.url) return NextResponse.json({ error: 'Stripe returned no checkout URL.' }, { status: 502 })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    console.error('checkout session creation failed:', e)
    return NextResponse.json({ error: 'Could not start checkout — please try again.' }, { status: 502 })
  }
}
