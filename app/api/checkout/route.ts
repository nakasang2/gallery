// POST /api/checkout — creates a Stripe Checkout Session for a one-time SKU
// (REQUIREMENTS.md §11.7: 買い切り = one-time Checkout). The client only says
// WHAT it wants; amounts always come from lib/pricing on this side, so a
// tampered request can't change a price. Returns 501 while billing isn't
// configured — the modal then falls back to the honest "not live yet" note.
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { PRICE_USD_CENTS, itemPriceCents, isExpoSku, paidIdsFor, SKU_LABEL, type PaidKind, type Sku } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM, PLAN } from '@/lib/limits'

export const runtime = 'nodejs'

// Only these one-time SKUs are purchasable. Retired/unwired: theme_collection
// (bundle, retired), design_tools (now free). video_pass is a live buy-once unlock
// ($20, ユーザー決定 2026-08-03); `room` is a repeat-purchasable extra exhibition
// room ($25 with its full capacity included, ユーザー決定 2026-08-09). See
// docs/DECISIONS 2026-07-24 / 2026-08-09.
// `expo_7/14/30` は合同展示の場所代（会期ごとに別SKU＝価格も日数もSKUから一意に決まる。
// ユーザー決定 2026-08-09）。
const ONE_TIME_SKUS: readonly Sku[] = [
  'capacity_addon', 'single_item', 'video_pass', 'room', 'expo_7', 'expo_14', 'expo_30',
]

// Managed Payments (enabled on the account — Stripe acts as merchant of record
// and remits tax globally) requires an eligible tax code on every line item.
// Our SKUs (extra slots, themes, layouts) are electronically-supplied digital
// services; txcd_10000000 = "General - Electronically Supplied Services", a safe
// general fit. Refine in Stripe's tax-code list if a more specific category
// applies (docs/DECISIONS 2026-07-27).
const STRIPE_TAX_CODE = 'txcd_10000000'

// What `single_item` can be. Frames joined in 2026-07-29 (migration 0034 taught
// the ledger the 'frame' kind — without it the webhook's insert would fail the
// check constraint AFTER the customer had paid).
const PAID_KINDS: readonly PaidKind[] = ['theme', 'layout', 'frame']

interface CheckoutBody {
  sku?: string
  itemKey?: string
  itemKind?: string
  galleryId?: string
  /** capacity_addon: how many slots to add (sold by quantity) */
  quantity?: number
  /** expo_*: どの合同展示の場所代か */
  expoId?: string
  /** expo_*: いつから見せるかの予約（ISO文字列。省略=支払い完了と同時に公開。
   *  ユーザー指示 2026-08-10、上限なし）。 */
  startsAt?: string
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
  // Acting as the caller (RLS-scoped to their own rows) for every read below —
  // one client, reused, instead of a fresh one per check.
  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

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
  const itemKind = PAID_KINDS.includes(body.itemKind as PaidKind) ? (body.itemKind as PaidKind) : ''
  if (sku === 'single_item') {
    if (!itemKey || !itemKind) {
      return NextResponse.json({ error: 'This purchase needs a theme, layout or frame id.' }, { status: 400 })
    }
    // The id has to be something we actually sell. Without this an id that no
    // longer exists (or one that is free for everyone) would still be charged —
    // at the kind's base price, which is exactly the wrong number now that each
    // item can carry its own (lib/pricing → ITEM_PRICE_CENTS).
    if (!paidIdsFor(itemKind).includes(itemKey)) {
      return NextResponse.json({ error: 'That is not something we sell.' }, { status: 400 })
    }
  }

  // Refuse to re-sell something already owned. Without this, a stale tab or a
  // double-click creates a second Checkout Session and charges the card again —
  // the webhook's ledger insert then silently no-ops on the (user_id, kind,
  // item_key) unique key ('duplicate'), so the second charge is real but never
  // recorded anywhere reconcilable (found in the pre-release audit).
  if (sku === 'single_item' || sku === 'video_pass') {
    const ownedQuery =
      sku === 'single_item'
        ? asUser.from('purchases').select('id').eq('kind', itemKind).eq('item_key', itemKey).limit(1)
        : asUser.from('purchases').select('id').eq('kind', 'video_pass').limit(1)
    const { data: owned, error: ownedErr } = await ownedQuery.maybeSingle()
    // Fail closed: a DB hiccup here must not silently fall through to "not
    // owned, charge them" — that's exactly the case this check exists for.
    if (ownedErr) {
      console.error('checkout: could not verify existing ownership', ownedErr.message)
      return NextResponse.json({ error: 'Could not verify your purchases — please try again.' }, { status: 503 })
    }
    if (owned) {
      return NextResponse.json({ error: 'You already own this.' }, { status: 409 })
    }
  }

