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
    if (!line.trim() || raw.includes('i18n-ok') || (lines[i - 1] ?? '').includes('i18n-ok')) return

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

if (findings.length) {
  console.error(`UI文言の直書き ${findings.length} 件（辞書 lib/i18n/*.ts を通してください）:\n`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.kind}] ${f.text.slice(0, 90)}`)
  console.error(`\n訳す対象でなければ、その行に i18n-ok とコメントを書いてください。`)
  process.exit(1)
}
console.log(`UI文言の直書き: 0 件（${files.length} ファイルを検査）`)
