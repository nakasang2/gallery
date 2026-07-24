// POST /api/checkout — creates a Stripe Checkout Session for a one-time SKU
// (REQUIREMENTS.md §11.7: 買い切り = one-time Checkout). The client only says
// WHAT it wants; amounts always come from lib/pricing on this side, so a
// tampered request can't change a price. Returns 501 while billing isn't
// configured — the modal then falls back to the honest "not live yet" note.
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { PRICE_USD_CENTS, SKU_LABEL, type Sku } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM, PLAN } from '@/lib/limits'

export const runtime = 'nodejs'

// Only these one-time SKUs are purchasable. Retired/unwired: theme_collection
// (bundle, retired), design_tools (now free), video_pass (subscription, unwired),
// room (no UI/entitlement). See docs/DECISIONS 2026-07-24.
const ONE_TIME_SKUS: readonly Sku[] = ['capacity_addon', 'single_item']

interface CheckoutBody {
  sku?: string
  itemKey?: string
  itemKind?: string
  galleryId?: string
  /** capacity_addon: how many slots to add (sold by quantity) */
  quantity?: number
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

  // Capacity add-ons target one specific room — make sure it's the buyer's, and
  // clamp the quantity so work_cap can never exceed the room's physical max
  // (the webhook re-verifies ownership via the owner-scoped RPC).
  const galleryId = (body.galleryId ?? '').trim()
  let quantity = 1
  if (sku === 'capacity_addon') {
    if (!galleryId) return NextResponse.json({ error: 'This purchase needs a gallery id.' }, { status: 400 })
    const asUser = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: g } = await asUser
      .from('galleries')
      .select('id, owner_id, work_cap')
      .eq('id', galleryId)
      .maybeSingle()
    const row = g as { owner_id?: string; work_cap?: number } | null
    if (!row || row.owner_id !== user.id) {
      return NextResponse.json({ error: 'That room is not yours to upgrade.' }, { status: 403 })
    }
    const currentCap = typeof row.work_cap === 'number' ? row.work_cap : PLAN.worksPerGallery
    const remaining = MAX_WORKS_PER_ROOM - currentCap
    if (remaining <= 0) {
      return NextResponse.json({ error: 'This room is already at the maximum number of works.' }, { status: 409 })
    }
    // Whole number of slots, at least 1, never more than the room can still hold
    const want = Math.floor(Number(body.quantity ?? 1))
    if (!Number.isFinite(want) || want < 1) {
      return NextResponse.json({ error: 'Choose how many slots to add.' }, { status: 400 })
    }
    quantity = Math.min(want, remaining)
  }

  // Per-unit amount in USD cents (Stripe's unit_amount for USD is cents). The
  // capacity line uses Stripe's own quantity so amount_total = unit × quantity.
  const unitAmount = PRICE_USD_CENTS[sku]
  const label =
    sku === 'capacity_addon'
      ? `${SKU_LABEL[sku]} × ${quantity}`
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
          quantity: sku === 'capacity_addon' ? quantity : 1,
          price_data: {
            currency: 'usd', // two-decimal: unit_amount is in cents
            unit_amount: unitAmount,
            product_data: { name: `Xibit360 — ${label}` },
          },
        },
      ],
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        sku,
        item_kind: itemKind,
        item_key: itemKey,
        gallery_id: galleryId,
        slot_count: sku === 'capacity_addon' ? String(quantity) : '',
      },
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
