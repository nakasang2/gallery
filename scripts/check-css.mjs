// CSSのクラス／IDセレクタが、実際にマークアップに存在するかを照合する番人。
// 「宣言は正しく、構文も通り、しかし効果はゼロ」というCSS特有の失敗を機械で止める
// （LESSONS「品質・レビュー（CSSが書いてあるのに効いていない）」×4 → DECISIONS 2026-07-28 で機械化）。
//
// CSSは効かなくてもエラーを出さないので tsc もビルドも素通りする。クラス名の
// リネーム時にCSS側が取り残される／存在しないクラス名に最初から書いてしまう、の
// 両方をここで捕まえる。
//
// クラスの判定は「そのクラス名がTSX/TS内のどこかに語として現れるか」。className への
// 直書きだけでなく、テンプレート文字列での連結や状態クラス（' open' など）も
// 拾えるよう、あえて緩く見る。緩い側に倒すのは、誤検知でpushが止まる方が
// 見逃しより高コストだから。
//
// IDの判定は「id を渡しうる書き方の中に現れるか」。クラスと同じ“語としてどこかに
// 現れるか”では緩すぎて役に立たない: 実際に死んでいた `#stage` は、無関係な
// `.stage-root` や英文の "stage"、JSの状態フィールド `s.stage` に当たって
// 生き残ってしまう。IDは className と違って id 属性・aria の参照・#フラグメント
// といった限られた形でしか付かないので、そこだけを見れば緩さを保ったまま効く。
//
// 例外の付け方: そのCSS行か直前の行に `css-ok` とコメントを書く（理由も添える）。
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { assertNoUntracked } from './untracked-guard.mjs'

// 既知の「死んでいるCSS」の基準線。ラチェットとして使う: ここに無いものが出たら
// 落ちる（=新しく書いたルールが効いていない、という×4の失敗を確実に捕まえる）。
// 導入時の90件は掃除済みで、**現在は空配列＝目標値0に到達している**。
// **この配列は減らす方向にしか変えない。** 掃除して消えたら基準線からも消す。
const BASELINE_PATH = 'scripts/css-dead-baseline.json'

// 照合先はリポジトリ全体の .ts/.tsx。クラス名を組み立てているのが lib/ の
// マークダウン描画や classList 操作であることもあるため、app/components に
// 絞ると生きているクラスを「死んでいる」と誤判定する。
const isCss = (f) => f.endsWith('.css') && (f.startsWith('app/') || f.startsWith('components/'))
const isCode = (f) => f.endsWith('.tsx') || f.endsWith('.ts')
assertNoUntracked((f) => isCss(f) || isCode(f), 'CSS/コードファイル')

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
const cssFiles = files.filter(isCss)
const codeFiles = files.filter(isCode)

// マークアップ側の全文（クラス名が語として現れるかだけ見る）
const code = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

// 疑似要素・疑似クラス・属性セレクタを外したうえでクラス名を拾う
const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g
const ID_RE = /#(-?[_a-zA-Z][\w-]*)/g

// マークアップが付けうる id を集める。id 属性そのものに加え、id を指す
// aria/label 系の属性と getElementById、それに `#foo`（querySelector や
// href="#foo"）も生存の証拠として数える。属性値は aria-labelledby="a b" の
// ように空白区切りの列挙がありうるのでトークンに割る。
const ID_ATTR = 'id|htmlFor|for|list|form|popovertarget|aria-(?:labelledby|controls|describedby|details|owns|errormessage|activedescendant)'
const ID_SOURCE_RE = new RegExp(
  `(?:\\b(?:${ID_ATTR})\\s*=\\s*\\{?\\s*|getElementById\\(\\s*)(['"\`])([^'"\`]*)\\1`,
  'g',
)
const idLiterals = new Set()
// `id={`w-${i}`}` のように動的に組む場合は、`${` より前を前方一致の
// ワイルドカードとして扱う（生きているものを死んだと言わない側に倒す）。
const idPrefixes = []
for (const m of code.matchAll(ID_SOURCE_RE)) {
  for (const tok of m[2].split(/\s+/).filter(Boolean)) {
    const dyn = tok.indexOf('${')
    if (dyn < 0) idLiterals.add(tok)
    else if (dyn > 0) idPrefixes.push(tok.slice(0, dyn))
  }
}
for (const m of code.matchAll(ID_RE)) idLiterals.add(m[1])

