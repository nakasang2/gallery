// POST /api/admin/artwork-takedown — an admin permanently removes one artwork's
// row AND its files in R2 (リリース前監査 #10・2026-08-21).
//
// The only moderation lever before this was admin_set_gallery_public (0033),
// which flips a whole ROOM to non-public. That leaves the actual image/video file
// sitting on the public R2 bucket (anyone with the URL keeps seeing it — DMCA's
// "expeditiously disable access" is not met by a 404 on the gallery page around
// it) and, in a joint exhibition, takes down every co-exhibitor's room along with
// the one work that was reported.
//
// The DB side (deleting the row, which cascades placements) is gated by
// `is_admin()` inside the RPC itself (migration 0073) — this route does not
// separately authorize that part. What this route adds is the R2 deletion + CDN
// purge, which needs service-role-equivalent credentials that a client-side RPC
// call can never carry (same reason /api/storage/delete exists for an owner's own
// deletes instead of a client-side R2 call).
import { NextRequest, NextResponse } from 'next/server'
import { deletePrefix, r2Configured } from '@/lib/r2'
import { purgeCachePrefix } from '@/lib/cachePurge'
import { authenticate } from '@/lib/apiAuth'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(req: NextRequest) {
  if (!r2Configured) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  let body: { artworkId?: unknown; copyright?: unknown; title?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const artworkId = typeof body.artworkId === 'string' ? body.artworkId : ''
  if (!UUID.test(artworkId)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  const isCopyright = body.copyright === true
  const title = typeof body.title === 'string' ? body.title : ''

  // `auth.db` carries the caller's own session, so `is_admin()` inside the RPCs
  // sees the real caller — a non-admin gets the RPC's exception, not a silent no-op.
  //
  // Order matters here: look up owner_id/storage_path WITHOUT deleting the row
  // first, delete the R2 files, and only THEN delete the DB row. Deleting the row
  // first (an earlier version of this route did) meant a transient R2 failure left
  // the DB record gone but the file still live on the public CDN with no artworkId
  // left to retry from — exactly the DMCA non-compliance this route exists to fix
  // (別視点レビューで発見・2026-08-21).
  const { data, error } = await auth.db.rpc('admin_get_artwork_location', { p_artwork: artworkId })
  if (error) {
    const forbidden = error.message.includes('not authorised')
    return NextResponse.json({ error: forbidden ? 'Forbidden.' : 'Takedown failed.' }, { status: forbidden ? 403 : 500 })
  }
  const row = (Array.isArray(data) ? data[0] : data) as { owner_id?: string; storage_path?: string } | null
  if (!row?.owner_id) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const prefix = `${row.owner_id}/${artworkId}/`
  const removed = await deletePrefix(prefix)
  const purged = removed > 0 ? await purgeCachePrefix(`${row.owner_id}/${artworkId}`) : false

  const takedown = await auth.db.rpc('admin_takedown_artwork', { p_artwork: artworkId })
  if (takedown.error) {
    // The files are already gone/purged at this point; only the DB row remains.
    // Not a DMCA problem any more (the file is unreachable), but the admin needs
    // to know the row needs a retry.
    return NextResponse.json(
      { error: 'Files were removed, but the database row could not be deleted. Please retry.' },
      { status: 500 }
    )
  }
  // 常習侵害者の記録（migration 0075・リリース前監査 #47）。takedown 自体は理由を
  // 問わない汎用の削除経路なので、著作権の通報が理由のときだけここで記録する。
  // 記録に失敗しても takedown 自体はもう完了しているので、ロールバックはしない
  // （ログだけ残し、必要ならSQL Editorから手で入れ直せる）。
  if (isCopyright) {
    const strike = await auth.db.rpc('admin_record_copyright_strike', {
      p_user: row.owner_id,
      p_artwork: artworkId,
      p_title: title,
    })
    if (strike.error) {
      console.error('artwork-takedown: copyright strike not recorded', artworkId, row.owner_id, strike.error.message)
    }
  }
  return NextResponse.json({ removed, purged })
}
