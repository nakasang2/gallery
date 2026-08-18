// POST /api/bake — store one room's baked wall-shadow atlas, and point the room at it.
//
// The artist's browser draws the shadows once (at publish time) and posts the PNG here.
// From then on every visitor downloads that one image instead of re-baking on entry —
// including phones, which cannot bake at all today and therefore show no shadows
// (DECISIONS 2026-08-18 ①).
//
// The bytes DO come through this function, unlike /api/upload-url. That route exists
// because an artwork video can be 40MB and a Vercel route body is capped at 4.5MB; an
// atlas is under 100KB, and relaying buys three things a presigned PUT cannot:
//   - the object key is chosen here from the CONTENT, so the client never names a path;
//   - the upload and the row update happen in one request, so the image and the
//     manifest pointing at it cannot drift apart;
//   - the PREVIOUS atlas is deleted in the same breath (ユーザー決定 2026-08-18:
//     「焼き直すたびに古いアトラスは削除して構いません」).
//
// Quota: the object lives under `{uid}/{galleryId}/`, so it counts against the artist's
// plan exactly like their own uploads (ユーザー決定 2026-08-18). That is not a special
// case bolted on here — the quota is measured by listing `{uid}/`, so anything stored
// there is counted by construction, and /api/upload-url deliberately has no exclusion
// list to keep it that way.
//
// **Running out of room does not fail the publish.** We refuse to store the atlas and
// say so; the room stays published and visitors fall back to baking in their own
// browser, which is exactly today's behaviour. Refusing to publish over a 60KB cache
// would be a far worse trade.
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, r2Configured, R2_BUCKET, prefixBytes } from '@/lib/r2'
import { publicUrl } from '@/lib/publicUrl'
import { authenticate } from '@/lib/apiAuth'
import { PLAN } from '@/lib/limits'
import {
  BAKE_MAX_BYTES,
  BAKE_MAX_KEY_CHARS,
  BAKE_MAX_TILES,
  SHADOW_BAKE_VERSION,
  parseShadowBake,
  type ShadowBake,
} from '@/lib/shadowBake'

export const runtime = 'nodejs'

// Lowercase only — R2 keys are case-sensitive (same reasoning as /api/upload-url).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Content-addressed filename: a different composition is a different URL, so the CDN
 *  can cache this forever and a re-bake never has to be purged. 16 hex chars of SHA-256
 *  is 64 bits — at one bake per room per edit, a collision is not a thing that happens,
 *  and a collision would only serve the wrong shadows (never someone else's file, since
 *  the uid and gallery id are in the path). */
function objectKey(uid: string, galleryId: string, bakeKey: string): string {
  const digest = createHash('sha256').update(bakeKey).digest('hex').slice(0, 16)
  return `${uid}/${galleryId}/bake-${digest}.png`
}

/** Pull the key back out of a stored manifest's URL so the old object can be deleted.
 *  Returns '' unless the URL really is this room's own bake — never delete on the
 *  strength of a URL we cannot fully account for. */
function keyFromStoredUrl(url: string, uid: string, galleryId: string): string {
  const marker = `${uid}/${galleryId}/`
  const at = url.indexOf(marker)
  if (at < 0) return ''
  const key = url.slice(at).split('?')[0]
  return /^[0-9a-f-]+\/[0-9a-f-]+\/bake-[0-9a-f]{16}\.png$/.test(key) ? key : ''
}

interface Body {
  galleryId?: unknown
  bakeKey?: unknown
  cols?: unknown
  rows?: unknown
  tile?: unknown
  ids?: unknown
  /** base64 PNG, no `data:` prefix */
  png?: unknown
}

const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

