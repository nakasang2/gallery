// UI文言の直書き検出。「多言語対応は今後のUI変更でも必須」を人の記憶に頼らず
// 機械で守るための番人（DECISIONS 2026-07-28）。
//
// 完全な構文解析はしない。JSXのテキストと、来場者の目に入る4属性
// (placeholder / aria-label / title / alt) だけを見て、英語らしい文字列が
// 辞書を通っていなければ落とす。パーサ依存を増やさずCIでも動くよう正規表現で
// 済ませているが、以下は素朴な実装で取りこぼすので明示的に処理している:
//   - 複数行の /* */ コメント（状態を持って追跡する）
//   - {式} を含むJSXテキスト（`Width {…}m` のように、式を挟むと残る語が
//     1つだけになる形も文言として見る）
//   - タグをまたぐ複数行のJSXテキスト（タグも代入も無い「素の行」も見る）
//   - **{式} の中の文字列リテラル**（`{busy ? 'Uploading…' : 'Upload'}`）。
//     テキストだけを見ていた頃は、サインインした作家・管理者にだけ見える英語が
//     89箇所（44の文言）残っていた（2026-07-29）。詳しくは下の「式の中のリテラル」節。
//
// ▼ ここが見ていないもの（意図的な線引き。増やすときはこの一覧も直す）
//   - 関数呼び出しの引数（`run('Space change', …)` / `alert('…')`）。呼び名から
//     文言かどうかを決められず、`from('galleries').select('id, title')` のような
//     DBの列名やイベント名まで巻き込む。**代わりに、文言を受ける関数の引数は
//     `t()` を通した文字列で渡す**（`run(t('me.deleteGallery'), …)`）。
//   - モジュール直下の定数・配列（`const PANELS = [{ h: 'A solo show …' }]`）。
//     キー名 `label:` だけは例外的に見る（下のルール5）。LPの3D壁テクスチャの
//     ような「後で描画に回される定数」はここに入らない。
//   - `className` / `key` / `accept` / `href` などの属性と、その中の式。
//   - 三項・論理のオペランド位置にないリテラル。これは誤検知を止めるための線引き
//     （`.map(…)` の中のJSX属性や関数の引数を巻き込まない）だが、代わりに
//     `{(cond ? 'A' : 'B')}` のように括弧で囲んだものと、1行に収めた
//     `.map()` の中身は見えない。詳しくは下の isOperand。
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
  /^(XIBIT360|Xibit360|Stripe|Supabase|WebGL|Cloudflare|PDF|JPEG|MP4|GIF|BGM|SNS|URL|CSS|HTML|OK|No\.|[\d\s.,%/·—–→←✕×▲▼⋯©]+|[A-Za-z]{1,2})$/

// 1語ラベルの検出で、訳す対象でないもの（ブランド名・記号・単位・略語）
const ONE_WORD_OK = /^(XIBIT360|Xibit360|Stripe|Supabase|WebGL|Cloudflare|Instagram|Chrome|Edge|Safari|Firefox|PDF|JPEG|JPG|PNG|WebP|MP4|GIF|BGM|SNS|URL|CSS|HTML|Noir|Chic)$/

// 式を落とした跡に置く目印。判定の直前に空白へ戻すが、それまでは「ここに式が
// あった」ことを残す。空白で潰してしまうと `Width {…}m` が「1語＋単位」に見え、
// ただの識別子と区別できなくなる。
const PH = '\u0000'

