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
//
// The quota's INPUT is measured, not declared (docs/DECISIONS.md 2026-07-27,
// "容量制限の実測化"). It used to be the sum of `artworks.bytes`, which a client
// both supplies and can skip writing entirely — an artwork's files are uploaded
// BEFORE its row exists, so never inserting the row left those bytes unrecorded,
// and gallery BGM was never recorded at all. Now we list the caller's own
// R2 prefix and add up what is really there, so nothing a client says can move the
// number. Uploads that are signed but not yet landed are held in
// storage_reservations until the URL covering them can no longer be used
// (migration 0030) — that hold is what stops a burst of concurrent requests from
// all being told there is room for the same last 40MB.
import { NextRequest, NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, r2Configured, R2_BUCKET, prefixBytes } from '@/lib/r2'
import { authenticate } from '@/lib/apiAuth'
import { checkRateLimit } from '@/lib/rateLimit'
import { PLAN, GALLERY_BGM_MAX_BYTES, IMAGE_MAX_BYTES } from '@/lib/limits'

export const runtime = 'nodejs'

/** Presigned URLs are used immediately by the very next fetch; 10 min is plenty
 *  and keeps a leaked URL near-useless. */
const EXPIRES_SECONDS = 600

/** How long a reservation holds quota. Deliberately LONGER than the URL it covers:
 *  R2 checks expiry when the PUT starts, so an upload begun at 09:59 can still be
 *  writing at 10:02. If the hold lapsed at exactly 10:00 those bytes would be
 *  covered by neither the reservation nor the R2 listing (which cannot see a PUT
 *  until it completes) — a small window, but the whole point here is that there
 *  isn't one. The cost of the margin is only that the quota reads high for two
 *  extra minutes after an upload finishes. */
const RESERVATION_TTL_SECONDS = EXPIRES_SECONDS + 120

/** Matches the `v_n > 4` guard inside reserve_storage (migration 0030). */
const MAX_FILES_PER_REQUEST = 4

// Lowercase only: crypto.randomUUID() and Postgres both render uuids in lower
// case, and R2 keys are case-sensitive — accepting `A1B2…` as well would let the
// same logical id map to two different objects (and leave one behind on delete).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Purpose =
  | 'artwork-display'
  | 'artwork-card'
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
  /** Table the `id` must already exist in, owned by the caller. Only set where
   *  the row predates the upload: an artwork's own images are uploaded BEFORE its
   *  row is inserted, so those cannot be checked this way. Signing for a row that
   *  never materialises is no longer a way to store bytes for free — the quota
   *  measures R2, not the table (see reserveQuota). */
  owns?: 'galleries' | 'artworks'
}

function uuid(id: string): string {
  if (!UUID.test(id)) throw new Error('Invalid id.')
  return id
}

