// GET /api/storage/usage — how much the signed-in user is actually storing.
//
// The /me meter used to sum `artworks.bytes` in the browser. That column is a
// client-supplied number that only exists for works whose row got written, so the
// meter could disagree with the gate that refuses uploads — and after migration
// 0030 the gate measures R2 instead (see app/api/upload-url/route.ts). Reading the
// same source here keeps "247MB of 300MB used" and "storage limit reached" telling
// the same story.
//
// Reports LANDED bytes only. In-flight reservations are deliberately left out:
// they are not storage, they are a hold that expires on its own, and showing them
// would make the meter jump around during an upload.
import { NextRequest, NextResponse } from 'next/server'
import { prefixBytes, r2Configured } from '@/lib/r2'
import { authenticate } from '@/lib/apiAuth'
import { PLAN } from '@/lib/limits'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!r2Configured) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  try {
    const used = await prefixBytes(`${auth.uid}/`)
    return NextResponse.json({ used, limit: PLAN.storageBytes })
  } catch (e) {
    console.error('storage usage failed', e)
    return NextResponse.json({ error: 'Could not read storage usage.' }, { status: 503 })
  }
}
