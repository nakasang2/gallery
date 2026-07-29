// UI文言の直書き検出。「多言語対応は今後のUI変更でも必須」を人の記憶に頼らず
// 機械で守るための番人（DECISIONS 2026-07-28）。
//
// 完全な構文解析はしない。JSXのテキストと、来場者の目に入る4属性
// (placeholder / aria-label / title / alt) だけを見て、英語らしい文字列が
// 辞書を通っていなければ落とす。パーサ依存を増やさずCIでも動くよう正規表現で
// 済ませているが、以下は素朴な実装で取りこぼすので明示的に処理している:
//   - 複数行の /* */ コメント（状態を持って追跡する）
//   - {式} を含むJSXテキスト（先に {…} を落としてから判定する）
//   - タグをまたぐ複数行のJSXテキスト（タグも代入も無い「素の行」も見る）
//
// 例外の付け方: その行か直前の行に `i18n-ok` とコメントを書く（理由も添える）。
// ファイル単位の例外は ALLOW に理由付きで足す。
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { assertNoUntracked } from './untracked-guard.mjs'

// 英語のままにすると決めた面（DECISIONS 2026-07-28: 準拠法として英語版が正）
const ALLOW = new Set([
  'app/terms/page.tsx', // 利用規約は英語版が正
  'app/privacy/page.tsx', // プライバシーポリシーは英語版が正
  'app/[handle]/opengraph-image.tsx', // OG画像。辞書が取れず共有先の言語も不定
  'app/[handle]/[slug]/opengraph-image.tsx',
])

// 訳す対象でないもの（ブランド名・記号・単位・技術用語）
const NOT_COPY =
  /^(XIBIT360|Xibit360|Stripe|Supabase|WebGL|Cloudflare|PDF|JPEG|MP4|GIF|BGM|SNS|URL|CSS|HTML|OK|No\.|Anonymous|[\d\s.,%/·—–→←✕×▲▼⋯©]+|[A-Za-z]{1,2})$/

