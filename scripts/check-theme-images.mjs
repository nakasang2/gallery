#!/usr/bin/env node
// テーマカードの写真（public/themes/*.jpg）が、いまのテーマ定義と食い違っていないか。
//
// なぜ要るか: 写真は `lib/presets` の `THEMES` を実際のレンダラで描いた結果を焼いたもの。
// **焼いたあとに定義を変えても写真は変わらない**ので、放っておくと「ダッシュボードで
// 見た部屋」と「実際に入る部屋」が静かにずれる。しかも見た目は壊れないので誰も気づかない
// ── `check:css` の死んだCSSや `check:i18n` の孤児キーと同じ種類の負債。
//
// 見るのは3つ:
//   ① `THEMES` の各キーに `public/themes/{key}.jpg` があるか（新しいテーマの取りこぼし）
//   ② その写真が空っぽでないか（描き終わる前に焼くと数KBの真っ黒が入る。実際に踏んだ）
//   ③ `THEMES` の定義そのもののハッシュが基準線と一致するか（色や霧を触ったのに焼き直して
//      いない）
//
// ※見張るのは**テーマ定義だけ**。部屋の材質（Room.tsx）を触ったときは機械では気づけない
//   ので、そのときは手で焼き直すこと。材質のファイルまでハッシュに入れるとコメントを
//   直しただけで落ちるようになり、番人が「とりあえず基準線を更新するもの」に成り下がる。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const PRESETS = 'lib/presets.ts'
const BASELINE = 'scripts/theme-images-baseline.json'
const DIR = 'public/themes'
/** 空の写真の下限。実測: 720x450 の真っ黒は約2.7KB、中身のある写真は32KB以上あった。
 *  **非Retinaの機械で焼くと 480x300 になり、暗いテーマはこの半分以下まで小さくなる**ので、
 *  真っ黒（数KB）と分けられる範囲でいちばん低いところに置く。 */
const MIN_BYTES = 8000

function fail(msg) {
  console.error(`\n${msg}\n`)
  console.error('焼き直しの手順:')
  console.error('  1. npm run dev')
  console.error('  2. ブラウザで http://localhost:5173/theme-capture を開く（開発時のみ有効）')
  console.error('  3. 絵が出そろってから「N枚を保存」を押す')
  console.error(`  4. 落ちてきた {key}.jpg を ${DIR}/ に置く`)
  console.error(`  5. node scripts/check-theme-images.mjs --update で ${BASELINE} を更新する`)
  process.exit(1)
}

// THEMES の定義ブロックだけを切り出す（ファイル全体だと無関係な編集で落ちる）
const src = readFileSync(PRESETS, 'utf8')
const start = src.indexOf('export const THEMES')
if (start < 0) fail(`${PRESETS} に THEMES が見つかりません（番人の前提が崩れています）`)
const end = src.indexOf('\n}\n', start)
if (end < 0) fail(`${PRESETS} の THEMES の終わりが見つかりません（番人の前提が崩れています）`)
const block = src.slice(start, end + 3)
// コメントと空白の差では落とさない（見た目に関係しないため）
const meaningful = block
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\s+/g, '')
const hash = createHash('sha256').update(meaningful).digest('hex').slice(0, 16)

const keys = [...block.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1])
if (keys.length === 0) fail('THEMES からテーマのキーを1つも読めませんでした（番人の前提が崩れています）')

if (process.argv.includes('--update')) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(BASELINE, `${JSON.stringify({ hash, keys }, null, 2)}\n`)
  console.log(`${BASELINE} を更新しました（hash=${hash}, テーマ ${keys.length} 件）`)
  process.exit(0)
}

// 写真は git に登録されたものだけを見る（未追跡のまま「ある」と数えない）
const tracked = new Set(
  execFileSync('git', ['ls-files', DIR], { encoding: 'utf8' }).split('\n').filter(Boolean)
)

const problems = []
for (const key of keys) {
  const path = `${DIR}/${key}.jpg`
  if (!tracked.has(path)) {
    problems.push(`テーマ「${key}」の写真が git に無い（${path}）`)
    continue
  }
  if (!existsSync(path)) {
    problems.push(`テーマ「${key}」の写真が見つからない（${path}）`)
    continue
  }
  const bytes = statSync(path).size
  if (bytes < MIN_BYTES) {
    problems.push(`テーマ「${key}」の写真が ${bytes} バイトしかない（描き終わる前に焼いた真っ黒の可能性）`)
  }
}

if (!existsSync(BASELINE)) fail(`${BASELINE} がありません`)
const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
if (base.hash !== hash) {
  problems.push(`THEMES の定義が変わっています（基準線 ${base.hash} → いま ${hash}）。写真が古いままです`)
}

if (problems.length) fail(`テーマカードの写真が定義と食い違っています:\n  - ${problems.join('\n  - ')}`)

console.log(`テーマカードの写真: ${keys.length} 件すべて最新（hash=${hash}）`)
