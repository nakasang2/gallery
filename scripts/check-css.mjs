// CSSのクラスセレクタが、実際にマークアップに存在するかを照合する番人。
// 「宣言は正しく、構文も通り、しかし効果はゼロ」というCSS特有の失敗を機械で止める
// （LESSONS「品質・レビュー（CSSが書いてあるのに効いていない）」×4 → DECISIONS 2026-07-28 で機械化）。
//
// CSSは効かなくてもエラーを出さないので tsc もビルドも素通りする。クラス名の
// リネーム時にCSS側が取り残される／存在しないクラス名に最初から書いてしまう、の
// 両方をここで捕まえる。
//
// 判定は「そのクラス名がTSX/TS内のどこかに語として現れるか」。className への
// 直書きだけでなく、テンプレート文字列での連結や状態クラス（' open' など）も
// 拾えるよう、あえて緩く見る。緩い側に倒すのは、誤検知でpushが止まる方が
// 見逃しより高コストだから。
//
// 例外の付け方: そのCSS行か直前の行に `css-ok` とコメントを書く（理由も添える）。
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

// 既知の「死んでいるCSS」の基準線。削除済み機能から取り残されたルールが
// 90件あり、動的にクラス名を組んでいる箇所を巻き込む危険があるため一括削除は
// していない。ラチェットとして使う: ここに無いものが出たら落ちる（=新しく
// 書いたルールが効いていない、という×4の失敗を確実に捕まえる）。
// **この配列は減らす方向にしか変えない。** 掃除して消えたら基準線からも消す。
const BASELINE_PATH = 'scripts/css-dead-baseline.json'

// 照合先はリポジトリ全体の .ts/.tsx。クラス名を組み立てているのが lib/ の
// マークダウン描画や classList 操作であることもあるため、app/components に
// 絞ると生きているクラスを「死んでいる」と誤判定する。
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
const cssFiles = files.filter((f) => f.endsWith('.css') && (f.startsWith('app/') || f.startsWith('components/')))
const codeFiles = files.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))

// マークアップ側の全文（クラス名が語として現れるかだけ見る）
const code = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

// 疑似要素・疑似クラス・属性セレクタを外したうえでクラス名を拾う
const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g

const annotatedCss = (lines, i) => {
  if ((lines[i] ?? '').includes('css-ok')) return true
  for (let j = i - 1; j >= 0; j--) {
    const t = (lines[j] ?? '').trim()
    if (!/^(\/\*|\*)/.test(t)) return false
    if (t.includes('css-ok')) return true
  }
  return false
}

const findings = []
for (const file of cssFiles) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let inComment = false
  lines.forEach((raw, i) => {
    let line = raw
    if (inComment) {
      const end = line.indexOf('*/')
      if (end < 0) return
      line = line.slice(end + 2)
      inComment = false
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const open = line.lastIndexOf('/*')
    if (open >= 0 && line.indexOf('*/', open) < 0) {
      inComment = true
      line = line.slice(0, open)
    }
    if (!line.trim()) return
    // 宣言の値（url(.foo) や 0.5rem など）を拾わないよう、セレクタ行だけを見る
    const sel = line.split('{')[0]
    if (!line.includes('{') || /^\s*@/.test(line)) return
    // 例外注記は直前の連続したコメント行もさかのぼって探す（理由を複数行で書けるように）
    if (annotatedCss(lines, i)) return

    for (const m of sel.matchAll(CLASS_RE)) {
      const cls = m[1]
      if (new RegExp(`\\b${cls.replace(/-/g, '\\-')}\\b`).test(code)) continue
      findings.push({ file, line: i + 1, cls, sel: sel.trim() })
    }
  })
}

const baseline = new Set(existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : [])
const key = (f) => `${f.file}|${f.cls}`
const fresh = findings.filter((f) => !baseline.has(key(f)))
const seen = new Set(findings.map(key))
const stale = [...baseline].filter((k) => !seen.has(k))

if (fresh.length) {
  console.error(`マークアップに存在しないクラスへのCSS ${fresh.length} 件（基準線に無い＝今回入ったもの）:\n`)
  for (const f of fresh) console.error(`  ${f.file}:${f.line}  .${f.cls}   ← ${f.sel.slice(0, 80)}`)
  console.error(`\nリネームの取り残しなら実体に合わせ、意図的なら css-ok とコメントを書いてください。`)
  process.exit(1)
}
console.log(`新規に効いていないCSSクラス: 0 件（${cssFiles.length} CSS / ${codeFiles.length} コードと照合）`)
console.log(`既知の死んだCSS（基準線）: ${findings.length} 件 — 掃除は別タスク`)
if (stale.length) {
  console.log(`\n基準線から外せるもの ${stale.length} 件（掃除済み。${BASELINE_PATH} から消してください）:`)
  for (const k of stale) console.log('  ', k.replace('|', ' → .'))
}
