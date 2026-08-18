// POST /api/storage/delete — remove one work's, or one room's, files from R2.
//
// R2 has no per-user write policy, so deletion is authorized here: we resolve the
// caller's uid from their token and only ever build keys under `{uid}/`. Passing
// someone else's id therefore deletes nothing of theirs.
//
// The two shapes differ in WHEN the caller runs them, and that is load-bearing:
//
//   { artworkId } — sent AFTER the row is gone (lib/cloud.ts deleteArtwork).
//     Nothing is left to check ownership against, and nothing needs to be: the
//     key is built from the caller's own uid, so a wrong id deletes nothing.
//     Failing here only orphans files — a cost concern, never data loss — so the
//     client treats a failure as non-fatal.
//
//   { galleryId } — sent BEFORE the row is gone (lib/galleries.ts deleteGallery),
//     precisely so `galleries.owner_id` can still be read. Uid-derived keys are
//     not enough here, because a room and a work are told apart by the SHAPE of
//     the key rather than by a separate namespace: sending one of your own
//     ARTWORK ids as `galleryId` would sweep `{uid}/{artworkId}/` while the
//     artworks row lived on, i.e. blank out a work hanging in a published room.
//     Requiring a galleries row you own is what keeps the two apart.
//
//     Until 2026-08-18 deleteGallery removed only the row and a room's files were
//     never cleaned up at all — they kept eating the artist's plan quota, which is
//     measured from the bucket rather than declared (docs/DECISIONS.md 2026-07-27),
//     while being invisible to them because the room itself was gone.
//
// Removing the objects is not enough on its own: Cloudflare keeps serving them
// from the edge for up to four hours, so the same folder is purged from the CDN
// straight afterwards (lib/cachePurge.ts).
import { NextRequest, NextResponse } from 'next/server'
import { deletePrefix, r2Configured } from '@/lib/r2'
import { purgeCachePrefix } from '@/lib/cachePurge'
import { authenticate } from '@/lib/apiAuth'

export const runtime = 'nodejs'

// Lowercase only — R2 keys are case-sensitive (see /api/upload-url).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(req: NextRequest) {
  if (!r2Configured) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  let body: { artworkId?: unknown; galleryId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const artworkId = typeof body.artworkId === 'string' ? body.artworkId : ''
  const galleryId = typeof body.galleryId === 'string' ? body.galleryId : ''
  // Exactly one. A body carrying both would leave it ambiguous which id the
  // ownership check below applies to — and the shape that skips the check must
  // never be the one that decides.
  if (Boolean(artworkId) === Boolean(galleryId)) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const id = artworkId || galleryId
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })

  try {
    if (galleryId) {
      // `owner_id` is matched explicitly — RLS visibility is NOT ownership. Both
      // `galleries_select_public` (migration 0001) and `galleries_select_expo_owner`
      // (0062) let the caller READ rooms that are not theirs, so a visibility-only
      // check would accept any published room id lifted from /explore. Same shape
      // as `ownsRow` in /api/upload-url.
      const { data, error } = await auth.db
        .from('galleries')
        .select('id')
        .eq('id', galleryId)
        .eq('owner_id', auth.uid)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    }

    // A work keeps everything in one folder. A room keeps its BGM in
    // `{uid}/{roomId}/`, but its logo is a SIBLING of that folder —
    // `{uid}/{roomId}-logo.jpg` — so the trailing slash that protects the artwork
    // case has to be dropped for a second pass.
    //
    // The baked lighting atlases (DECISIONS 2026-08-18) ARE covered by the first
    // prefix: they land at `{uid}/{roomId}/bake-<hash>.png` (app/api/bake). That was
    // still open when this comment was first written — the earlier intent was to keep
    // them out of `{uid}/` so they would not count against the artist's quota — but the
    // user decided the opposite (count them), which put them in this room's own folder.
    //
    // `{uid}/{roomId}-` rather than the one literal key: it sweeps up whatever
    // else is ever hung off this id, which is exactly the kind of file that went
    // unnoticed here in the first place. It cannot reach another room's objects,
    // because a uuid is fixed-length — no second uuid can start with a whole one
    // followed by a hyphen — and an artwork folder is separated by `/`, not `-`.
    const prefixes = artworkId
      ? [`${auth.uid}/${artworkId}/`]
      : [`${auth.uid}/${galleryId}/`, `${auth.uid}/${galleryId}-`]

    let removed = 0
    for (const prefix of prefixes) removed += await deletePrefix(prefix)

    // Purge only when something was actually deleted. An id that matched nothing
    // has nothing cached under it either, and skipping keeps a caller replaying
    // made-up ids from burning the account-wide purge rate limit (5/min on the
    // free plan) that a real deletion needs.
    //
    // One request covers both prefixes: cache purge is a plain string prefix over
    // `host/path`, so `{uid}/{id}` reaches the folder AND the `-logo.jpg` sibling
    // (including its `?v=…` cache-buster variants) in a single call. The artwork
    // case is unchanged — purgeCachePrefix strips the trailing slash anyway.
    const purged = removed > 0 ? await purgeCachePrefix(`${auth.uid}/${id}`) : false
    return NextResponse.json({ removed, purged })
  } catch (e) {
    console.error('storage delete failed', e)
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 })
  }
}