const looksEnglish = (s, hadExpr = false) => {
  const t = s.split(PH).join(' ').trim()
  if (t.length < 3 || NOT_COPY.test(t)) return false
  // 式の断片（複数行にまたがる条件やテンプレート）は文言ではない。
  // t() を通っている行も、残りはブランド名などの地の文しかない。
  // 波括弧が残っていれば {式} が閉じ切っていない断片（正規表現に // が入る等で
  // 行が途中で切れたケース）。地の文にはまず出ない。
  if (/&&|\|\||\?\?|=>|\$\{|[{}]|\bt\('/.test(t)) return false
  if (!/[A-Za-z]/.test(t)) return false
  if (/[ぁ-んァ-ヶ一-龠]/.test(t)) return false // 日本語が混じるなら辞書側の値
  const words = t.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []
  if (words.length >= 2 || /[.?!:]$/.test(t)) return true
  if (words.length !== 1) return false
  // 語が1つだけの短いラベル。`Copied ✓` `Uploading…` `(untitled)` のように記号・
  // 三点リーダ・括弧が付くだけで素通りしていたので、飾りを落としてから1語かを見る
  // （SettingsPanel の "Add" を9言語42%まで訳した後に見つけた 2026-07-29。
  // 括弧付きは、式の中を見るようにした日に admin の '(untitled)' 2件で判明）。
  const w = t.replace(/^[\s·—–(（[]+/, '').replace(/[\s…✓.!?·—–)）\]]+$/, '')
  if (ONE_WORD_OK.test(w)) return false
  if (/^[A-Za-z][A-Za-z'’-]{2,19}$/.test(w)) return true
  // 「Width {…}m」「Buy {…}」型。プレースホルダを挟んだ結果1語になった文は、
  // 単位や記号が残るので上の1語判定には乗らない。式があったことを条件にする。
  return hadExpr && words[0].length >= 3
}

// {…} を目印に置き換える（ネストは1段だけ見れば足りる）
const stripExpr = (s) => s.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, PH)
// テンプレート文字列の ${…}。中身は式なので文言ではない
const stripTemplate = (s) => s.replace(/\$\{[^}]*\}/g, PH)

// 行を1回だけ走査して「文字列リテラルの位置」「括弧の深さ」「伏せ字」を得る。
// 伏せ字はコメント境界を探す前に必ず通す: `accept="image/*,video/mp4"` の `/*` を
// ブロックコメントの開始と誤認すると、そこから `*/` が現れるまで数百行がまるごと
// 検査対象から抜け落ちる（実際に SettingsPanel.tsx で起き、英語の直書き2件を
// 見逃していた 2026-07-28）。位置がずれないよう長さを保ち、判定は伏せ字側・
// 切り出しは元の行から行う。
// 閉じないクォート（`// don't` のような地の文）は行末まで飲み込むと本物の
// コメント境界を消してしまうので、リテラルと見なさず捨てる。
const scanLine = (line) => {
  const lits = []
  const depth = new Array(line.length).fill(0)
  let mask = ''
  let d = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < line.length && line[j] !== c) {
        if (line[j] === '\\') j++
        j++
      }
      if (j >= line.length) {
        // 閉じていない。ただの文字として扱う
        depth[i] = d
        mask += c
        continue
      }
      lits.push({ start: i, end: j, value: line.slice(i + 1, j) })
      for (let k = i; k <= j; k++) depth[k] = d
      mask += c.repeat(j - i + 1)
      i = j
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth[i] = d
      d++
    } else if (c === ')' || c === ']' || c === '}') {
      d--
      depth[i] = d
    } else {
      depth[i] = d
    }
    mask += c
  }
  return { lits, depth, mask }
}

const maskStrings = (s) => scanLine(s).mask

// --- 式の中のリテラル -------------------------------------------------------
// 「JSXの子として置かれた {式}」と「目に入る4属性の {式}」の中だけを見る。
// さらに、**三項・論理演算のオペランド位置**（`? 'A' : 'B'` / `x || 'A'` /
// 式そのもの）にあるリテラルに限る。これが誤検知を止めている唯一の要で、
// `{error && <p className="auth-error">…}` のクラス名や
// `{state === 'saving' && …}` の比較値、`fmt(d, 'en-US')` の引数は
// すべて「オペランドではない」側に落ちる（この絞り込みが無いと候補は1951件、
// 入れた後は実際の直書きだけ84件になった 2026-07-29）。
//
// 逆に、この形しか見ないので `{(cond ? 'A' : 'B')}` のように括弧で囲んだもの、
// `.map()` の中で1行に収めたものは見えない（上の「見ていないもの」参照）。
const VISIBLE_ATTR = /\b(placeholder|aria-label|title|alt)=$/
const exprRegions = (line, depth, inElement) => {
  const regions = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '{' || depth[i] !== 0) continue
    let j = i + 1
    while (j < line.length && !(line[j] === '}' && depth[j] === 0)) j++
    // この `{` より前は（深さ0なので）波括弧が閉じ切っている。中の式を潰してから
    // 見ることで、`{a >= 0 ? …}{b}` のように式の中の `>` に惑わされずに済む。
    const head = stripExpr(line.slice(0, i)).split(PH).join(' ')
    let kind = null
    if (VISIBLE_ATTR.test(line.slice(0, i))) kind = 'attr'
    // タグの直後（`<>{…}` `</div>{…}` `<br />{…}` も含む）。除けるのは `=>` だけ
    else if (/[^=]>\s*$/.test(head)) kind = 'child'
    // 同じ行でタグが開いていて、そのあと `<` が来ていない＝要素の中身にいる
    // （`<span>Spot {n}` 型）。`<Tag …>` から数えるので、比較演算子の
    // `a > 0 ? {…}` を子と読むことはない
    else if (/<[A-Za-z][^<>]*[^=]>[^<>]*$/.test(head)) kind = 'child'
    // タグは前の行で開いている（prev で判定）。この行にタグは出てきていない
    else if (inElement && !/[<>]/.test(head)) kind = 'child'
    if (kind) regions.push({ start: i, end: j, kind })
    i = j
  }
  return regions
}

