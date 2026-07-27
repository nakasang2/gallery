// POST /api/upload-url — hand the browser short-lived presigned PUT URLs for R2.
//
// The file bytes never pass through this function: a Vercel route body is capped
// at 4.5MB and a video work can be 40MB, so relaying was not an option (see
// docs/DECISIONS.md 2026-07-27). Instead the browser PUTs straight to R2 with a
// URL we signed, which also keeps upload bandwidth off our own bill.
//
// Everything a client could lie about is decided here instead:
//   - the object KEY is built from the uid in the caller's token, so nobody can
//     write into someone else's folder (this replaces the old Supabase RLS
//     storage policy);
//   - `purpose` selects from a fixed set of paths — no client-supplied paths;
//   - the declared byte size is checked against the per-purpose cap AND the
//     plan's storage quota, then signed into the URL as Content-Length so the
//     actual upload cannot exceed what we approved. The old quota check ran in
//     the browser (lib/cloud.ts assertQuota), where it was advisory at best.
import { NextRequest, NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, r2Configured, R2_BUCKET } from '@/lib/r2'
import { authenticate } from '@/lib/apiAuth'
import { PLAN, GALLERY_BGM_MAX_BYTES, IMAGE_MAX_BYTES } from '@/lib/limits'

export const runtime = 'nodejs'

/** Presigned URLs are used immediately by the very next fetch; 10 min is plenty
 *  and keeps a leaked URL near-useless. */
const EXPIRES_SECONDS = 600

// Lowercase only: crypto.randomUUID() and Postgres both render uuids in lower
// case, and R2 keys are case-sensitive — accepting `A1B2…` as well would let the
// same logical id map to two different objects (and leave one behind on delete).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Purpose =
  | 'artwork-display'
  | 'artwork-thumb'
  | 'artwork-video'
  | 'avatar'
  | 'gallery-bgm'
  | 'gallery-logo'
  | 'lp-image'

const jpeg = (ct: string) => ct === 'image/jpeg'
const video = (ct: string) => ct.startsWith('video/')
// Browsers disagree about .m4a and .mp3 — depending on the OS a file arrives as
// audio/mp4, audio/x-m4a, video/mp4, or application/octet-stream when the OS has
// no mapping for the extension. The UI advertises "MP3 or M4A" (app/me/page.tsx)
// behind an accept="audio/*" picker, and Supabase Storage accepted whatever was
// sent, so keep that door open rather than turning a working upload into a 415.
const audio = (ct: string) =>
  ct === '' || ct.startsWith('audio/') || ct === 'video/mp4' || ct === 'application/octet-stream'

interface Rule {
  /** Build the object key from the authenticated uid. Throws for a bad id/slot. */
  key: (uid: string, id: string, slot: number) => string
  maxBytes: number
  accepts: (contentType: string) => boolean
  /** Whether these bytes count against the plan's storage quota. Avatars, logos
   *  and LP images don't — matching the pre-migration behaviour. */
  quota: boolean
  /** Table the `id` must already exist in, owned by the caller. Only set where
   *  the row predates the upload: an artwork's own images are uploaded BEFORE its
   *  row is inserted, so those cannot be checked this way. */
  owns?: 'galleries' | 'artworks'
}

function uuid(id: string): string {
  if (!UUID.test(id)) throw new Error('Invalid id.')
  return id
}

const RULES: Record<Purpose, Rule> = {
  'artwork-display': { key: (u, id) => `${u}/${uuid(id)}/display.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg, quota: true },
  'artwork-thumb': { key: (u, id) => `${u}/${uuid(id)}/thumb.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg, quota: true },
  'artwork-video': { key: (u, id) => `${u}/${uuid(id)}/video`, maxBytes: PLAN.videoBytes, accepts: video, quota: true },
  avatar: { key: (u) => `${u}/avatar.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg, quota: false },
  'gallery-bgm': { key: (u, id) => `${u}/${uuid(id)}/bgm`, maxBytes: GALLERY_BGM_MAX_BYTES, accepts: audio, quota: true, owns: 'galleries' },
  'gallery-logo': { key: (u, id) => `${u}/${uuid(id)}-logo.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg, quota: false, owns: 'galleries' },
  // The LP hero is admin-only UI, but a presigned URL into the caller's own
  // folder is harmless on its own — writing the resulting URL into site_config
  // is what needs admin rights, and RLS still guards that. The slot is bounded,
  // so this cannot be used to create unbounded objects.
  'lp-image': {
    key: (u, _id, slot) => {
      if (!Number.isInteger(slot) || slot < 0 || slot > 20) throw new Error('Invalid slot.')
      return `${u}/lp/${slot}.jpg`
    },
    maxBytes: IMAGE_MAX_BYTES,
    accepts: jpeg,
    quota: false,
  },
}

interface FileRequest {
  purpose: Purpose
  id?: string
  slot?: number
  contentType?: string
  size?: number
}