// `id={PANEL_ID}` `id={open ? 'a-open' : 'a-closed'}` のように式で渡す形は上の
// 収集では拾えない。そのままだと生きているIDを「死んでいる」と言って push を
// 止めてしまうので、「そのID名と完全一致するクォート済み文字列がTS内にあるか」
// を最後の砦にする。クラス側の「語としてどこかに現れるか」よりはるかに狭く、
// 今回の動機だった `#stage` は 'stage' / "stage" / `stage` が全リポジトリで
// 0件のため、この緩和を入れても検出され続ける。
const quotedLiteral = (id) => new RegExp(`['"\`]${id.replace(/-/g, '\\-')}['"\`]`).test(code)

const idIsUsed = (id) =>
  idLiterals.has(id) || idPrefixes.some((p) => id.startsWith(p)) || quotedLiteral(id)

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
  // カンマ区切りのセレクタは複数行に分かれる（`.a,` 改行 `.b {`）。`{` のある行
  // だけを見ると最終行以外が一度も照合されないので、`{` が来るまで溜める。
  let pending = ''
  let pendingAt = -1
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
    if (!line.includes('{')) {
      // 宣言（`color: red;`）やルールの閉じ（`}`）はセレクタの続きではない
      if (/[;}]/.test(line)) {
        pending = ''
        pendingAt = -1
        return
      }
      if (!pending) pendingAt = i
      pending += ` ${line}`
      return
    }
    // 宣言の値（url(.foo) や 0.5rem など）を拾わないよう、セレクタ部分だけを見る。
    // 同じ行に前のルールの `}` が残っていることがあるので、それより後ろを取る
    // （`color: #ff0000; } .live { ... }` の16進カラーをIDと読み違えないため）
    const sel = `${pending} ${line.split('{')[0].split('}').pop()}`
    const selAt = pendingAt >= 0 ? pendingAt : i
    pending = ''
    pendingAt = -1
    if (/^\s*@/.test(line)) return
    // 例外注記は直前の連続したコメント行もさかのぼって探す（理由を複数行で書けるように）
    // 複数行セレクタでは1行目の上に書かれることもあるので両方見る
    if (annotatedCss(lines, i) || annotatedCss(lines, selAt)) return

    for (const m of sel.matchAll(CLASS_RE)) {
      const cls = m[1]
      if (new RegExp(`\\b${cls.replace(/-/g, '\\-')}\\b`).test(code)) continue
      findings.push({ file, line: selAt + 1, kind: 'class', cls, sel: sel.trim() })
    }
    // a[href^='#'] のような属性セレクタの中身をIDと読み違えないよう外しておく
    for (const m of sel.replace(/\[[^\]]*\]/g, ' ').matchAll(ID_RE)) {
      if (idIsUsed(m[1])) continue
      findings.push({ file, line: selAt + 1, kind: 'id', cls: m[1], sel: sel.trim() })
    }
  })
}

const baseline = new Set(existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : [])
// クラスの基準線キーは既存の `file|name` のまま。IDは `file|#name` として
// 名前空間を分ける（同名のクラスとIDが衝突しないように）。
const show = (kind, name) => (kind === 'id' ? `#${name}` : `.${name}`)
const key = (f) => `${f.file}|${show(f.kind, f.cls).replace(/^\./, '')}`
const fresh = findings.filter((f) => !baseline.has(key(f)))
const seen = new Set(findings.map(key))
const stale = [...baseline].filter((k) => !seen.has(k))

if (fresh.length) {
  console.error(`マークアップに存在しないクラス／IDへのCSS ${fresh.length} 件（基準線に無い＝今回入ったもの）:\n`)
  for (const f of fresh) console.error(`  ${f.file}:${f.line}  ${show(f.kind, f.cls)}   ← ${f.sel.slice(0, 80)}`)
  console.error(`\nリネームの取り残しなら実体に合わせ、意図的なら css-ok とコメントを書いてください。`)
  process.exit(1)
}
console.log(`新規に効いていないCSSクラス／ID: 0 件（${cssFiles.length} CSS / ${codeFiles.length} コードと照合）`)
if (findings.length) console.log(`既知の死んだCSS（基準線で抑制中）: ${findings.length} 件 — 掃除は別タスク`)
if (stale.length) {
  console.log(`\n基準線から外せるもの ${stale.length} 件（掃除済み。${BASELINE_PATH} から消してください）:`)
  for (const k of stale) {
    const [f, name] = k.split('|')
    console.log('  ', `${f} → ${name.startsWith('#') ? name : `.${name}`}`)
  }
}