// EVERY purpose counts against the quota now. There is no `quota: false` escape
// hatch any more, because the quota is measured by listing `{uid}/` — excluding a
// purpose would mean excluding its key from that listing, which is a pattern-match
// against key shapes that quietly breaks the day a key layout changes. One rule
// instead: nobody stores more than PLAN.storageBytes under their own prefix, full
// stop. Avatars (~50KB), logos (~30KB) and LP images (~150KB) are rounding errors
// against 300MB, so this costs a real user nothing.
const RULES: Record<Purpose, Rule> = {
  'artwork-display': { key: (u, id) => `${u}/${uuid(id)}/display.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg },
  'artwork-card': { key: (u, id) => `${u}/${uuid(id)}/card.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg },
  'artwork-thumb': { key: (u, id) => `${u}/${uuid(id)}/thumb.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg },
  'artwork-video': { key: (u, id) => `${u}/${uuid(id)}/video`, maxBytes: PLAN.videoBytes, accepts: video },
  avatar: { key: (u) => `${u}/avatar.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg },
  'gallery-bgm': { key: (u, id) => `${u}/${uuid(id)}/bgm`, maxBytes: GALLERY_BGM_MAX_BYTES, accepts: audio, owns: 'galleries' },
  'gallery-logo': { key: (u, id) => `${u}/${uuid(id)}-logo.jpg`, maxBytes: IMAGE_MAX_BYTES, accepts: jpeg, owns: 'galleries' },
  // The LP hero is admin-only UI, but a presigned URL into the caller's own
  // folder is harmless on its own — writing the resulting URL into site_config
  // is what needs admin rights, and RLS still guards that. The slot is bounded,
  // so this cannot be used to create unbounded objects.
  'lp-image': {
    key: (u, _id, slot) => {
      // The LP's 3D museum has 23 frames across five faces, and lib/siteConfig
      // gives each face its own band of ten slot numbers (hero 0-, panels 10-,
      // approach 20-, hall front 30-, hall sides 40-). 49 is that last band's end;
      // raise it here AND add the band in lib/siteConfig if a sixth face appears.
      if (!Number.isInteger(slot) || slot < 0 || slot > 49) throw new Error('Invalid slot.')
      return `${u}/lp/${slot}.jpg`
    },
    maxBytes: IMAGE_MAX_BYTES,
    accepts: jpeg,
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

/**
 * Hold quota for the files we are about to sign, and report whether they fit.
 *
 * `listedBytes` is what the caller ACTUALLY stores, measured straight from R2 —
 * the client has no say in it. The RPC (migration 0030) adds the caller's live
 * reservations, compares against the limit, and only writes new reservation rows
 * if the batch fits, all under a per-uid advisory lock so two concurrent requests
 * cannot both be told there is room for the last 40MB.
 *
 * Reservations simply expire; nothing has to confirm the upload afterwards. Once
 * the bytes land in R2 they are in `listedBytes` for good, so the window where a
 * finished upload is counted twice is at most RESERVATION_TTL_SECONDS — it errs
 * toward refusing, never toward letting someone over. That is the trade for not
 * having a commit callback (which a client could simply decline to make) or a
 * sweeper job (which would need a cron we do not have on this plan).
 */
async function reserveQuota(
  db: Db,
  files: { key: string; size: number }[],
  listedBytes: number
): Promise<{ ok: boolean; used: number }> {
  const { data, error } = await db.rpc('reserve_storage', {
    p_keys: files.map((f) => f.key),
    p_bytes: files.map((f) => f.size),
    p_listed_bytes: listedBytes,
    p_limit_bytes: PLAN.storageBytes,
    p_ttl_seconds: RESERVATION_TTL_SECONDS,
  })

  if (error) {
    // 0030 not applied yet. Refusing every upload would be a worse failure than
    // the one thing reservations add — protection against a burst of concurrent
    // requests each seeing the same "before" figure. The measured quota below
    // still holds, so the three ways a client could previously write unlimited
    // bytes stay closed. Both codes are unambiguous: PGRST202 is PostgREST's
    // "no such function", 42883 is Postgres's.
    if (error.code !== 'PGRST202' && error.code !== '42883') throw new Error(error.message)
    console.warn('upload-url: reserve_storage is missing — apply migration 0030. Quota enforced without reservations.')
    const wanted = files.reduce((sum, f) => sum + f.size, 0)
    return { ok: listedBytes + wanted <= PLAN.storageBytes, used: listedBytes }
  }

  const verdict = data as { ok?: boolean; used?: number } | null
  // A null/malformed payload means the function returned something unexpected;
  // treat that as "does not fit" rather than signing on the strength of a bad answer.
  return { ok: verdict?.ok === true, used: verdict?.used ?? listedBytes }
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

  // Bound how often one account can ask for upload URLs at all (リリース前監査
  // #31 — no storage route had any rate limit, so a signed-in account could hammer
  // R2 PUT/List with no cost beyond its own request budget). 60 requests / 10 min
  // is generous for a real upload session (each can batch up to
  // MAX_FILES_PER_REQUEST files) and only bites a script. checkRateLimit fails
  // OPEN on a missing migration — same precedent as reserveQuota below for a
  // missing reserve_storage.
  const withinLimit = await checkRateLimit(auth.db, { bucket: 'upload_url', key: auth.uid, max: 60, windowSeconds: 600 })
  if (!withinLimit) {
    return NextResponse.json({ error: 'Too many upload requests. Wait a few minutes and try again.' }, { status: 429 })
  }

  let body: { files?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const files = Array.isArray(body.files) ? (body.files as FileRequest[]) : []
  if (!files.length || files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  // Validate every entry before signing anything, so a partly-bad batch signs nothing.
  const planned: { key: string; contentType: string; size: number }[] = []
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

      // Two entries writing the same key would reserve it twice for one object.
      // The RPC de-duplicates defensively, but a batch like this is a client bug
      // (or a probe) either way, so say so.
      if (planned.some((p) => p.key === key)) {
        return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
      }

      planned.push({ key, contentType, size })
    }

    // Measure, then reserve. `prefixBytes` is the honest figure — it is whatever
    // is really sitting in the bucket, including files whose DB row was never
    // written, so the "upload and never insert the row" loop now costs the caller
    // quota on the very next request.
    const listedBytes = await prefixBytes(`${auth.uid}/`)
    const { ok, used } = await reserveQuota(auth.db, planned, listedBytes)
    if (!ok) {
      const wanted = planned.reduce((sum, p) => sum + p.size, 0)
      const mb = (n: number) => Math.round(n / 1024 / 1024)
      return NextResponse.json(
        {
          error: `Storage limit reached: ${mb(used)}MB of ${mb(PLAN.storageBytes)}MB used, this upload needs ${Math.max(1, mb(wanted))}MB. Remove some works first.`,
        },
        { status: 507 }
      )
    }
  } catch (e) {
    // A failure while checking ownership, measuring R2 or reserving must not fall
    // through to signing — refuse instead of letting an unchecked upload proceed.
    // (This is also where an over-long listing lands: prefixBytes throws rather
    // than returning a total it knows is short.)
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