export async function POST(req: NextRequest) {
  const client = r2
  if (!r2Configured || !client) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })
  }

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const galleryId = typeof body.galleryId === 'string' ? body.galleryId : ''
  const bakeKey = typeof body.bakeKey === 'string' ? body.bakeKey : ''
  const { cols, rows, tile } = body
  const ids = Array.isArray(body.ids) && body.ids.every((v) => typeof v === 'string') ? (body.ids as string[]) : null
  const b64 = typeof body.png === 'string' ? body.png : ''

  if (!UUID.test(galleryId)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  if (!bakeKey || bakeKey.length > BAKE_MAX_KEY_CHARS) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  if (!isPosInt(cols) || !isPosInt(rows) || !isPosInt(tile) || !ids || ids.length === 0) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  // The grid has to be able to hold the works it claims, and stay within the bounds the
  // reader will accept — otherwise we would store a manifest that is refused on read.
  if (cols * rows > BAKE_MAX_TILES || ids.length > cols * rows) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  if (!b64) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })

  let png: Buffer
  try {
    png = Buffer.from(b64, 'base64')
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  // `Buffer.from(…, 'base64')` never throws — it stops at the first invalid character —
  // so the real check is on the RESULT. An 8-byte PNG signature is the cheapest way to
  // be sure we are about to serve an image and not whatever was posted.
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return NextResponse.json({ error: 'Not a PNG.' }, { status: 415 })
  }
  if (png.length > BAKE_MAX_BYTES) {
    return NextResponse.json({ error: 'Bake image too large.' }, { status: 413 })
  }

  try {
    // Ownership, and the previous manifest, in one read. `owner_id` is matched
    // explicitly: `galleries` also grants public reads (RLS visibility is not
    // ownership), so a published id lifted from /explore must not pass.
    const { data: row, error: rowErr } = await auth.db
      .from('galleries')
      .select('id, shadow_bake')
      .eq('id', galleryId)
      .eq('owner_id', auth.uid)
      .maybeSingle()
    if (rowErr) {
      // 0067 not applied yet: there is nowhere to record the manifest, so storing the
      // image would only consume the artist's quota for nothing. Say so plainly rather
      // than half-succeeding.
      if (rowErr.code === 'PGRST204' || rowErr.code === '42703') {
        return NextResponse.json({ error: 'Bake storage is not migrated yet.', skipped: true }, { status: 503 })
      }
      throw new Error(rowErr.message)
    }
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const key = objectKey(auth.uid, galleryId, bakeKey)
    const previous = parseShadowBake((row as { shadow_bake?: unknown }).shadow_bake)
    const previousKey = previous ? keyFromStoredUrl(previous.url, auth.uid, galleryId) : ''

    // Quota. Measured from R2 (never from anything the client says), and the previous
    // atlas is subtracted because we are about to delete it — otherwise re-baking a
    // room at the edge of the plan would be refused for space it is already using.
    const used = await prefixBytes(`${auth.uid}/`)
    const replacing = previousKey && previousKey !== key ? await prefixBytes(previousKey) : 0
    if (used - replacing + png.length > PLAN.storageBytes) {
      // Not an error the artist has to act on right now: the room is published and
      // visitors still get shadows, just baked in their own browser.
      return NextResponse.json(
        { error: 'Storage limit reached.', skipped: true, used, limit: PLAN.storageBytes },
        { status: 413 }
      )
    }

    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        // Content-addressed key ⇒ the bytes behind this URL never change, so the edge
        // may keep it as long as it likes. A re-bake writes a NEW url; nothing to purge.
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )

    const bake: ShadowBake = {
      v: SHADOW_BAKE_VERSION,
      key: bakeKey,
      url: publicUrl(key),
      cols,
      rows,
      tile,
      ids,
    }
    const { error: upErr } = await auth.db
      .from('galleries')
      .update({ shadow_bake: bake })
      .eq('id', galleryId)
      .eq('owner_id', auth.uid)
    if (upErr) throw new Error(upErr.message)

    // Only now, with the row pointing at the new image, drop the old one. The other
    // order would leave a window where the manifest names a deleted object and every
    // visitor in it gets a 404 (they would fall back to baking, but for no reason).
    let removed = false
    if (previousKey && previousKey !== key) {
      try {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: R2_BUCKET,
            Delete: { Objects: [{ Key: previousKey }], Quiet: true },
          })
        )
        removed = true
      } catch (e) {
        // An orphaned 60KB object costs the artist quota but breaks nothing, and the
        // next re-bake will try again. Never turn this into a failed save.
        console.error('bake: could not delete the previous atlas', e)
      }
    }

    return NextResponse.json({ url: bake.url, bytes: png.length, removedPrevious: removed })
  } catch (e) {
    console.error('bake save failed', e)
    return NextResponse.json({ error: 'Could not save the bake.' }, { status: 500 })
  }
}
