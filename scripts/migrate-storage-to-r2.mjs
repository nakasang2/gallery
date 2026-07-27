#!/usr/bin/env node
// One-off: copy every file from Supabase Storage ("artworks" bucket) into
// Cloudflare R2, preserving keys exactly. See docs/DECISIONS.md 2026-07-27.
//
// Keys are preserved, so nothing in the DB needs to change except the columns
// that stored ABSOLUTE Supabase URLs — those are rewritten by migration
// 0029_r2_urls.sql, which you run AFTER this script reports success.
//
// Safe to re-run: an object already present in R2 with the same size is skipped,
// so an interrupted run resumes where it left off. Nothing is deleted from
// Supabase — verify the site first, then empty that bucket by hand.
//
// 使い方:
//   node --env-file=.env.local scripts/migrate-storage-to-r2.mjs --dry-run
//   node --env-file=.env.local scripts/migrate-storage-to-r2.mjs
//
// 必要な環境変数:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (読み出し元)
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  (書き込み先)
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const BUCKET = 'artworks'
const dryRun = process.argv.includes('--dry-run')

const need = (name) => {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing env var: ${name}`)
    process.exit(1)
  }
  return v
}

const supabase = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

const r2Bucket = need('R2_BUCKET')
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
  },
})

/** Walk the bucket depth-first. Supabase's list() is per-folder and paginated;
 *  a folder entry comes back with id === null. */
async function* walk(prefix = '') {
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${prefix || '/'} failed: ${error.message}`)
    if (!data?.length) return

    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) yield* walk(key)
      // Supabase creates this 0-byte marker to keep an "empty" folder listable.
      // It is not a real file and has no business in R2.
      else if (entry.name === '.emptyFolderPlaceholder') continue
      else yield { key, size: entry.metadata?.size ?? null, contentType: entry.metadata?.mimetype }
    }
    // Only an empty page proves the end of the listing — a short page does not,
    // in case the API ever clamps `limit` below what we asked for.
  }
}

/** True when R2 already holds this key at the same byte size. A file whose size
 *  Supabase did not report is always re-copied: an interrupted transfer can leave
 *  a short object behind, and "HEAD succeeded" alone would wave it through. */
async function alreadyCopied(key, size) {
  if (size === null) return false
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }))
    return head.ContentLength === size
  } catch {
    return false
  }
}

let copied = 0
let skipped = 0
let bytes = 0
const failures = []

console.log(dryRun ? '— DRY RUN (nothing will be written) —' : `Copying ${BUCKET} → R2 bucket "${r2Bucket}"`)

for await (const file of walk()) {
  if (await alreadyCopied(file.key, file.size)) {
    skipped++
    continue
  }
  if (dryRun) {
    console.log(`would copy  ${file.key}  (${file.size ?? '?'} bytes)`)
    copied++
    bytes += file.size ?? 0
    continue
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(file.key)
    if (error) throw new Error(error.message)
    const body = Buffer.from(await data.arrayBuffer())

    await r2.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: file.key,
        Body: body,
        ContentType: file.contentType || data.type || 'application/octet-stream',
        // Deliberately no CacheControl: new uploads (signed by /api/upload-url)
        // don't set one either, and edge caching is configured once as a
        // Cloudflare Cache Rule on the custom domain (docs/R2_SETUP.md §5) so
        // migrated and future files behave identically.
      })
    )
    copied++
    bytes += body.length
    if (copied % 25 === 0) console.log(`… ${copied} copied`)
  } catch (e) {
    failures.push({ key: file.key, message: e instanceof Error ? e.message : String(e) })
    console.error(`FAILED ${file.key}: ${e instanceof Error ? e.message : e}`)
  }
}

console.log(
  `\nDone. copied=${copied} skipped(already present)=${skipped} bytes=${(bytes / 1024 / 1024).toFixed(1)}MB failed=${failures.length}`
)
if (failures.length) {
  console.error('\nRe-run to retry the failures above (copied files are skipped).')
  process.exit(1)
}
if (!dryRun) {
  console.log('\nNext: apply supabase/migrations/0029_r2_urls.sql, then verify the site before emptying the Supabase bucket.')
}
