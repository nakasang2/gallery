#!/usr/bin/env node
// One-off: move LP hero/panel images out of the uploading admin's own
// `{uid}/lp/` R2 folder into a fixed `_shared/lp/` prefix that no account owns
// (リリース前監査 #41・2026-08-21・ユーザー決定: 並べ替えを実施する).
//
// Why this had to move: `app/api/upload-url/route.ts` used to key LP uploads
// under the calling admin's own uid ("harmless because it's your own folder"),
// but `app/api/account/delete/route.ts` deletes everything under `{uid}/` when
// that account closes — so deleting the admin who happened to upload the LP
// images broke them site-wide. New uploads already go to `_shared/lp/` (see
// that route's `lp-image` rule); this script relocates whatever is still under
// the old `{uid}/lp/...` layout and rewrites the URLs stored in `site_config`.
//
// Safe to re-run: a slot whose URL already points at `_shared/lp/` is skipped.
// Nothing is deleted from the old location — verify the site first, then clean
// up old `{uid}/lp/` objects by hand once you're confident.
//
// 使い方:
//   node --env-file=.env.local scripts/migrate-lp-images-to-shared.mjs --dry-run
//   node --env-file=.env.local scripts/migrate-lp-images-to-shared.mjs
//
// 必要な環境変数:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (site_config の読み書き)
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  (コピー先)
//   NEXT_PUBLIC_R2_PUBLIC_BASE   (保存済みURL → キーの逆算に使う。lib/publicUrl.ts と同じ変数)
import { createClient } from '@supabase/supabase-js'
import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

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

const publicBase = need('NEXT_PUBLIC_R2_PUBLIC_BASE').replace(/\/+$/, '')
const publicUrl = (key) => `${publicBase}/${key.replace(/^\/+/, '')}`

/** `{uid}/lp/{slot}-{nonce}.jpg` — the OLD layout this script moves away from.
 *  uids are UUIDs, so this can't accidentally match a `_shared/...` key. */
const OLD_KEY_RE = /^([0-9a-f-]{36})\/lp\/(\d+)-([0-9a-f-]{36})\.jpg$/i

// lib/siteConfig.ts's LP band keys.
const LP_BANDS = ['lp_hero', 'lp_panels', 'lp_approach', 'lp_hall_front', 'lp_hall_sides']

async function objectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }))
    return true
  } catch {
    return false
  }
}

let movedCount = 0
let skippedCount = 0

async function migrateBand(bandKey) {
  const { data, error } = await supabase.from('site_config').select('value').eq('key', bandKey).maybeSingle()
  if (error) throw new Error(`${bandKey}: read failed: ${error.message}`)
  if (!data?.value?.slots) {
    console.log(`${bandKey}: no row yet — skip`)
    return
  }
  const slots = data.value.slots
  let changed = false

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (!slot?.url) continue
    if (!slot.url.startsWith(publicBase)) {
      console.log(`${bandKey}[${i}]: URL doesn't match NEXT_PUBLIC_R2_PUBLIC_BASE — skip (${slot.url})`)
      skippedCount++
      continue
    }
    const key = slot.url.slice(publicBase.length).replace(/^\/+/, '')
    const m = key.match(OLD_KEY_RE)
    if (!m) {
      // Already `_shared/lp/...`, or some other shape — nothing to do.
      skippedCount++
      continue
    }
    const [, , slotNum, nonce] = m
    const newKey = `_shared/lp/${slotNum}-${nonce}.jpg`
    console.log(`${bandKey}[${i}]: ${key} -> ${newKey}${dryRun ? ' (dry-run)' : ''}`)
    if (dryRun) {
      movedCount++
      continue
    }
    // **1枚の失敗（元のオブジェクトが既に手で消されていた等）で、この帯の残り
    // やこの帯自体が積んだ変更点を巻き込んで失わない**（別視点レビューで発見・
    // 2026-08-21）。失敗したスロットのURLはそのまま（旧レイアウト）に残し、
    // 帯の保存はここまでに成功した分だけを反映する。
    try {
      if (!(await objectExists(newKey))) {
        await r2.send(
          new CopyObjectCommand({
            Bucket: r2Bucket,
            // CopySource はURIエンコードが要る場合があるが、この鍵はUUID・数字・
            // ハイフン・ドット・スラッシュだけ（OLD_KEY_REで検証済み）なので素通しで安全。
            CopySource: `${r2Bucket}/${key}`,
            Key: newKey,
          })
        )
      }
    } catch (e) {
      console.error(`${bandKey}[${i}]: copy failed, leaving old URL in place: ${e.message}`)
      skippedCount++
      continue
    }
    slots[i] = { ...slot, url: publicUrl(newKey) }
    changed = true
    movedCount++
  }

  if (changed && !dryRun) {
    const { error: saveErr } = await supabase
      .from('site_config')
      .upsert({ key: bandKey, value: { slots }, updated_at: new Date().toISOString() })
    if (saveErr) throw new Error(`${bandKey}: save failed: ${saveErr.message}`)
    console.log(`${bandKey}: saved`)
  }
}

for (const bandKey of LP_BANDS) {
  // 1つの帯が読み・保存で失敗しても、残りの帯は続ける（別視点レビューで発見・
  // 2026-08-21）── 5つの帯は互いに独立した site_config の行なので、1つの
  // エラーで他の4つまで止める理由が無い。
  try {
    await migrateBand(bandKey)
  } catch (e) {
    console.error(`${bandKey}: ${e.message}`)
  }
}

console.log(`\n${dryRun ? '[dry-run] would move' : 'moved'} ${movedCount} file(s), skipped ${skippedCount} (already migrated or not R2-hosted).`)
if (dryRun) console.log('Re-run without --dry-run to apply.')
