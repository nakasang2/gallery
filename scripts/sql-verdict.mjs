// SQLテストの判定（`supabase/tests/run.sh` から呼ばれる）。psql の出力1本を読んで、
// 「落ちた」かどうかだけを決める。
//
// **判定をシェルの grep から出したのは、判定そのものを試験できるようにするため。**
// 実際に取りこぼした（実測 2026-08-10）: 判定が `grep -E ': f$'` だけだったので、
//
//     \echo -n '05 来場を記録できる: '
//     insert into ... ;      -- ← psql が "INSERT 0 1" を出す
//     select count(*)=1 ...; -- ← その次の行に "f" だけが出る
//
// という形（ラベルと値のあいだに別の文の状態行が挟まる）で `f` が**行頭単独**になり、
// 期待外れ2件を抱えたまま「すべて期待どおり」と表示した。**検証が嘘をつくのは、
// 検証が無いより悪い。**
//
// 見るもの:
//   ・`t` / `f` の行 — `f` が1つでもあれば落ちている（ラベルと同じ行でも、単独行でも）
//   ・`is aborted` — 想定外のエラーが後続を全部巻き込んだ合図（0043 で全滅した形）
// 見ないもの:
//   ・`ERROR` そのもの — 拒否の確認では**期待している**。
//
// 使い方: `node scripts/sql-verdict.mjs <psqlの出力を書いたファイル>`
//         落ちていれば理由を出して exit 1。
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: sql-verdict.mjs <output-file>')
  process.exit(2)
}

const text = readFileSync(path, 'utf8')
const problems = []

const failing = []
for (const raw of text.split('\n')) {
  const line = raw.trimEnd()
  // ラベルと同じ行に出た値（`01 なにか: f`）と、単独行に出た値（`f`）の両方。
  // **`f` で終わる語**（`... off` など）を拾わないよう、単独行は行全体が `f` のときだけ。
  if (/: f$/.test(line) || line.trim() === 'f') failing.push(line.trim() || 'f')
}
if (failing.length) {
  problems.push(`期待と違う項目がある（${failing.length} 件）`)
  for (const f of failing.slice(0, 10)) problems.push(`  ${f}`)
}

if (text.includes('is aborted')) {
  problems.push('想定外のエラーで以降が流れていない（土台不足か構文エラー）')
}

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
