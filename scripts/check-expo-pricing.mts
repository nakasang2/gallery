// 合同展示の「会期の長さ」を、**アプリ側とDB側で突き合わせる**番人。
//
// なぜ要るか: 長さの集合が2箇所にある。
//   ・`lib/pricing.ts` の `EXPO_SKUS`（価格を決める側。checkout が使う）
//   ・`supabase/migrations/0044_expos.sql` の `expo_days_allowed()`（DBが受ける側）
//
// ここがずれると**お金だけ取れて会期が始まらない**。checkout は通り、Stripe は課金し、
// webhook が `record_expo_purchase` を呼んだところで「unsupported run length」で弾かれる
// ── そして webhook は「retryしても直らない」と判断して ack する（それが正しい振る舞い
// なので、**課金だけ成立して誰も気づかない**）。型チェックもビルドも何も言わない。
//
// 実行: npm run check:expo
//
// **両方をテキストとして読む。** `lib/pricing.ts` を import しないのは、そこから
// `lib/entitlements` を拡張子なしで辿るため（`--experimental-strip-types` は解決できない）。
// この番人の目的は「2つのファイルの数字が一致していること」なので、どちらも読み取りで足りる。
import { readFileSync } from 'node:fs'

const PRICING = 'lib/pricing.ts'
const MIGRATION = 'supabase/migrations/0044_expos.sql'
const errors: string[] = []

// ---- アプリ側（価格表）----
let priced: { days: number; cents: number }[] = []
try {
  const ts = readFileSync(PRICING, 'utf8')
  // `expo_7: 1500,` の形を全部拾う
  for (const m of ts.matchAll(/^\s*expo_(\d+)\s*:\s*(\d+)\s*,/gm)) {
    priced.push({ days: Number(m[1]), cents: Number(m[2]) })
  }
  if (priced.length === 0) {
    errors.push(`${PRICING} に expo_<日数>: <セント> の価格が1つも無い`)
  }
  // 価格表に載っているものが EXPO_SKUS にも並んでいること（片方だけ足すのを防ぐ）
  const listed = [...ts.matchAll(/'(expo_\d+)'/g)].map((m) => m[1])
  for (const { days } of priced) {
    if (!listed.includes(`expo_${days}`)) {
      errors.push(`expo_${days} が EXPO_SKUS に無い（価格だけ足して一覧に入れ忘れている）`)
    }
  }
} catch {
  errors.push(`${PRICING} が読めない`)
}

const appDays = priced.map((p) => p.days)
for (const { days, cents } of priced) {
  if (!Number.isInteger(days) || days <= 0) errors.push(`expo_${days}: 会期の日数がおかしい`)
  if (!Number.isInteger(cents) || cents <= 0) errors.push(`expo_${days}: 価格が入っていない`)
}
// 長い会期のほうが安い、という並びになっていないか（値付けの取り違え）
const sorted = [...priced].sort((a, b) => a.days - b.days)
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].cents <= sorted[i - 1].cents) {
    errors.push(
      `会期が長いほうが安い（または同額）: ${sorted[i - 1].days}日=${sorted[i - 1].cents} → ${sorted[i].days}日=${sorted[i].cents}`
    )
  }
}

// ---- DB側 ----
let dbDays: number[] = []
try {
  const sql = readFileSync(MIGRATION, 'utf8')
  // `select p_days in (7, 14, 30)` の括弧の中を読む
  const m = sql.match(/p_days\s+in\s*\(([^)]*)\)/i)
  if (!m) {
    errors.push(`${MIGRATION} に expo_days_allowed の日数リスト（p_days in (...)）が見つからない`)
  } else {
    dbDays = m[1]
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n))
  }
} catch {
  errors.push(`${MIGRATION} が読めない`)
}

// ---- 突き合わせ ----
if (dbDays.length > 0) {
  const a = [...new Set(appDays)].sort((x, y) => x - y)
  const b = [...new Set(dbDays)].sort((x, y) => x - y)
  if (a.join(',') !== b.join(',')) {
    errors.push(
      `会期の集合がずれている。lib/pricing = [${a.join(', ')}] / ${MIGRATION} = [${b.join(', ')}]` +
        ' ← **この状態だと決済は通るのにDBが拒否し、お金だけ取れる**'
    )
  }
}

if (errors.length > 0) {
  console.error(`合同展示の会期と価格: ${errors.length} 件おかしい\n`)
  for (const e of errors) console.error('  ✗ ' + e)
  console.error(
    `\n${PRICING} の EXPO_SKUS / PRICE_USD_CENTS と、` +
      `${MIGRATION} の expo_days_allowed() を一致させること。`
  )
  process.exit(1)
}

console.log(
  `合同展示の会期と価格: ${priced.length} 通りが一致（` +
    sorted.map((p) => `${p.days}日=$${(p.cents / 100).toFixed(0)}`).join(' / ') +
    '、DB側の許可リストとも照合）'
)
