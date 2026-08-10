// POST /api/stripe/webhook — the ONLY write path into the purchases ledger
// (migration 0016 has no client insert policy on purpose; the service role
// key used here bypasses RLS). Stripe may deliver an event more than once,
// so every write is idempotent: the ledger's unique (user_id, kind, item_key)
// dedupes, and side effects (capacity increment) only run when the ledger row
// was actually inserted by THIS delivery.
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { type Sku, expoDaysForSku } from '@/lib/pricing'
import { paidThemeIds } from '@/lib/entitlements'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

async function insertPurchase(
  db: SupabaseClient,
  row: {
    user_id: string
    kind: string
    item_key: string
    sku: string
    amount_jpy: number | null
    currency: string
  }
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
    // card payments (our case) are always 'paid' here
    return NextResponse.json({ received: true })
  }

  const meta = session.metadata ?? {}
  const userId = meta.user_id ?? session.client_reference_id ?? ''
  const sku = meta.sku as Sku | undefined
  // `amount_total` is in the smallest unit OF `session.currency` — and that is
  // not necessarily the 'usd' we asked for: Managed Payments / Adaptive Pricing
  // can present the buyer their local currency. ¥500 and $5.00 both arrive here
  // as 500, so the amount is meaningless without the currency beside it
  // (migration 0031).
  const amount = typeof session.amount_total === 'number' ? session.amount_total : null
  const currency = (session.currency ?? 'usd').toLowerCase()
  if (!userId || !sku) {
    // Not one of ours (or malformed) — acknowledge so Stripe stops retrying
    console.error('webhook: checkout.session.completed without user_id/sku metadata', session.id)
    return NextResponse.json({ received: true })
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  try {
    switch (sku) {
      case 'single_item': {
        // Whatever the checkout route validated (theme / layout / frame). Unknown
        // values can't reach here — the route rejects them before charging — and
        // the ledger's own check constraint is the last line of defence.
        const kind = meta.item_kind === 'layout' || meta.item_kind === 'frame' ? meta.item_kind : 'theme'
        const itemKey = meta.item_key ?? ''
        if (!itemKey) break
        await insertPurchase(db, { user_id: userId, kind, item_key: itemKey, sku, amount_jpy: amount, currency })
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
          currency,
        })
        if (marker === 'duplicate') break
        // The collection grants every PAID theme (those not in FOREVER_FREE).
        // Reads the same paid catalog checkout sells from, so it fills in
        // automatically the moment a theme is added to THEMES (FOREVER_FREE is a
        // fixed snapshot, so new themes are gatable — lib/entitlements).
        for (const id of paidThemeIds()) {
          // per-theme conflicts are fine — the buyer may already own one singly
          await insertPurchase(db, { user_id: userId, kind: 'theme', item_key: id, sku, amount_jpy: null, currency })
        }
        break
      }
      case 'design_tools': {
        await insertPurchase(db, { user_id: userId, kind: 'design_tools', item_key: '', sku, amount_jpy: amount, currency })
        break
      }
      case 'video_pass': {
        // Flat one-time unlock: a single ledger row (kind='video_pass', item_key='')
        // flips videoEnabled on. Idempotent via the (user_id, kind, item_key) unique key.
        await insertPurchase(db, { user_id: userId, kind: 'video_pass', item_key: '', sku, amount_jpy: amount, currency })
        break
      }
      case 'room': {
        // An extra exhibition room ($25, its full capacity included — ユーザー決定
        // 2026-08-09). Repeat-purchasable, so the ledger row is keyed on the Checkout
        // session (like capacity) rather than on a fixed item_key: `roomAllowance()`
        // counts these rows, and redelivery of the same session is a no-op.
        //
        // Deliberately does NOT create the gallery. The allowance is a count, so the
        // owner builds the room themselves and picks its title/theme/layout — which
        // also means a charge can never leave a half-built room behind, and deleting
        // a room does not burn the purchase.
        await insertPurchase(db, { user_id: userId, kind: 'room', item_key: session.id, sku, amount_jpy: amount, currency })
        break
      }
      case 'capacity_addon': {
        const galleryId = meta.gallery_id ?? ''
        if (!galleryId) {
          console.error('webhook: capacity_addon without gallery_id', session.id)
          break
        }
        // How many slots were bought (set by the checkout route, clamped there so
        // the cap can't exceed the room max). Fall back to 1 for safety.
        const slots = Math.max(1, Math.floor(Number(meta.slot_count ?? '1')) || 1)
        // One atomic call records the charge (keyed on session.id, so redelivery
        // is a no-op) AND bumps the cap in the same transaction. It NEVER deletes
        // the record: a genuinely-charged purchase is always reconcilable even if
        // the room was deleted between checkout and this webhook.
        const { data: result, error: rpcErr } = await db.rpc('record_capacity_purchase', {
          p_session: session.id,
          p_user: userId,
          p_gallery: galleryId,
          p_amount: slots,
          p_amount_jpy: amount, // legacy column name — smallest unit of p_currency
          p_currency: currency,
        })
        if (rpcErr) {
          // A transient DB error — return 500 so Stripe retries; nothing was
          // recorded (the whole function rolled back), so the retry is clean.
          console.error('webhook: record_capacity_purchase failed', session.id, rpcErr.message)
          return NextResponse.json({ error: 'Could not apply capacity.' }, { status: 500 })
        }
        if (result === 'no_gallery') {
          // Charge IS recorded; the room is just gone. Retrying won't help, so
          // ack (200) and log for manual reconciliation instead of looping.
          console.error('webhook: capacity paid but no matching gallery to raise', session.id, galleryId)
        }
        break
      }
      case 'expo_7':
      case 'expo_14':
      case 'expo_30': {
        // 合同展示の場所代（ユーザー決定 2026-08-09）。**支払いと公開は同じ1つの操作**で、
        // `record_expo_purchase` が台帳に記録し、同じ取引で会期を開始する（migration 0044）。
        // 分けると「払ったのに公開されていない」窓ができる。
        //
        // **日数は SKU から引く**（metadata を見ない）。metadata は書き換えられる可能性が
        // あるが、SKU は価格を決めた当のものなので、払った額と会期が必ず一致する。
        const expoId = meta.expo_id ?? ''
        if (!expoId) {
          console.error('webhook: expo sku without expo_id', session.id)
          break
        }
        const days = expoDaysForSku(sku)
        // 公開の予約日時（任意・ユーザー決定 2026-08-10）。壊れていたら「今すぐ公開」に
        // 倒す（省略時と同じ挙動。予約が壊れているせいで永久に非公開のままにしない）。
        const startsAtRaw = meta.starts_at ?? ''
        const startsAtDate = startsAtRaw ? new Date(startsAtRaw) : null
        const startsAtIso = startsAtDate && !Number.isNaN(startsAtDate.getTime()) ? startsAtDate.toISOString() : null
        const { error: rpcErr } = await db.rpc('record_expo_purchase', {
          p_session: session.id,
          p_user: userId,
          p_expo: expoId,
          p_days: days,
          p_amount: amount,
          p_currency: currency,
          p_starts_at: startsAtIso,
        })
        if (rpcErr) {
          // 展示が消えている等の「retryしても直らない」理由と、一時的なDBエラーを
          // 区別する。前者で500を返すとStripeが延々と再送する。
          const permanent = /no such expo|does not belong|unsupported run length/i.test(rpcErr.message)
          if (permanent) {
            // 課金は成立している。手で突き合わせられるように残して ack する。
            console.error('webhook: expo paid but could not start the run', session.id, expoId, rpcErr.message)
            break
          }
          console.error('webhook: record_expo_purchase failed', session.id, rpcErr.message)
          return NextResponse.json({ error: 'Could not start the exhibition run.' }, { status: 500 })
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
