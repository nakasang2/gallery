#!/usr/bin/env node
// Upload the heavy bundled assets in `public/` to R2, so they are served from
// cdn.xibit360.art instead of Vercel. See docs/DECISIONS.md 2026-07-27.
//
// Why: GhostVisitors preloads BOTH visitor models (2.6MB) at module scope for every
// gallery view, and the floor textures plus the demo video add ~1.5MB more. Out of
// `public/` that all came off Vercel's bandwidth allowance; from R2 the egress is
// free, which is what keeps per-visitor cost flat as a gallery gets popular.
//
// The files STAY in `public/`: `assetUrl()` falls back to the local path when
// NEXT_PUBLIC_R2_PUBLIC_BASE is unset, so local dev and an unconfigured
// environment keep working. `public/draco/` is deliberately NOT uploaded — the
// glTF decoder is kept same-origin on purpose (docs/LESSONS.md 2026-07-16).
//
// 使い方（.env.local に R2 の4変数が必要）:
//   node --env-file=.env.local scripts/upload-static-assets.mjs --dry-run
//   node --env-file=.env.local scripts/upload-static-assets.mjs
//
// アセットを差し替えたときは lib/publicUrl.ts の STATIC_VERSION を上げてから再実行する
// （CDNが1ヶ月キャッシュするので、同じURLのままでは古いファイルが配られ続ける）。
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

// Directories under public/ that move to the CDN. Anything not listed here keeps
// being served by the app itself.
const DIRS = ['models', 'textures', 'demo-works']

const CONTENT_TYPES = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
}

const dryRun = process.argv.includes('--dry-run')

const need = (name) => {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing env var: ${name}`)
    process.exit(1)
  }
  return v
}

/** Read STATIC_VERSION straight out of the TS module, so code and uploads can't drift. */
async function staticVersion() {
  const src = await readFile('lib/publicUrl.ts', 'utf8')
  const m = src.match(/export const STATIC_VERSION\s*=\s*'([^']+)'/)
  if (!m) {
    console.error('Could not find STATIC_VERSION in lib/publicUrl.ts — run this from the repo root.')
    process.exit(1)
  }
  return m[1]
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else yield p
  }
}

const version = await staticVersion()
const bucket = need('R2_BUCKET')
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
  },
  // Presigning aside, the SDK otherwise attaches a checksum the same way it does
  // for /api/upload-url; keep the two consistent.
  requestChecksumCalculation: 'WHEN_REQUIRED',
})

console.log(
  dryRun
    ? `— DRY RUN — would upload to static/${version}/ in "${bucket}"`
    : `Uploading public/{${DIRS.join(',')}} → static/${version}/ in "${bucket}"`
)

let uploaded = 0
let skipped = 0
let bytes = 0
const failures = []

for (const dir of DIRS) {
  const root = path.join('public', dir)
  try {
    await stat(root)
  } catch {
    console.log(`  (skip: public/${dir} does not exist)`)
    continue
  }

  for await (const file of walk(root)) {
    const rel = path.relative('public', file).split(path.sep).join('/')
    const key = `static/${version}/${rel}`
    const size = (await stat(file)).size
    const ext = path.extname(file).toLowerCase()
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

    // Already there at the same size? Nothing to do — safe to re-run.
    try {
      const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      if (head.ContentLength === size) {
        skipped++
        continue
      }
    } catch {
      // not present yet
    }

    if (dryRun) {
      console.log(`  would upload  ${key}  (${(size / 1024).toFixed(0)}KB, ${contentType})`)
      uploaded++
      bytes += size
      continue
    }

    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await readFile(file),
          ContentType: contentType,
          // Versioned path, so these bytes never change under this URL.
          CacheControl: 'public, max-age=31536000, immutable',
        })
      )
      uploaded++
      bytes += size
      console.log(`  uploaded  ${key}  (${(size / 1024).toFixed(0)}KB)`)
    } catch (e) {
      failures.push(key)
      console.error(`  FAILED ${key}: ${e instanceof Error ? e.message : e}`)
    }
  }
}

console.log(
  `\nDone. uploaded=${uploaded} skipped(already present)=${skipped} bytes=${(bytes / 1024 / 1024).toFixed(2)}MB failed=${failures.length}`
)
if (failures.length) process.exit(1)
if (!dryRun && uploaded > 0) {
  console.log(`\nVerify one: curl -sI https://cdn.xibit360.art/static/${version}/models/visitor.glb | head -3`)
}
