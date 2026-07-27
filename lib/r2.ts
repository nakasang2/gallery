// Cloudflare R2 (S3-compatible) — SERVER-ONLY client. Files (artwork images and
// video, avatars, logos, audio, TTS cache) live in R2; only metadata stays in
// Postgres. See docs/DECISIONS.md 2026-07-27 for why we moved off Supabase
// Storage: R2 egress is free, which is the cost that scales with popularity.
//
// Never import this from a component — it reads secret credentials. The browser
// side only ever needs `publicUrl()` from lib/publicUrl.ts.
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { publicUrlConfigured } from './publicUrl'

export const R2_BUCKET = process.env.R2_BUCKET ?? ''

const accountId = process.env.R2_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

/** False until all five storage env vars are set — routes answer 501 so the app
 *  still boots (mirrors how /api/tts degrades when unconfigured).
 *
 *  NEXT_PUBLIC_R2_PUBLIC_BASE is deliberately part of this: without it
 *  `publicUrl()` returns a ROOT-RELATIVE path, and the upload helpers would
 *  happily persist that broken value into profiles.avatar_url, galleries.bgm_url
 *  and friends. Fixing the env var later would not repair those rows, so refuse
 *  to write at all until the read side is configured too. */
export const r2Configured = Boolean(
  accountId && accessKeyId && secretAccessKey && R2_BUCKET && publicUrlConfigured
)

export const r2 = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      // The SDK otherwise adds a CRC32 checksum of the (empty) body to every
      // presigned PUT as a signed query param — `x-amz-checksum-crc32=AAAAAA==`,
      // the checksum of zero bytes. The client cannot strip it (it is signed), so
      // the real upload would not match it. Checksums are only computed when a
      // command asks for one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  : null

/** Pages of 1000, so this bounds `prefixBytes` at 20k objects. A user held to the
 *  300MB plan quota cannot get near it (they would need 20k files averaging 15KB),
 *  so hitting the cap means something is wrong — the caller fails closed. */
const MAX_USAGE_PAGES = 20

/**
 * Total bytes stored under a key prefix — the authoritative answer to "how much
 * is this user storing", because it measures what is actually in the bucket
 * rather than what a client told us it uploaded.
 *
 * Callers MUST pass a prefix tied to the authenticated uid (`{uid}/`); this does
 * no authorization of its own.
 *
 * Throws if the listing is longer than MAX_USAGE_PAGES rather than returning a
 * number that is too small — an undercount here would hand out an upload URL
 * that should have been refused.
 */
export async function prefixBytes(prefix: string): Promise<number> {
  if (!r2 || !prefix) return 0
  let total = 0
  let token: string | undefined
  let pages = 0

  do {
    const listed = await r2.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token })
    )
    for (const o of listed.Contents ?? []) total += o.Size ?? 0
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
    if (token && ++pages >= MAX_USAGE_PAGES) {
      throw new Error(`Refusing to measure ${prefix}: more than ${MAX_USAGE_PAGES * 1000} objects.`)
    }
  } while (token)

  return total
}

/**
 * Delete every object under a key prefix, in pages of 1000.
 *
 * Callers MUST pass a prefix they have already tied to the authenticated uid
 * (`{uid}/…`) — this helper does no authorization of its own. A trailing slash
 * matters: `{uid}/{id}/` deletes one work's files, while `{uid}/{id}` would also
 * match a sibling like `{uid}/{id}-logo.jpg`.
 *
 * Returns the number of objects removed.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  if (!r2 || !prefix) return 0
  let removed = 0
  let token: string | undefined

  do {
    const listed = await r2.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token })
    )
    const keys = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []))
    if (keys.length) {
      await r2.send(
        new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: keys, Quiet: true } })
      )
      removed += keys.length
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token)

  return removed
}