const looksEnglish = (s) => {
  const t = s.trim()
  if (t.length < 3 || NOT_COPY.test(t)) return false
  // 式の断片（複数行にまたがる条件やテンプレート）は文言ではない。
  // t() を通っている行も、残りはブランド名などの地の文しかない。
  // 波括弧が残っていれば {式} が閉じ切っていない断片（正規表現に // が入る等で
  // 行が途中で切れたケース）。地の文にはまず出ない。
  if (/&&|\|\||\?\?|=>|\$\{|[{}]|\bt\('/.test(t)) return false
  if (!/[A-Za-z]/.test(t)) return false
  if (/[ぁ-んァ-ヶ一-龠]/.test(t)) return false // 日本語が混じるなら辞書側の値
  const words = t.match(/[A-Za-z][A-Za-z''-]+/g) ?? []
  return words.length >= 2 || /[.?!:]$/.test(t)
}

// 1語ラベルの検出で、訳す対象でないもの（ブランド名・記号・単位・略語）
const ONE_WORD_OK = /^(XIBIT360|Xibit360|Stripe|Supabase|WebGL|Cloudflare|Instagram|Chrome|Edge|Safari|Firefox|PDF|JPEG|JPG|PNG|WebP|MP4|GIF|BGM|SNS|URL|CSS|HTML|Noir|Chic)$/

// {…} を落とす（ネストは1段だけ見れば足りる）
const stripExpr = (s) => s.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ' ')

// 文字列リテラルを同じ長さの伏せ字に置き換える。コメント境界を探す前に必ず通す:
// `accept="image/*,video/mp4"` の `/*` をブロックコメントの開始と誤認すると、
// そこから `*/` が現れるまで数百行がまるごと検査対象から抜け落ちる（実際に
// SettingsPanel.tsx で起き、英語の直書き2件を見逃していた 2026-07-28）。
// 位置がずれないよう長さを保ち、判定は伏せ字側・切り出しは元の行から行う。
const maskStrings = (s) => s.replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, (m) => m[0].repeat(m.length))

// ディレクトリだけ渡して拡張子はJS側で絞る。`git ls-files "app/**/*.tsx"` は
// pathspec の ** が1階層以上を要求するため app/page.tsx（LP本体）にマッチせず、
// トップレベルのファイルがまるごと検査対象から漏れていた（2026-07-28）。
// 例外注記（i18n-ok / state-ok）を探す。その行だけでなく、直前の連続した
// コメント行もさかのぼる — 理由を複数行で書くのが自然なため。
const annotated = (lines, i, tag) => {
  if ((lines[i] ?? '').includes(tag)) return true
  for (let j = i - 1; j >= 0; j--) {
    const t = (lines[j] ?? '').trim()
    // JSXの注記は {/* … */} で始まる
    if (!/^(\{?\/\*|\/\/|\*)/.test(t)) return false
    if (t.includes(tag)) return true
  }
  return false
}

assertNoUntracked(
  (f) => /^(app|components|lib)\//.test(f) && (f.endsWith('.tsx') || f.endsWith('.ts')),
  'コードファイル',
)

const files = execSync('git ls-files app components', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx'))
  .filter((f) => !ALLOW.has(f))

const findings = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let inBlockComment = false
  let prev = ''
  lines.forEach((raw, i) => {
    let line = raw
    let mask = maskStrings(raw)
    // --- コメントを落とす（複数行の /* */ を跨いで状態を持つ） ---
    if (inBlockComment) {
      const end = mask.indexOf('*/')
      if (end < 0) return // コメント中の行は prev を汚さない
      line = line.slice(end + 2)
      mask = mask.slice(end + 2)
      inBlockComment = false
    }
    // 1行で閉じている /* */ を、伏せ字側で見つけた範囲だけ元の行から抜く
    for (;;) {
      const a = mask.indexOf('/*')
      if (a < 0) break
      const b = mask.indexOf('*/', a + 2)
      if (b < 0) {
        inBlockComment = true
        line = line.slice(0, a)
        mask = mask.slice(0, a)
        break
      }
      line = line.slice(0, a) + ' ' + line.slice(b + 2)
      mask = mask.slice(0, a) + ' ' + mask.slice(b + 2)
    }
    const slash = mask.indexOf('//')
    if (slash >= 0) {
      line = line.slice(0, slash)
      mask = mask.slice(0, slash)
    }
    // 例外注記は同じ行でも直前の行でもよい（JSXでは直前にコメント行を置く方が自然）
    if (!line.trim() || annotated(lines, i, 'i18n-ok')) return

    const report = (kind, text) => findings.push({ file, line: i + 1, kind, text: text.trim() })

    // 1) 目に入る属性の直書き
    for (const m of line.matchAll(/\b(placeholder|aria-label|title|alt)=(?:"([^"]*)"|'([^']*)')/g)) {
      const v = stripExpr(m[2] ?? m[3] ?? '')
      if (looksEnglish(v)) report(m[1], v)
    }

    const stripped = stripExpr(line)

    // 2) 同じ行に閉じているJSXテキスト
    for (const m of stripped.matchAll(/>([^<>\n]+)</g)) {
      if (looksEnglish(m[1])) report('text', m[1])
    }

    // 2b) 1語だけのラベル（`>Add<`）。looksEnglish は「2語以上」を条件にして
    //     いるので、ボタンやリンクの短いラベルがまるごと素通りしていた
    //     （SettingsPanel の "Add" を42%まで訳した後で見つけた 2026-07-29）。
    //     3〜20文字の英単語1つだけ、というJSXテキストは文言と見て間違いない。
    for (const m of stripped.matchAll(/>([A-Za-z][A-Za-z'’-]{2,19})</g)) {
      const w = m[1]
      if (ONE_WORD_OK.test(w)) continue
      report('text', w)
    }

    // 3) タグをまたぐJSXテキスト。「素の行」だけを見ると import 一覧や
    //    オブジェクトリテラルまで拾ってしまうので、直前の行がJSXの開きタグで
    //    終わっている（= 要素の中身にいる）ことを条件にする。
    //    コードらしさは記号の有無では判定できない（"Videos (reels etc.) …" のように
    //    地の文にも括弧やセミコロンは出る）。構文の形で弾く。
    const bare = stripped.trim()
    const inElement = /[^=/]>\s*$/.test(prev)
    const codeish = /[<>]|=>|^[\w.$[\]]+\s*[:=]|[,({=]\s*$|^[.[]|\b(await|typeof|new|function)\b/
    if (inElement && !codeish.test(bare)) {
      if (looksEnglish(bare)) report('text', bare)
    }
    prev = stripped.trim() || prev
  })
}

// --- 状態を語る定型句の検出 -------------------------------------------------
// 「課金は未実装」「これはプレビューです」のような"状態"を語る文言は、実装や設定が
// 進んでも誰かが思い出すまで嘘をつき続ける（LESSONS 2026-07-13 系列 ×3。課金を
// 有効化した後もLPが Coming soon と言い続けていた）。値と違って定数化では防げない
// ので、定型句そのものを見張る。i18n化した後はこの文言が辞書側に移るため、
// lib/i18n/*.ts も対象に含める。
//
// 例外の付け方: その行か直前の行に `state-ok` とコメントし、どの変数から導出して
// いるか（または本当に静的な事実である理由）を書く。
const STATE_PHRASES =
  /coming soon|not (yet )?implemented|isn'?t (implemented|live|available) yet|not live yet|work in progress|\bWIP\b|this is a (mock|preview) for now|準備中|近日公開|これはプレビュー|未実装|まだ使えません/i

const stateFiles = execSync('git ls-files app components lib', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
const stateFindings = []
for (const file of stateFiles) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((raw, i) => {
    if (annotated(lines, i, 'state-ok')) return
    if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return // コメントでの説明は対象外
    const m = raw.match(STATE_PHRASES)
    if (m) stateFindings.push({ file, line: i + 1, hit: m[0], text: raw.trim().slice(0, 90) })
  })
}

if (stateFindings.length) {
  console.error(`状態を語る対外文言 ${stateFindings.length} 件（その状態を決めている変数から導出してください）:\n`)
  for (const f of stateFindings) console.error(`  ${f.file}:${f.line}  [${f.hit}] ${f.text}`)
  console.error(`\n本当に静的な事実なら、その行か直前の行に state-ok と理由を書いてください。\n`)
}

if (findings.length) {
  console.error(`UI文言の直書き ${findings.length} 件（辞書 lib/i18n/*.ts を通してください）:\n`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.kind}] ${f.text.slice(0, 90)}`)
  console.error(`\n訳す対象でなければ、その行に i18n-ok とコメントを書いてください。`)
  process.exit(1)
}
// --- 他言語の文字が混ざっていないかの点検 -----------------------------------
// 9言語ぶんを機械的に流し込む作業では、コピー元の言語が数キーだけ残ることが
// 実際に起きた（韓国語の辞書に日本語の「埋め込み」が2キー残っていた 2026-07-29）。
// 文字体系は言語ごとに決まっているので、これは機械で見つけられる。
const SCRIPT_GUARD = [
  { re: /[ぁ-んァ-ヶ]/, name: 'かな', allow: ['ja'] },
  { re: /[가-힣]/, name: 'ハングル', allow: ['ko'] },
]
const dictFiles = execSync('git ls-files lib/i18n', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts') && !/\/(index|server|metadata)\.ts$/.test(f))
const mixed = []
for (const f of dictFiles) {
  const loc = f.replace('lib/i18n/', '').replace('.ts', '')
  const dictLines = readFileSync(f, 'utf8').split('\n')
  dictLines.forEach((raw, i) => {
    if (/^\s*\/\//.test(raw)) return // コメントでの説明は対象外
    // 英語の文が日本の法律名を原語で引くような、意図した混在は注記で外す
    if (annotated(dictLines, i, 'script-ok')) return
    for (const g of SCRIPT_GUARD) {
      if (g.allow.includes(loc)) continue
      if (g.re.test(raw)) mixed.push({ f, line: i + 1, name: g.name, text: raw.trim().slice(0, 70) })
    }
  })
}
if (mixed.length) {
  console.error(`辞書に他言語の文字が混ざっています ${mixed.length} 件:\n`)
  for (const m of mixed) console.error(`  ${m.f}:${m.line}  [${m.name}] ${m.text}`)
  console.error('')
  process.exit(1)
}

// --- 翻訳カバレッジ（ゲートではなく進捗の可視化） ---------------------------
// 英語以外の辞書は部分辞書で、欠けたキーは英語にフォールバックする
// （lib/i18n getDictionary）。何%訳せているかを毎回出しておかないと、
// 「英語のままなのは未訳なのか意図なのか」が誰にも分からなくなる。
// 数えるのは「文字列の値を持つキー」。行頭のインデントでは数えられない —
// 入れ子のグループを1行で書くと（`layout: { hall: '…', corridor: '…' },`）
// 中身が数から漏れ、逆にグループ見出し（`layout: {`）は1件と数えてしまう。
// 実際に ja が 98% と出て、翻訳漏れではなく計測の穴だった（2026-07-29）。
// 鍵は「行頭・{ ・, の直後」にしか現れない。この条件を付けないと、文字列の
// 値の中の `Live at:'` や `Unlock for a user:'` まで鍵として数えてしまい、
// 英語側の分母が水増しされる（実際に起きた 2026-07-29）。
const KEY_RE = /(^|[{,])\s*([a-zA-Z0-9_]+):\s*['"`]/gm
const leafKeys = (src) => {
  const body = src.replace(/^\s*\/\/.*$/gm, '')
  return [...body.matchAll(KEY_RE)].map((m) => m[2])
}
// 訳さないと決めたもの（DECISIONS 2026-07-29）。分母から外すので、
// 「全部訳し終わった」を 100% として読める。
const NOT_TRANSLATED = new Set([
  // 特商法の表記は日本語版が法的に効く版。単一URLで ja / en だけ持つ
  'heading', 'intro', 'rowService', 'rowOperator', 'rowAddress', 'valAddress',
  'rowPhone', 'valPhone', 'rowEmail', 'rowPrice', 'valPrice', 'rowExtra', 'valExtra',
  'rowPayMethod', 'valPayMethod', 'rowPayTiming', 'valPayTiming', 'rowDelivery',
  'valDelivery', 'rowReturns', 'valReturns', 'rowAge', 'valAge', 'rowSystem', 'valSystem',
  'valPriceFrames', // 同じ特商法ページの1文（有料の額縁が出たときだけ表示）
  'code', // notFound.code = '404'
  'legal', // footer.legal — 導線は locale === 'ja' のときだけ出す
])
const leafCount = (src) => leafKeys(src).filter((k) => !NOT_TRANSLATED.has(k)).length
const enLeaves = leafCount(readFileSync('lib/i18n/en.ts', 'utf8'))
const localeFiles = execSync('git ls-files lib/i18n', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts') && !/\/(index|server|metadata|en)\.ts$/.test(f))
const coverage = localeFiles
  .map((f) => {
    const name = f.replace('lib/i18n/', '').replace('.ts', '')
    const n = leafCount(readFileSync(f, 'utf8'))
    return { name, n, pct: Math.round((n / enLeaves) * 100) }
  })
  .sort((a, b) => b.n - a.n)

if (stateFindings.length) process.exit(1)
console.log(`UI文言の直書き: 0 件（${files.length} ファイルを検査）`)
console.log(`状態を語る対外文言: 0 件（${stateFiles.length} ファイルを検査）`)
console.log(`\n翻訳カバレッジ（英語 ${enLeaves} キーに対して。欠けた分は英語で表示される）:`)
for (const c of coverage) {
  const bar = '█'.repeat(Math.round(c.pct / 5)).padEnd(20, '·')
  console.log(`  ${c.name.padEnd(8)} ${bar} ${String(c.pct).padStart(3)}%  ${c.n}/${enLeaves}`)
}
