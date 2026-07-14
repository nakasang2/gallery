// POST /api/stripe/webhook — the ONLY write path into the purchases ledger
// (migration 0016 has no client insert policy on purpose; the service role
// key used here bypasses RLS). Stripe may deliver an event more than once,
// so every write is idempotent: the ledger's unique (user_id, kind, item_key)
// dedupes, and side effects (capacity increment) only run when the ledger row
// was actually inserted by THIS delivery.
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CAPACITY_ADDON_SIZE, type Sku } from '@/lib/pricing'
import { getEntitlements, isThemeUnlocked } from '@/lib/entitlements'
import { THEMES } from '@/lib/presets'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

async function insertPurchase(
  db: SupabaseClient,
  row: { user_id: string; kind: string; item_key: string; sku: string; amount_jpy: number | null }
): Promise<'inserted' | 'duplicate'> {
  const { error } = await db.from('purchases').insert(row)
  if (!error) return 'inserted'
  if (error.code === UNIQUE_VIOLATION) return 'duplicate'
  throw new Error(`purchases insert failed: ${error.message}`)
}

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Billing is not configured yet.' }, { status: 501 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 })
  const payload = await req.text()

  const stripe = new Stripe(stripeKey)
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true })
  }
  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') {
    // async payment methods land later via checkout.session.async_payment_succeeded;
    // JPY card payments (our case) are always 'paid' here
    return NextResponse.json({ received: true })
  }

  const meta = session.metadata ?? {}
  const userId = meta.user_id ?? session.client_reference_id ?? ''
  const sku = meta.sku as Sku | undefined
  const amount = typeof session.amount_total === 'number' ? session.amount_total : null
  if (!userId || !sku) {
    // Not one of ours (or malformed) — acknowledge so Stripe stops retrying
    console.error('webhook: checkout.session.completed without user_id/sku metadata', session.id)
    return NextResponse.json({ received: true })
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  try {
    switch (sku) {
      case 'single_item': {
        const kind = meta.item_kind === 'layout' ? 'layout' : 'theme'
        const itemKey = meta.item_key ?? ''
        if (!itemKey) break
        await insertPurchase(db, { user_id: userId, kind, item_key: itemKey, sku, amount_jpy: amount })
        break
      }
      case 'theme_collection': {
        // §11.8: the collection is a snapshot of the PAID catalog at purchase
        // time. Revenue lives on the collection row; the per-theme rows carry
        // no amount so the admin sum never double-counts.
        const marker = await insertPurchase(db, {
          user_id: userId,
          kind: 'theme_collection',
          item_key: '',
          sku,
          amount_jpy: amount,
        })
        if (marker === 'duplicate') break
        const noOwnership = getEntitlements(null)
        const paidThemeIds = Object.keys(THEMES).filter((id) => !isThemeUnlocked(id, noOwnership))
        for (const id of paidThemeIds) {
          // per-theme conflicts are fine — the buyer may already own one singly
          await insertPurchase(db, { user_id: userId, kind: 'theme', item_key: id, sku, amount_jpy: null })
        }
        break
      }
      case 'design_tools': {
        await insertPurchase(db, { user_id: userId, kind: 'design_tools', item_key: '', sku, amount_jpy: amount })
        break
      }
      case 'capacity_addon': {
        const galleryId = meta.gallery_id ?? ''
        if (!galleryId) {
          console.error('webhook: capacity_addon without gallery_id', session.id)
          break
        }
        // item_key = session id → each add-on purchase is its own ledger row,
        // and a redelivered event dedupes instead of incrementing twice
        const marker = await insertPurchase(db, {
          user_id: userId,
          kind: 'capacity',
          item_key: session.id,
          sku,
          amount_jpy: amount,
        })
        if (marker === 'duplicate') break
        const { data: newCap, error: rpcErr } = await db.rpc('apply_capacity_addon', {
          p_gallery: galleryId,
          p_owner: userId,
          p_amount: CAPACITY_ADDON_SIZE,
        })
        if (rpcErr || newCap == null) {
          // Roll the ledger row back so a Stripe retry can attempt the whole
          // unit again — otherwise the row would mark this delivery "done"
          // while the cap was never raised.
          await db.from('purchases').delete().eq('user_id', userId).eq('kind', 'capacity').eq('item_key', session.id)
          console.error('webhook: apply_capacity_addon failed', session.id, rpcErr?.message ?? 'no matching gallery')
          return NextResponse.json({ error: 'Could not apply capacity.' }, { status: 500 })
        }
        break
      }
      default: {
        console.error('webhook: unhandled sku', sku, session.id)
        break
      }
    }
  } catch (e) {
    console.error('webhook processing failed:', e)
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
