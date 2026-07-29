// `supabase/schema.sql`（統合スナップショット）が `supabase/migrations/*.sql` から
// 取り残されるのを検出する番人。
//
// なぜ必要か: schema.sql が 0024 で止まり、0025〜0034 の10本が入っていないことが
// ユーザーの指摘で判明した（2026-07-29）。本番DBには個別に適用済みだったので本番は
// 正常で、壊れていたのは**「schema.sql 1ファイルで新しい環境を作る」経路だけ**。
// つまり「使っていない経路が静かに腐る」種類の不具合で、動作確認では絶対に出ない。
// 既存の番人（check:i18n / check:css）も build も `.sql` を一切見ないため、
// 誰も気づけなかった。README §1 の適用手順の一覧も同じ理由で 0024 で止まっていた。
//
// 検査するのは3点（SQLは実行しない。ローカルにPostgresが無くても回る静的照合）:
//   1) 各 migration に対応するヘッダ節（`-- # NNNN_*.sql`）が schema.sql にあるか
//   2) 各 migration の**コメントを除いたコード行**が、schema.sql の中に
//      **順序を保った部分列として**すべて現れるか（＝節の中身が本当に入っているか）
//   3) README §1 の適用手順の一覧に各 migration が載っているか
// おまけに、schema.sql の前文が名乗る統合範囲（「migrations 0001〜NNNN を統合」）が
// 実際の最新番号と合っているかも見る（これも今回まさに古いままだった）。
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { assertNoUntracked } from './untracked-guard.mjs'

const SCHEMA = 'supabase/schema.sql'
const README = 'supabase/README.md'

// 番人は git に登録されたものしか見ない。**新しい migration ほど未追跡ですり抜ける**
// という逆転が起きる（LESSONS 2026-07-28）ので、先に自分で言わせる。
assertNoUntracked((f) => /^supabase\/.*\.(sql|md)$/.test(f), 'SupabaseのSQL/手順ファイル')