// リテラルが三項・論理のオペランド位置にあるか（前後の非空白トークンで見る）
const isOperand = (line, lit, r) => {
  let p = lit.start - 1
  while (p > r.start && /\s/.test(line[p])) p--
  let q = lit.end + 1
  while (q < r.end && /\s/.test(line[q])) q++
  const pre = p === r.start ? '{' : line.slice(Math.max(0, p - 1), p + 1)
  // `}` は「式の終わり」だけを許す。オブジェクトを閉じる `}` まで許すと
  // `title={f(x, { month: 'short' })}` の Intl のオプション値を文言と読む
  const post = q === r.end ? '}' : line.slice(q, q + 2)
  return (pre === '{' || /(\?|:|\|\||\?\?|&&)$/.test(pre)) && (post === '}' || /^(\?|:|\|\||\?\?|&&)/.test(post))
}

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

    // 同じ文言が別のルールにも当たることがある（属性の中のテキストなど）。
    // 報告は1行1件にまとめる
    const report = (kind, raw) => {
      const text = raw.split(PH).join('{…}').trim()
      if (findings.some((f) => f.file === file && f.line === i + 1 && f.text === text)) return
      findings.push({ file, line: i + 1, kind, text })
    }

    // 1) 目に入る属性の直書き
    for (const m of line.matchAll(/\b(placeholder|aria-label|title|alt)=(?:"([^"]*)"|'([^']*)')/g)) {
      const v = stripExpr(m[2] ?? m[3] ?? '')
      if (looksEnglish(v, v.includes(PH))) report(m[1], v)
    }

    const stripped = stripExpr(line)

    // 2) 同じ行に閉じているJSXテキスト。直前が `=>` の `>` は JSXの開きタグでは
    //    なくアロー関数で、`() => Promise<void>` の "Promise" を文言と読んでしまう
    //    （1語ラベルを見るようにしてから出た誤検知 2026-07-29）。
    for (const m of stripped.matchAll(/(^|[^=])>([^<>\n]+)</g)) {
      if (looksEnglish(m[2], m[2].includes(PH))) report('text', m[2])
    }

    // ※ 1語だけのラベル（`>Add<`）は looksEnglish 側で見る。導入時は「2語以上」を
    //    条件にしていたため、ボタンやリンクの短いラベルがまるごと素通りしていた
    //    （SettingsPanel の "Add" を42%まで訳した後で見つけた 2026-07-29）。

    // 2b) 同じ行で閉じない（次の行へ続く）JSXテキスト。ルール2は `>text<` の形しか
    //     見ず、ルール3は「タグの無い素の行」しか見ないので、**タグや式と同じ行に
    //     始まって行末まで続く地の文**がどちらにも当たらず素通りしていた
    //     （`</b> — pick the room you’ll start from.` と
    //     `{TEMPLATES[id]?.label} is premium <LockIcon />` の2件。新規作家が最初に
    //     見る「最初の部屋を選ぶ」カードで、ユーザー指摘 2026-07-29）。
    //
    //     JSXのタグがある行に限り、`>` または式の跡から始まって `<` か行末で終わる
    //     区間を見る。式の跡から始まる形を見るのが要点で、`{式} text` はルール2の
    //     `>` を持たない。アロー関数の `=>` はここでは除いていない（除いても実
    //     リポジトリの結果は変わらず＝守れているものが無い。`() => <p>…` の `>` の
    //     直後は空文字で、そもそも区間にならない）。
    //
    //     誤検知を止めているのは2つの絞り込みで、**どちらも単独で効いている**
    //     （片方を消せば `check:gates` が落ちることを変異テストで確かめてある）:
    //     ①**型引数はタグと数えない** — `<` の直前が識別子の文字なら型引数
    //     （`useState<Foo | null>` `Promise<void>` `ComponentProps<typeof Link>`）。
    //     これを入れないと `useState<Foo | null>(null)` の `(null)` を1語ラベルとして
    //     報告した（この節を書いた直後に37件出た）。JSXのタグの `<` は行頭・空白・
    //     `(`・`{`・`>`・`,` の後に来る。
    //     ②**文字列リテラルの中身は見ない** — 判定は伏せ字側（`mask`）で行う。JSXの
    //     地の文はクォートの中に無いので失うものが無く、代わりにシェーダのソース
    //     （`Dust.tsx` のGLSL）やテンプレート文字列の中の正規表現を読まなくなる。
    //
    //     「2語以上に限る」も一度入れたが**外した**: ①があれば実リポジトリの誤検知は
    //     0件のままで（外して測った）、代わりに `</span> total` のような1語の
    //     ラベルまで見えなくなる。効いていない絞り込みは、変異テストでも
    //     「消しても落ちない」＝守れているものが無いと出る。
    const TAGGISH = new RegExp(`(^|[^A-Za-z0-9_$.])<\\/?[A-Za-z][^<>${PH}]*\\/?>`)
    const strippedMask = stripExpr(mask)
    if (TAGGISH.test(strippedMask)) {
      for (const m of strippedMask.matchAll(new RegExp(`(?:>|${PH})([^<>${PH}\\n]+)(?=<|$)`, 'g'))) {
        if (looksEnglish(m[1])) report('text', m[1])
      }
    }

    // 3) タグをまたぐJSXテキスト。「素の行」だけを見ると import 一覧や
    //    オブジェクトリテラルまで拾ってしまうので、直前の行がJSXの開きタグで
    //    終わっている（= 要素の中身にいる）ことを条件にする。
    //    コードらしさは記号の有無では判定できない（"Videos (reels etc.) …" のように
    //    地の文にも括弧やセミコロンは出る）。構文の形で弾く。
    const bareRaw = stripped.trim()
    // 構文の形を見る前に目印を空白へ戻す。trim() は目印（制御文字）を落とさないので
    // 戻したあとに trim し直す — これを忘れると「式だけの行」が空文字にならず、
    // prev（要素の中にいるか）を上書きして次の行が検査から外れる
    const bare = bareRaw.split(PH).join(' ').trim()
    // 前の行が開きタグの終わりか。ここで除けるのは `=>`（アロー関数）だけ:
    //   - `>` だけの行（複数行に分けて書いたタグの最後）を数えないと、その中身が
    //     丸ごと検査から外れる（`{embedCopied ? 'Copied ✓' : …}` を見逃していた）
    //   - `<br />` の直後にもテキストは続く（案内文1件を見逃していた）
    // どちらも 2026-07-29 に、式の中を見るようにして初めて見つかった。
    const inElement = /(^|[^=])>\s*$/.test(prev)
    const codeish = /[<>]|=>|^[\w.$[\]]+\s*[:=]|[,({=]\s*$|^[.[]|\b(await|typeof|new|function)\b/
    if (inElement && !codeish.test(bare)) {
      if (looksEnglish(bareRaw, bareRaw.includes(PH))) report('text', bareRaw)
    }

    // 4) JSXの子／目に入る属性に置かれた {式} の中の文字列リテラル。
    //    `{busy ? 'Uploading…' : 'Upload avatar'}` のような三項が、テキストでも
    //    属性の直書きでもないため丸ごと素通りしていた（2026-07-29）。
    const { lits, depth } = scanLine(line)
    for (const r of exprRegions(line, depth, inElement)) {
      for (const lit of lits) {
        if (lit.start < r.start || lit.end > r.end) continue
        if (!isOperand(line, lit, r)) continue
        const v = stripTemplate(lit.value)
        if (looksEnglish(v, v.includes(PH))) report(r.kind === 'attr' ? 'attr式' : '子式', v)
      }
    }

    // 5) UIラベルを持つオブジェクトのキー。定数や配列の中まで全部見ると DBの列名や
    //    設定値を巻き込むので、実際にUIへ渡っているキー名だけを見る
    //    （`setPurchaseItem({ …, label: 'Add work slots' })` が購入モーダルの
    //    見出しになっていた 2026-07-29）。
    for (const m of line.matchAll(/(?:^|[{,(])\s*(label):\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) {
      const v = stripTemplate(m[2] ?? m[3] ?? m[4] ?? '')
      if (looksEnglish(v, v.includes(PH))) report(m[1], v)
    }

    prev = bare || prev
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

// --- 複数形キーの対の点検 ---------------------------------------------------
// 単数の書き方が2通り混在している: 素のキーに単数を書いて複数だけ接尾辞を付ける形
// （`resetPerWork` / `resetPerWork_other`）と、両方に付ける形（`walkThrough_one` /
// `walkThrough_other`）。translate() はどちらも読めるが、**片方しか無いキーは必ず
// 嘘をつく** — 相方が無ければ英語（＝別の言語）か違う数の文に落ちるしかない。
// 実際に8キーが `_other` だけを持ち、英語で count=1 のとき「1 works」と読める文が
// 出ていた（2026-07-29）。対が揃っているかは機械で見られるので機械に見せる。
//
// 数え方は check:i18n のカバレッジと違って**入れ子の道筋まで見る**。`artwork.foo_other`
// の相方は `artwork.foo` であって、別のグループの同名 `panel.foo` ではない。
// 辞書の葉を「入れ子の道筋 → 値」で拾う。`pluralKeys` と同じ走査だが値も持つ
// （プレースホルダの点検に使う）。伏せ字は長さを保つので、`body` で見つけた位置は
// そのまま `src` の位置として使える。
const leafValues = (src) => {
  const body = maskStrings(src)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
  const TOKEN = /([a-zA-Z0-9_]+)\s*:\s*\{|([a-zA-Z0-9_]+)\s*:\s*(['"`])|\{|\}/g
  const stack = []
  const found = new Map()
  for (const m of body.matchAll(TOKEN)) {
    if (m[1]) stack.push(m[1])
    else if (m[2]) {
      const q = m.index + m[0].length - 1 // 開きクォートの位置
      let j = q + 1
      while (j < src.length && src[j] !== m[3]) {
        if (src[j] === '\\') j++
        j++
      }
      const path = [...stack, m[2]].filter(Boolean).join('.')
      if (!found.has(path)) found.set(path, { value: src.slice(q + 1, j), at: q })
    } else if (m[0] === '{') stack.push(null)
    else stack.pop()
  }
  return found
}

const pluralKeys = (src) => {
  // 文字列の中の { } を波括弧として数えないよう伏せ字にしてからコメントを落とす
  // （値には `{count} works` のように波括弧が入る）。**長さと行数は保つ** —
  // 複数行コメントを1文字に潰すと、その後ろのキーの行番号がずれて報告が嘘になる。
  const body = maskStrings(src)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
  // 並び順が意味を持つので1本の正規表現で順に拾う。グループ開き → 葉 → 素の波括弧。
  const TOKEN = /([a-zA-Z0-9_]+)\s*:\s*\{|([a-zA-Z0-9_]+)\s*:\s*['"`]|\{|\}/g
  const stack = []
  const found = new Map()
  for (const m of body.matchAll(TOKEN)) {
    if (m[1]) stack.push(m[1])
    else if (m[2]) {
      const path = [...stack, m[2]].filter(Boolean).join('.')
      // 行番号は「報告するとき」だけ数える（全キーで文字列を切り出すと、
      // 11辞書 × 約700キー ぶんのコピーが走る）。
      if (!found.has(path)) found.set(path, m.index)
      // `export const en = {` のような「キーを持たない波括弧」。`{` と `}` の数を
      // 釣り合わせるためだけに積む（道筋には出ない＝上の filter(Boolean)）。
      // **現在の辞書はどれもキー付きの波括弧しか持たないので、この行を消しても
      // check:gates は落ちない**（変異テストで確認）。将来キー無しの波括弧が入った
      // ときに道筋がずれないための備えなので、死んだコードと見て消さないこと。
    } else if (m[0] === '{') stack.push(null)
    else stack.pop()
  }
  return found
}

const pairIssues = []
for (const f of dictFiles) {
  const src = readFileSync(f, 'utf8')
  const keys = pluralKeys(src)
  const lineOf = (at) => src.slice(0, at).split('\n').length
  for (const [k, at] of keys) {
    if (k.endsWith('_other')) {
      const stem = k.slice(0, -'_other'.length)
      const bare = stem.split('.').pop()
      if (!keys.has(stem) && !keys.has(`${stem}_one`)) {
        pairIssues.push({ f, line: lineOf(at), key: k, want: `${bare}（単数）か ${bare}_one` })
      }
    } else if (k.endsWith('_one')) {
      const stem = k.slice(0, -'_one'.length)
      if (!keys.has(`${stem}_other`)) {
        pairIssues.push({ f, line: lineOf(at), key: k, want: `${stem.split('.').pop()}_other` })
      }
    }
  }
}
if (pairIssues.length) {
  console.error(`複数形キーの相方が無いもの ${pairIssues.length} 件（count=1 と 2 以上で別の文が要ります）:\n`)
  for (const p of pairIssues) console.error(`  ${p.f}:${p.line}  ${p.key} → ${p.want} が無い`)
  console.error('\n単数は素のキーでも `_one` でも構いませんが、必ず対で書いてください。\n')
  process.exit(1)
}

// --- プレースホルダの取り違えの点検 -----------------------------------------
// 値に差し込む位置（`{email}` `{count}` `{max}`）は、訳文が持っていなければ
// **その値が文から消える**。`translate()` は渡されなかった名前をそのまま残すので
// 綴り違い（`{mail}`）なら画面に `{mail}` と出るが、名前ごと落ちている訳文は
// 静かに情報だけを失う（アドレスが出ない「リンクを送りました」）。
// 太字などを差し込む `TextWithSlot`（components/I18nProvider）は、訳文にその
// プレースホルダがあることを前提に文を割るので、ここが崩れると前半だけになる。
// 英語を基準に、同じキーを持つ訳文のプレースホルダ集合が一致するかを見る。
const phSet = (s) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join(' ')
const enLeaves2 = leafValues(readFileSync('lib/i18n/en.ts', 'utf8'))
const phIssues = []
for (const f of dictFiles) {
  if (f.endsWith('/en.ts')) continue
  const src = readFileSync(f, 'utf8')
  const lineOf = (at) => src.slice(0, at).split('\n').length
  for (const [key, { value, at }] of leafValues(src)) {
    const en = enLeaves2.get(key)
    if (!en) continue // 英語に無いキー（訳文だけの残骸）はカバレッジ側の話
    const want = phSet(en.value)
    const got = phSet(value)
    if (want !== got) phIssues.push({ f, line: lineOf(at), key, want, got })
  }
}
if (phIssues.length) {
  console.error(`プレースホルダが英語と違うもの ${phIssues.length} 件（差し込む値が文から消えます）:\n`)
  for (const p of phIssues) {
    console.error(`  ${p.f}:${p.line}  ${p.key}  英語: ${p.want || '(なし)'} → こちら: ${p.got || '(なし)'}`)
  }
  console.error('\n訳し方で語順は変えて構いませんが、{…} は英語と同じ名前を同じ数だけ残してください。\n')
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
  // 同じ特商法ページの合同展示の開示（1文＋一覧の1行＋区切り）。**キー名は節が分かる
  // 形にする** — ここは葉のキー名だけで照合するので、`listSep` のような一般名を入れると
  // 将来ほかの節に同名のキーが出たとき、それも黙って分母から外れる（レビュー指摘）。
  'valPriceExpo', 'valPriceExpoItem', 'valPriceListSep',
  // 同じ特商法ページの著作権通知の受取先（DMCA指定代理人。D-4 2026-08-12）
  'rowDmcaAgent', 'valDmcaAgent',
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

/* ======== 呼ばれていないキー（/kaizen 2026-08-14 で追加） ========
 *
 * **文言を画面から撤去したのに、辞書のキーだけ残る**を機械で止める。`check:css`
 * （CSSがあってマークアップが無い）と同じ形で、基準線から**減らす方向にしか変えない**。
 *
 * なぜ要るか: 2026-08-14 の1セッションだけで**i18nキー12個とエクスポート3つ**が
 * 呼び手ゼロになり、**全部が人（別視点レビュー）に拾われた** ── 番人は1つも止めて
 * いない。溜まった分を測ったら 34 件あった。残っていても画面は壊れないが、辞書は
 * 11言語ぶんあるので、**次に訳す人が「もう誰も呼ばない文」を訳すことになる**。
 *
 * 誤検出への手当て（測って必要だと分かった3つだけ）:
 *   ①複数形（`_one` / `_other` …）は、コードが**基底のキー**を呼ぶ
 *   ②`t(`presets.layout.${key}`)` のように**組み立てる**キーは、接頭辞で呼ばれる
 *   ③辞書そのもの（`lib/i18n/*`）は探索対象から外す（定義が「呼び出し」に見える）
 */
const ORPHAN_BASELINE = new Set(
  JSON.parse(readFileSync('scripts/i18n-orphan-baseline.json', 'utf8'))
)
const callerFiles = execSync("git ls-files '*.ts' '*.tsx'", { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('lib/i18n/'))
const callerSrc = callerFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const isCalled = (k) =>
  callerSrc.includes(`'${k}'`) || callerSrc.includes(`"${k}"`) || callerSrc.includes(`\`${k}\``)
const PLURAL = /_(zero|one|two|few|many|other)$/
const orphans = [...enLeaves2.keys()].filter((k) => {
  if (isCalled(k)) return false
  const base = k.replace(PLURAL, '')
  if (base !== k && isCalled(base)) return false // ①
  // ② 組み立てるキー: **祖先のどれかが** `t(`presets.layout.${x}`)` の形で呼ばれていれば
  //    その下の葉は全部使われている（葉そのものは一度もソースに現れない）。
  const parts = k.split('.')
  for (let n = 1; n < parts.length; n++) {
    if (callerSrc.includes('`' + parts.slice(0, n).join('.') + '.${')) return false
  }
  return true
})
const newOrphans = orphans.filter((k) => !ORPHAN_BASELINE.has(k))
if (newOrphans.length) {
  console.error(`\n呼ばれていない辞書のキー ${newOrphans.length} 件（画面から撤去したのに辞書に残っています）:\n`)
  for (const k of newOrphans) console.error(`  ${k}`)
  console.error('\n消すか、組み立てて呼ぶなら scripts/i18n-orphan-baseline.json に理由付きで足してください。')
  console.error('※基準線は**減らす方向にしか変えない**（check:css と同じ作法）。')
  process.exit(1)
}

if (stateFindings.length) process.exit(1)
console.log(`UI文言の直書き: 0 件（${files.length} ファイルを検査）`)
console.log(`状態を語る対外文言: 0 件（${stateFiles.length} ファイルを検査）`)
console.log(`複数形キーの相方が無いもの: 0 件（${dictFiles.length} 辞書を検査）`)
console.log(`プレースホルダの取り違え: 0 件（英語の ${enLeaves2.size} キーと照合）`)
console.log(`呼ばれていない辞書のキー: 新規 0 件（基準線 ${ORPHAN_BASELINE.size} 件・現在 ${orphans.length} 件）`)
console.log(`\n翻訳カバレッジ（英語 ${enLeaves} キーに対して。欠けた分は英語で表示される）:`)
for (const c of coverage) {
  const bar = '█'.repeat(Math.round(c.pct / 5)).padEnd(20, '·')
  console.log(`  ${c.name.padEnd(8)} ${bar} ${String(c.pct).padStart(3)}%  ${c.n}/${enLeaves}`)
}