  // Capacity add-ons target one specific room — make sure it's the buyer's, and
  // clamp the quantity so work_cap can never exceed the room's physical max
  // (the webhook re-verifies ownership via the owner-scoped RPC).
  const galleryId = (body.galleryId ?? '').trim()
  let quantity = 1
  if (sku === 'capacity_addon') {
    if (!galleryId) return NextResponse.json({ error: 'This purchase needs a gallery id.' }, { status: 400 })
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

  // 合同展示の場所代。**自分の展示で、まだ会期が始まっていないもの**にしか払わせない。
  // 二重課金を止めるのが主眼: 会期が始まっている展示にもう一度払えると、
  // `record_expo_purchase` 側は台帳に行を足すだけ（`starts_at is null` の行しか
  // 更新しない）ので、**お金だけ取って何も起きない**。
  const expoId = (body.expoId ?? '').trim()
  if (isExpoSku(sku)) {
    if (!expoId) {
      return NextResponse.json({ error: 'This purchase needs an exhibition id.' }, { status: 400 })
    }
    const { data: x } = await asUser
      .from('expos')
      .select('id, owner_id, starts_at, ends_at')
      .eq('id', expoId)
      .maybeSingle()
    const row = x as { owner_id?: string; starts_at?: string | null; ends_at?: string | null } | null
    if (!row || row.owner_id !== user.id) {
      return NextResponse.json({ error: 'That exhibition is not yours.' }, { status: 403 })
    }
    // 会期が既に決まっている＝もう払われている。**「開催中です」と決めつけない**
    // （2026-08-14 に直した）── 終わった展示にもう一度払おうとしたときにも同じ文が
    // 出ていて、終わっているのに「開催中」と言っていた。同じ展示で次の会期は立てられない
    // （`record_expo_purchase` が2件目を黙って抜ける）ので、新しく作る案内まで出す。
    if (row.starts_at) {
      const ended = !!row.ends_at && new Date(row.ends_at).getTime() < Date.now()
      return NextResponse.json(
        {
          error: ended
            ? 'That exhibition’s run has finished. Create a new exhibition to open another run.'
            : 'That exhibition already has a run booked.',
        },
        { status: 409 }
      )
    }
  }

  // 公開の予約日時（任意・上限なし・ユーザー決定 2026-08-10）。壊れた値をStripeの
  // metadataに乗せて後で困るより、ここで一度パースして弾く。
  let startsAtIso = ''
  if (isExpoSku(sku) && body.startsAt) {
    const d = new Date(body.startsAt)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'That start date is not valid.' }, { status: 400 })
    }
    startsAtIso = d.toISOString()
  }

  // Per-unit amount in USD cents (Stripe's unit_amount for USD is cents). The
  // capacity line uses Stripe's own quantity so amount_total = unit × quantity.
  // single_item is priced per item: the kind's base price ($8 theme / $5 layout /
  // $3 frame) unless that particular id has its own entry in ITEM_PRICE_CENTS. The
  // client never sends an amount, so this stays the only place a price is decided.
  const unitAmount =
    sku === 'single_item' && itemKind
      ? itemPriceCents(itemKind, itemKey)
      : PRICE_USD_CENTS[sku]
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
            product_data: { name: `Xibit360 — ${label}`, tax_code: STRIPE_TAX_CODE },
          },
        },
      ],
      client_reference_id: user.id,
      // No `custom_text` here: Managed Payments rejects it outright ("custom_text
      // cannot be used with Managed Payments"), and Stripe's own checkout page is
      // theirs to word once they are the merchant of record. `consent_collection`
      // is no way out either — it needs a Terms URL set in the dashboard. The
      // buyer agreed to the Terms when they signed up (the purchase modal repeats
      // the notice under its CTA), and metadata below records which agreement the
      // purchase went through — metadata Managed Payments does allow
      // (docs/LESSONS 2026-07-29).
      metadata: {
        user_id: user.id,
        sku,
        item_kind: itemKind,
        item_key: itemKey,
        gallery_id: galleryId,
        slot_count: sku === 'capacity_addon' ? String(quantity) : '',
        // 会期の日数は metadata に入れない。**SKU から引く**（`expoDaysForSku`）ので、
        // metadata が書き換わっても払った長さは変わらない。
        expo_id: isExpoSku(sku) ? expoId : '',
        // 公開の予約日時（任意）。書き換えられても実害は「公開される日時が変わる」
        // だけ ── 会期の長さも料金もSKUで固定されているので、決済の額は変わらない。
        starts_at: startsAtIso,
        // Which acknowledgement the buyer passed through, not free prose: the
        // wording itself lives in lib/i18n (`purchase.agreeNote`) and the Terms.
        consent: 'terms-accepted', // i18n-ok: 対人文言ではなくStripeの記録用の識別子
      },
      // `{CHECKOUT_SESSION_ID}` is a literal Stripe placeholder — it substitutes the
      // real id into the redirect URL. Without it, /me had no way to know WHICH
      // purchase completed, so the GA4 event it fired carried no value/SKU/
      // transaction id at all (リリース前監査 #18). /api/checkout/verify-session
      // reads this back server-side (Stripe is the only source of the real amount).
      success_url: `${origin}/me?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/me?purchase=cancelled`,
    })
    if (!session.url) return NextResponse.json({ error: 'Stripe returned no checkout URL.' }, { status: 502 })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    console.error('checkout session creation failed:', e)
    return NextResponse.json({ error: 'Could not start checkout — please try again.' }, { status: 502 })
  }
}