const migrations = execSync('git ls-files supabase/migrations', { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f.endsWith('.sql'))
  .map((path) => ({ path, name: path.slice(path.lastIndexOf('/') + 1) }))
  .filter((m) => /^\d{4}_.+\.sql$/.test(m.name))
  .sort((a, b) => a.name.localeCompare(b.name))

if (!migrations.length) {
  console.error(`supabase/migrations に NNNN_*.sql が1本もありません（git ls-files で集めています）。`)
  process.exit(1)
}
for (const f of [SCHEMA, README]) {
  if (existsSync(f)) continue
  console.error(`${f} が見つかりません。統合スナップショットと適用手順は照合の相手なので必須です。`)
  process.exit(1)
}

// --- コメントを落としてコード行だけにする ----------------------------------
// 落とすのは `--` 以降と `/* */` ブロックだけ（手作業で照合したときと同じ方法）。
// ただし `--` は文字列リテラルの中にも書けるので、素朴に indexOf('--') で切ると
// コード行の途中を落として「入っているのに入っていない」と言い出す。引用符の
// 内側かどうかだけは追う。`$$ … $$` の関数本体に入っている `--` 行は、
// migration 側と schema.sql 側で同じように落ちるので照合には影響しない。
//
// 空白の量とインデントは統合時に変わりうるので、比較用に正規化する（前後を
// 削って中の連続空白を1つに畳む）。落とすのは見た目だけで、トークンは残る。
const codeLines = (src) => {
  const out = []
  let inBlock = false
  src.split('\n').forEach((raw, i) => {
    let line = ''
    let inStr = false
    let j = 0
    while (j < raw.length) {
      if (inBlock) {
        if (raw.startsWith('*/', j)) {
          inBlock = false
          j += 2
        } else j++
        continue
      }
      if (inStr) {
        line += raw[j]
        if (raw[j] === "'") inStr = false // '' のエスケープは「閉じて開く」で釣り合う
        j++
        continue
      }
      if (raw.startsWith('--', j)) break
      if (raw.startsWith('/*', j)) {
        inBlock = true
        j += 2
        continue
      }
      if (raw[j] === "'") inStr = true
      line += raw[j]
      j++
    }
    const norm = line.trim().replace(/\s+/g, ' ')
    if (norm) out.push({ n: i + 1, text: norm })
  })
  return out
}

const schemaSrc = readFileSync(SCHEMA, 'utf8')
const schemaLines = schemaSrc.split('\n')
const schemaCode = codeLines(schemaSrc)

// --- 1) ヘッダ節 -------------------------------------------------------------
// `-- # 0024_public_visit_count.sql` の形。0023 以降は同じ行に説明が続く
// （`-- # 0023_arrangement.sql — manual slot placement (§11.13)`）ので、
// ファイル名の直後は行末でも空白でもよいとする。
const HEADER_RE = /^--\s*#\s*(\d{4}_\S*?\.sql)\b/
const headerLine = new Map() // migration名 → schema.sql の行番号(1始まり)
schemaLines.forEach((raw, i) => {
  const m = raw.match(HEADER_RE)
  if (m && !headerLine.has(m[1])) headerLine.set(m[1], i + 1)
})

// --- 3) README §1 の一覧 -----------------------------------------------------
// 「## 1. …」の見出しから次の「## 」までを一覧とみなす。個別のファイル名だけで
// なく、`0011`〜`0015` のような範囲でまとめた行も「載っている」と認める
// （README は実際にそう書いており、1行1本に開かせるのは番人の仕事ではない）。
const readmeSrc = readFileSync(README, 'utf8')
const sectionOne = (() => {
  const lines = readmeSrc.split('\n')
  const start = lines.findIndex((l) => /^##\s*1\./.test(l))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^##\s/.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
})()
if (sectionOne === null) {
  console.error(`${README} に「## 1.」の見出しが見つかりません（適用手順の一覧を探す起点です）。`)
  process.exit(1)
}
// 見るのは**箇条書きの行だけ**。節の地の文まで数えると、説明文の「下の 0001〜0034 が
// 一括で適用されます」の一言で全 migration が「一覧に載っている」ことになり、
// 一覧そのものを見なくなる（この番人を入れた作業でREADMEにその一文を書いた瞬間に
// 照合が空振りになった 2026-07-29）。範囲でまとめるのは箇条書きの中でだけ認める。
const listItems = sectionOne
  .split('\n')
  .filter((l) => /^\s*[-*]\s/.test(l))
  .join('\n')
const listedNames = new Set(listItems.match(/\d{4}_\S*?\.sql/g) ?? [])
const listedRanges = [...listItems.matchAll(/(\d{4})`?\s*[〜~～]\s*`?(\d{4})/g)].map((m) => [+m[1], +m[2]])
const listedInReadme = (name) => {
  if (listedNames.has(name)) return true
  const num = +name.slice(0, 4)
  return listedRanges.some(([a, b]) => num >= a && num <= b)
}

// --- 照合 -------------------------------------------------------------------
const missingHeader = []
const missingBody = []
const missingFromReadme = []

for (const m of migrations) {
  if (!listedInReadme(m.name)) missingFromReadme.push(m.name)

  const from = headerLine.get(m.name)
  if (from === undefined) {
    missingHeader.push(m.name)
    continue // ヘッダが無いなら本文も無い。二重に報告しない
  }

  // ヘッダ以降を対象に、migration のコード行が順序どおり全部現れるかを見る。
  // 「どこかにあればよい」ではなく「自分の節から後ろに、順番どおり」。
  const want = codeLines(readFileSync(m.path, 'utf8'))
  let cursor = schemaCode.findIndex((l) => l.n > from)
  if (cursor < 0) cursor = schemaCode.length
  let missed = null
  for (const w of want) {
    let hit = -1
    for (let k = cursor; k < schemaCode.length; k++) {
      if (schemaCode[k].text === w.text) {
        hit = k
        break
      }
    }
    if (hit < 0) {
      missed = w
      break
    }
    cursor = hit + 1
  }
  if (missed) missingBody.push({ name: m.name, at: missed.n, text: missed.text, total: want.length })
}

// schema.sql にあるのに migration が無いヘッダ（改名・削除の取り残し）
const orphanHeaders = [...headerLine.keys()].filter((n) => !migrations.some((m) => m.name === n))

// 前文が名乗る統合範囲（「migrations 0001〜0022 を統合」）が最新番号と合っているか。
// ここが古いままだと、貼り付ける人は「0022までのはず」と信じて確認を省く。
const newest = migrations[migrations.length - 1].name.slice(0, 4)
const claim = schemaSrc.match(/migrations\s*(\d{4})`?\s*[〜~～]\s*`?(\d{4})/)
const staleClaim = claim && claim[2] !== newest ? { said: claim[2], newest } : null

// --- 報告 -------------------------------------------------------------------
let bad = false
const head = (msg) => {
  bad = true
  console.error(msg)
}

if (missingHeader.length) {
  head(`schema.sql に節が無い migration が ${missingHeader.length} 本あります:\n`)
  for (const n of missingHeader) console.error(`  ${n}`)
  console.error(`\n\`-- # ${missingHeader[0]}\` の見出しと本文を supabase/schema.sql の末尾に足してください。`)
  console.error(`（schema.sql は「これ1枚で新しい環境を作れる」ことが役目です）\n`)
}

if (missingBody.length) {
  head(`節はあるが中身が schema.sql に入っていない migration が ${missingBody.length} 本あります:\n`)
  for (const f of missingBody) {
    console.error(`  ${f.name}:${f.at}  （${f.total} コード行のうちここから先が見つかりません）`)
    console.error(`    ${f.text.slice(0, 100)}`)
  }
  console.error(`\nコメントを除いたコード行が、順序どおりに schema.sql に現れる必要があります。`)
  console.error(`部分的に足した／後から migration 側だけ直した場合に出ます。\n`)
}

if (missingFromReadme.length) {
  head(`supabase/README.md §1 の一覧に載っていない migration が ${missingFromReadme.length} 本あります:\n`)
  for (const n of missingFromReadme) console.error(`  ${n}`)
  console.error(`\n§1 の「個別(履歴・差分を追いたい場合)」の一覧に1行ずつ足してください`)
  console.error(`（\`0011\`〜\`0015\` のような範囲でまとめた行でも構いません）。\n`)
}

if (orphanHeaders.length) {
  head(`schema.sql に節はあるが migration が存在しないものが ${orphanHeaders.length} 件あります:\n`)
  for (const n of orphanHeaders) console.error(`  ${n}  (schema.sql:${headerLine.get(n)})`)
  console.error(`\n改名や削除の取り残しです。migrations 側と名前を合わせてください。\n`)
}

if (staleClaim) {
  head(`schema.sql の前文が名乗る統合範囲が古いままです: 「0001〜${staleClaim.said}」`)
  console.error(`実際の最新 migration は ${staleClaim.newest} です。貼り付ける人がここを信じて確認を省きます。\n`)
}

if (bad) process.exit(1)

console.log(
  `schema.sql の取り残し: 0 件（migration ${migrations.length} 本を照合／schema.sql ${schemaCode.length} コード行・README §1 の一覧も突き合わせ済み）`,
)
