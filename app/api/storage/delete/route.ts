// POST /api/storage/delete — remove one work's files from R2.
//
// R2 has no per-user write policy, so deletion is authorized here: we resolve the
// caller's uid from their token and only ever delete under `{uid}/{artworkId}/`.
// Passing someone else's artwork id therefore deletes nothing.
//
// The caller has already deleted the DB row (lib/cloud.ts deleteArtwork). Failing
// here only orphans files — a cost concern, never data loss — so the client
// treats a failure as non-fatal.
import { NextRequest, NextResponse } from 'next/server'
import { deletePrefix, r2Configured } from '@/lib/r2'
import { authenticate } from '@/lib/apiAuth'

export const runtime = 'nodejs'

// Lowercase only — R2 keys are case-sensitive (see /api/upload-url).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(req: NextRequest) {
  if (!r2Configured) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  let body: { artworkId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const artworkId = typeof body.artworkId === 'string' ? body.artworkId : ''
  if (!UUID.test(artworkId)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })

  try {
    // Trailing slash: this work's folder only (display.jpg / thumb.jpg / video /
    // guide), never the sibling `{uid}/{galleryId}-logo.jpg`.
    const removed = await deletePrefix(`${auth.uid}/${artworkId}/`)
    return NextResponse.json({ removed })
  } catch (e) {
    console.error('storage delete failed', e)
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 })
  }
}
