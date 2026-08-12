// 「売っているものが全部、公開の価格表示に載っているか」を照合する番人。
//
// なぜ必要か: **同じ漏れが3回起きた**（docs/LESSONS「品質・レビュー（課金・法務）」）。
//   1. 2026-08-03 ビデオパス($20) — 出荷した日から特商法の価格表示に無く、本番で売れていた
//   2. 2026-08-09 部屋($25) — 同じ漏れ方をするところだった（別件の作業中に偶然気づいた）
//   3. 2026-08-12 合同展示($15〜$40) — 2026-08-10 から売れる状態で、開示に無かった
// 金額そのものは `lib/pricing` から導出しているので「**載っているものが正しい**」は
// 既に守られている。守られていなかったのは「**載るべきものが載っている**」で、これは
// 別問題。`check:i18n` は文言の直書きしか見ず、`check:expo` は会期と価格の一致しか
// 見ないので、どの番人の視界にも入っていなかった（3回とも人間の記憶で防げなかった）。
//
// 検査するのは3点（TSは実行しない。静的な文字列照合）:
//   1) `ONE_TIME_SKUS`（実際に決済できるSKUの許可リスト）の各SKUに、下の
//      `DISCLOSURE_TOKENS` の対応が**書かれているか**。**知らないSKUは通さず落とす** —
//      「知らないものは黙って素通り」にすると、新しいSKUがまさにこの穴から漏れる
//      （docs/LESSONS「縮退の入口は広く採らない」）。
//   2) その対応する識別子が、各**開示面**のコード（コメントを除く）に現れているか。
//   3) `ONE_TIME_SKUS` と `PRICE_USD_CENTS` の食い違い＝決済できるのに値段が無い／
//      値段が 0 円のまま決済できる、を検出する。
// ※他の番人にある未追跡ファイルのガードは、ここには要らない。あちらは対象を
//   `git ls-files` で集めるので新規ファイルがすり抜けるが、この番人は下の決まった
//   パスを `readFileSync` で直接読む（＝作業ツリーの今の中身をそのまま見る）。
import { readFileSync } from 'node:fs'

const PRICING = 'lib/pricing.ts'
const CHECKOUT = 'app/api/checkout/route.ts'

// 開示面。**特商法のページは法令で要る面**で、LPは「売り物が全部見えている」状態を
// 保つ面（ユーザー決定 2026-08-12・D-3）。どちらも欠けたら止める。
const SURFACES = [
  { file: 'app/legal/page.tsx', label: '特商法の価格表示（/legal）' },
  { file: 'app/page.tsx', label: 'LPの料金セクション' },
]

/**
 * SKU → その値段を開示面で名乗るために使われているべき識別子（どれか1つ現れればよい）。
 *
 * **新しいSKUを足したらここにも足す**。足し忘れるとこの番人が落ちる＝それが狙いで、
 * 「開示に載せたか」を人間が1度だけ必ず確認する関門になる。
 *
 * `expo_*` を3つ別々に書いてあるのは、開示側が `expoRunOptions()` から一覧を導出して
 * いる（＝会期を足せば自動で載る）にもかかわらず、あえて1行の追記を要求するため。
 * 導出が本当にその新しい会期を含むかは、機械には確かめられない。
 */
const DISCLOSURE_TOKENS = {
  capacity_addon: ['PRICE_SLOT', 'PRICE_PER_SLOT_CENTS'],
  room: ['PRICE_ROOM'],
  video_pass: ['PRICE_VIDEO_PASS'],
  // テーマ・間取り・額はどれも single_item。価格は種別ごとに幅で名乗る
  single_item: ['priceRangeLabel'],
  expo_7: ['expoPriceRangeLabel', 'expoRunOptions'],
  expo_14: ['expoPriceRangeLabel', 'expoRunOptions'],
  expo_30: ['expoPriceRangeLabel', 'expoRunOptions'],
}

/**
 * コメントを落とす。**コメントの中の言及を「開示した」と数えないため** — この
 * リポジトリの開示面には「`expo.payOption` を使い回すな」のような注意書きが実際に
 * あり、素朴に全文検索すると通ってしまう。
 * `//` は `https://` や `mailto://` を巻き込まないよう、直前が `:` `/` のときは残す。
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:/])\/\/[^\n]*/g, '$1')

/**
 * `import ... from '...'` を落とす。**import されているだけを「開示した」と
 * 数えないため** — 使う側を消して import だけ残った状態でこの番人が通ってしまうのを
 * 実測で確認した（tsconfig に `noUnusedLocals` が無いので tsc も黙る）。
 * 開示面に要るのは「値段を画面に出していること」なので、使用箇所だけを数える。
 */