type Db = NonNullable<Awaited<ReturnType<typeof authenticate>>>['db']

/** Bytes this user already stores (sum of artworks.bytes). Rows predating
 *  migration 0006 have no bytes and count as 0.
 *
 *  Returns null ONLY when the `bytes` column itself is absent (0006 unapplied) —
 *  in that one case the caller skips the gate rather than blocking every upload.
 *  Any other DB error throws, so a transient failure cannot silently disable the
 *  quota. */
async function storageUsed(db: Db, uid: string): Promise<number | null> {
  const { data, error } = await db.from('artworks').select('bytes').eq('owner_id', uid)
  if (error) {
    if (/bytes/i.test(error.message) || error.code === '42703') return null
    throw new Error(error.message)
  }
  return (data ?? []).reduce((sum, r) => sum + ((r as { bytes?: number }).bytes ?? 0), 0)
}

/** True when the caller owns a row with this id.
 *
 *  `owner_id` is matched explicitly — RLS visibility is NOT ownership here. Both
 *  tables also grant public reads (`galleries_select_public` uses `is_public`,
 *  and `artworks_select_in_public_gallery`, both in migration 0001), so a
 *  visibility-only check would accept any published gallery or work id lifted
 *  from /explore. */
async function ownsRow(db: Db, table: 'galleries' | 'artworks', id: string, uid: string): Promise<boolean> {
  const { data, error } = await db.from(table).select('id').eq('id', id).eq('owner_id', uid).maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function POST(req: NextRequest) {
  // Bound to a local so the narrowing survives into the signing callbacks below.
  const client = r2
  if (!r2Configured || !client) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })
  }

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  let body: { files?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const files = Array.isArray(body.files) ? (body.files as FileRequest[]) : []
  if (!files.length || files.length > 4) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  // Validate every entry before signing anything, so a partly-bad batch signs nothing.
  const planned: { key: string; contentType: string; size: number }[] = []
  let quotaBytes = 0
  try {
    for (const f of files) {
      // `files` is only cast, never parsed, so guard the shape here — a null entry
      // or an inherited key like "constructor" would otherwise throw and surface as
      // a 503 "server trouble" instead of the 400 it is.
      if (!f || typeof f !== 'object') {
        return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
      }
      const rule = Object.prototype.hasOwnProperty.call(RULES, f.purpose) ? RULES[f.purpose] : undefined
      if (!rule) return NextResponse.json({ error: 'Unknown upload purpose.' }, { status: 400 })

      const size = typeof f.size === 'number' && Number.isFinite(f.size) ? Math.floor(f.size) : -1
      if (size <= 0 || size > rule.maxBytes) {
        const mb = Math.floor(rule.maxBytes / 1024 / 1024)
        return NextResponse.json({ error: `File too large (limit ${mb}MB).` }, { status: 413 })
      }

      const contentType = typeof f.contentType === 'string' ? f.contentType : ''
      if (!rule.accepts(contentType)) {
        return NextResponse.json({ error: 'Unsupported file type.' }, { status: 415 })
      }

      let key: string
      try {
        key = rule.key(auth.uid, f.id ?? '', f.slot ?? -1)
      } catch {
        return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
      }

      // Where the target row already exists, require it — otherwise a caller could
      // mint an endless series of made-up ids and write an object per id.
      if (rule.owns && !(await ownsRow(auth.db, rule.owns, f.id ?? '', auth.uid))) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 })
      }

      planned.push({ key, contentType, size })
      if (rule.quota) quotaBytes += size
    }

    if (quotaBytes > 0) {
      const used = await storageUsed(auth.db, auth.uid)
      if (used !== null && used + quotaBytes > PLAN.storageBytes) {
        const mb = (n: number) => Math.round(n / 1024 / 1024)
        return NextResponse.json(
          {
            error: `Storage limit reached: ${mb(used)}MB of ${mb(PLAN.storageBytes)}MB used, this upload needs ${Math.max(1, mb(quotaBytes))}MB. Remove some works first.`,
          },
          { status: 507 }
        )
      }
    }
  } catch (e) {
    // A DB failure while checking ownership or quota must not fall through to
    // signing — refuse instead of letting an unchecked upload proceed.
    console.error('upload-url: pre-flight check failed', e)
    return NextResponse.json({ error: 'Could not verify the upload. Try again.' }, { status: 503 })
  }

  const uploads = await Promise.all(
    planned.map(async ({ key, contentType, size }) => ({
      key,
      url: await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          ContentType: contentType,
          ContentLength: size,
        }),
        // Signing content-length pins the upload to the size we approved above;
        // the browser sets that header itself from the Blob, so it always matches.
        { expiresIn: EXPIRES_SECONDS, signableHeaders: new Set(['content-length', 'content-type']) }
      ),
    }))
  )

  return NextResponse.json({ uploads })
}
