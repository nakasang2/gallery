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
//   ・**番号付きの項目に `t` も `f` も出ていない** — その項目は何も検査していない
//     （/kaizen 昇格 2026-08-13。詳細は下の「空振りの検出」）
// 見ないもの:
//   ・`ERROR` そのもの — 拒否の確認では**期待している**。
//
// 使い方: `node scripts/sql-verdict.mjs <psqlの出力を書いたファイル> [テストファイル名]`
//         第2引数は空振りの基準線を引くためのキー。落ちていれば理由を出して exit 1。
import { readFileSync, existsSync } from 'node:fs'

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

/* ================= 空振りの検出（/kaizen 昇格 2026-08-13・×4） =================
 *
 * 「番号付きの項目に `t` も `f` も1つも出ていない」＝**その項目は何も検査していない**。
 *
 * この形はここが `ERROR` を見ない設計（上の注記）と噛み合って生まれる。
 *
 *     \echo -n '01 他人宛の通知を作る → '
 *     insert into ... ;   -- ← 拒否されて ERROR が出る。それだけ。
 *
 * 拒否されれば ERROR、**通ってしまっても `INSERT 0 1`** で、どちらも `f` にならない。
 * つまり守りが静かに壊れた日も「すべて期待どおり」と出る。実測（2026-08-13）で
 * **307項目のうち61項目（20%）がこの形**だった。
 *
 * 正しい書き方は例外を捕まえて **SQLSTATE を返す**補助関数を置き、`= '42501'` のように
 * 突き合わせること（`supabase/tests/0058_*.sql` / `0059_*.sql` がその形）。
 * SQLSTATEまで見るので、書き間違いによる別のエラーで通ることも防げる。
 *
 * 既知の61項目は基準線（`scripts/sql-vacuous-baseline.json`）で抑制する。`check:css` と
 * 同じ作法で、**減らす方向にしか変えない**（新しく増えたら落ちる）。
 */
const BASELINE_PATH = 'scripts/sql-vacuous-baseline.json'
const baseline = new Set(existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : [])

/** 番号付きラベルに verdict（`t`/`f`）が付いたかを見る。
 *  `name` はテストファイル名（`run.sh` が第2引数で渡す。基準線のキーに使う）。
 *  合成入力を1本のテキストで流す `check:gates` 用に、出力中の `### ファイル名` も拾う。 */
function findVacuous(out, name = '?') {
  const found = []
  let file = name
  let pending = null
  const close = () => {
    if (pending && !pending.verdict) found.push(pending)
    pending = null
  }
  for (const raw of out.split('\n')) {
    const line = raw.trimEnd()
    const head = /^### (\S+)/.exec(line)
    if (head) {
      close()
      file = head[1]
      continue
    }
    // ラベルは `  01 ...` / `  22b ...`（`\echo -n` が出す）。**ラベル自身が `: ` を
    // 含む**ことがあるので、verdict は「行末が `: t` / `: f`」で判定する（前方一致で
    // 切ると取りこぼす — 実測でこれを一度間違えた）。
    const label = /^\s*(\d{2}[a-z]?) /.exec(line)
    if (label) {
      close()
      const v = /: (t|f)$/.exec(line)
      pending = { file, n: label[1], text: line.trim(), verdict: v ? v[1] : null }
      continue
    }
    if (pending && !pending.verdict && (line.trim() === 't' || line.trim() === 'f')) {
      pending.verdict = line.trim()
    }
  }
  close()
  return found
}

const testName = process.argv[3] || '?'
const vacuous = findVacuous(text, testName)
const vkey = (v) => `${v.file}|${v.n}`
const freshVacuous = vacuous.filter((v) => !baseline.has(vkey(v)))
const seenVacuous = new Set(vacuous.map(vkey))
// **「直った」の判定は、いま流したファイルの分だけに絞る。** `run.sh` はテストファイル
// ごとにこのスクリプトを呼ぶので、絞らないと他のファイルの基準線が毎回「直った」に見える
// （＝消せと言われて消すと、そのファイルを次に流した日に落ちる）。
const filesSeen = new Set(vacuous.map((v) => v.file).concat(testName === '?' ? [] : [testName]))
const staleVacuous = [...baseline].filter((k) => filesSeen.has(k.split('|')[0]) && !seenVacuous.has(k))

if (freshVacuous.length) {
  problems.push(`何も検査していない項目がある（${freshVacuous.length} 件・基準線に無い＝今回入ったもの）`)
  for (const v of freshVacuous.slice(0, 10)) problems.push(`  ${v.file} ${v.text.slice(0, 70)}`)
  problems.push('  → 例外を捕まえて SQLSTATE を返す補助関数で `= \'42501\'` のように突き合わせてください')
  problems.push('  （書き方の例: supabase/tests/0058_replace_placements.sql の __t58_state）')
}

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

if (vacuous.length) {
  console.log(`既知の「何も検査していない項目」: ${vacuous.length} 件（基準線で抑制中） — 書き直しは別タスク`)
}
if (staleVacuous.length) {
  console.log(`\n基準線から外せるもの ${staleVacuous.length} 件（直った。${BASELINE_PATH} から消してください）:`)
  for (const k of staleVacuous) console.log('  ', k.replace('|', ' → '))
}
