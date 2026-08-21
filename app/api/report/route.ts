// POST /api/report — take a DMCA/abuse report (リリース前監査 #11・2026-08-21).
//
// This used to be a direct `supabase.from('reports').insert()` from the browser,
// governed by an RLS policy of `with check (true)` — sign-in-free BY DESIGN (a
// rights holder should not have to create an account to file a takedown notice),
// but also rate-limit-free, so the same anon key let anyone flood the table and
// take the admin console down with it (fetchAdminOverview pages the whole thing).
//
// Moving the write here does nothing by itself — the anon key is public, so a
// caller could still hit Supabase's REST endpoint directly and skip this route
// entirely, UNLESS the RLS policy that allowed it is gone. Migration 0072 removes
// that policy, so `reports` now only accepts writes from service_role — i.e. only
// from here. That is what makes the rate limit below actually mean something.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'

const MAX_REPORTS = 5
const WINDOW_SECONDS = 3600

const KINDS = new Set(['copyright', 'harassment', 'illegal', 'other'])

/** Column not present yet (migration 0056 not applied to this DB). Match by
 *  error CODE only — matching on message text or table name would also catch
 *  unrelated failures on this same table (docs/LESSONS 2026-08-09). */
const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

/** Vercel's edge sets this from the real connecting client; a caller can prepend
 *  fake entries of their own, so this is a deterrent, not a cryptographic
 *  guarantee — enough to make flooding cost more than one click. */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Reporting is not configured.' }, { status: 501 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const about = String(body.about ?? '').trim().slice(0, 200)
  const contact = String(body.contact ?? '').trim().slice(0, 200)
  const reason = String(body.reason ?? '').trim().slice(0, 1000)
  const kindRaw = String(body.kind ?? 'other')
  const kind = KINDS.has(kindRaw) ? kindRaw : 'other'
  const claimant = String(body.claimant ?? '').trim().slice(0, 200)
  const workIdentified = String(body.workIdentified ?? '').trim().slice(0, 1000)
  const sworn = body.sworn === true

  if (!reason) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  const ip = clientIp(req)
  // checkRateLimit fails OPEN on a missing migration — the pre-existing
  // "the entry point for something the law requires must never go dark" rule
  // (see lib/engagement.ts history) applies here too.
  const withinLimit = await checkRateLimit(db, { bucket: 'report_ip', key: ip, max: MAX_REPORTS, windowSeconds: WINDOW_SECONDS })
  if (!withinLimit) {
    return NextResponse.json(
      { error: 'Too many reports from this network. Please try again later.' },
      { status: 429 }
    )
  }

  const { error } = await db
    .from('reports')
    .insert({ about, reason, contact, kind, claimant, work_identified: workIdentified, sworn })
  if (!error) return NextResponse.json({ ok: true })

  if (!MISSING_COLUMN.has(error.code ?? '')) {
    console.error('report insert failed', error.message)
    return NextResponse.json({ error: 'Could not submit report.' }, { status: 500 })
  }

  // 0056 not applied to this DB yet: fold the legally-meaningful fields into the
  // free-text reason so a copyright notice still carries its signature/identification/
  // sworn statement even without the dedicated columns. These go at the FRONT of the
  // string, not the end — the 1000-char slice below would otherwise cut them off.
  const header =
    kind === 'copyright'
      ? `[copyright] signed: ${claimant} / work: ${workIdentified} / sworn: ${sworn ? 'yes' : 'NO'}\n`
      : `[${kind}]\n`
  const retry = await db.from('reports').insert({ about, contact, reason: `${header}${reason}`.slice(0, 1000) })
  if (retry.error) {
    console.error('report fallback insert failed', retry.error.message)
    return NextResponse.json({ error: 'Could not submit report.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