const stripImports = (src) => src.replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')

/** 開示面のうち、実際に画面を組み立てているコードだけ。 */
const disclosureCode = (src) => stripImports(stripComments(src))

/** `NAME = { a: 1, b: 2 }` のキーと値を読む（値は数値だけ見る）。 */
function readNumberRecord(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!m) return null
  const out = new Map()
  for (const line of m[1].split('\n')) {
    const e = stripComments(line).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+)\s*,?/)
    if (e) out.set(e[1], Number(e[2]))
  }
  return out
}

/** `NAME: readonly Sku[] = ['a', 'b']` の文字列要素を読む。 */
function readStringList(src, name) {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`))
  if (!m) return null
  return [...stripComments(m[1]).matchAll(/'([^']+)'/g)].map((x) => x[1])
}

const pricingSrc = readFileSync(PRICING, 'utf8')
const checkoutSrc = readFileSync(CHECKOUT, 'utf8')

const prices = readNumberRecord(pricingSrc, 'PRICE_USD_CENTS')
const purchasable = readStringList(checkoutSrc, 'ONE_TIME_SKUS')

const problems = []
const head = (s) => {
  console.error(`\n${s}`)
}

// 読めなかったら「0件」と言わずに落ちる。**読めていないのに緑**が一番危ない
// （AGENTS.md 5.5「検出器が自分の検査範囲を取りこぼして 0 件が嘘になる」）。
if (!prices || prices.size === 0) {
  head(`${PRICING} から PRICE_USD_CENTS を読めませんでした。`)
  console.error('  この番人は静的に読むので、書式が変わったら合わせる必要があります。\n')
  process.exit(1)
}
if (!purchasable || purchasable.length === 0) {
  head(`${CHECKOUT} から ONE_TIME_SKUS を読めませんでした。`)
  console.error('  この番人は静的に読むので、書式が変わったら合わせる必要があります。\n')
  process.exit(1)
}

// --- 1) 決済できるSKUと値段表の食い違い -----------------------------------
for (const sku of purchasable) {
  if (!prices.has(sku)) {
    problems.push({
      kind: 'price-missing',
      sku,
      msg: `決済の許可リストにあるのに ${PRICING} の PRICE_USD_CENTS に値段がありません`,
    })
  } else if (prices.get(sku) <= 0) {
    problems.push({
      kind: 'price-zero',
      sku,
      msg: `値段が ${prices.get(sku)} のまま決済できます（0円の請求が立つ）`,
    })
  }
}

// --- 2) 開示の対応が書かれているか（知らないSKUは落とす）-------------------
const surfaceCode = SURFACES.map((s) => ({ ...s, code: disclosureCode(readFileSync(s.file, 'utf8')) }))

for (const sku of purchasable) {
  const tokens = DISCLOSURE_TOKENS[sku]
  if (!tokens) {
    problems.push({
      kind: 'unmapped',
      sku,
      msg: `開示の対応が ${'scripts/check-price-disclosure.mjs'} の DISCLOSURE_TOKENS にありません`,
    })
    continue
  }
  for (const s of surfaceCode) {
    if (!tokens.some((t) => s.code.includes(t))) {
      problems.push({
        kind: 'not-disclosed',
        sku,
        msg: `${s.label} に出ていません（${s.file} に ${tokens.join(' / ')} のいずれも無い）`,
      })
    }
  }
}

// --------------------------------------------------------------------- 報告
if (problems.length) {
  head(`売り物と価格表示の食い違いが ${problems.length} 件あります:\n`)
  for (const p of problems) console.error(`  ${p.sku}  ${p.msg}`)
  console.error(`
売っているのに開示に無い状態は、特商法の価格表示（/legal）では法令違反にあたります。
過去3回すべて「出荷したのに開示に足すのを忘れた」形でした（docs/LESSONS 参照）。

直し方:
  1. 値段は必ず lib/pricing から導出して開示面に差し込む（数字を直書きしない）
  2. 会期のように選択肢が増えうるものは一覧を関数から導出する
     （expoRunOptions() のように。決め打ちにすると次の1つが静かに漏れる）
  3. このスクリプトの DISCLOSURE_TOKENS にそのSKUの識別子を1行足す
`)
  process.exit(1)
}

console.log(
  `売り物と価格表示: 0 件（決済できる ${purchasable.length} SKU を ${SURFACES.length} つの開示面と照合／PRICE_USD_CENTS ${prices.size} 件）`,
)
