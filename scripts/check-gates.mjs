// 番人の番人。check:css / check:i18n が「本当に検出しているか」を、合成した
// 入力を流して確認する（AGENTS.md 5.5 / DECISIONS 2026-07-28 で昇格）。
//
// なぜ必要か: 「守るための仕組み」を入れても、その仕組みが自分の検査範囲を
// 取りこぼしていれば 0 件は嘘になる。実際に×4起きている（LESSONS「検証・ツール」）:
//   1. `git ls-files "app/**/*.tsx"` の ** が app/page.tsx（LP本体）に当たらず
//      トップレベル20ファイルがまるごと検査対象外だった
//   2. `accept="image/*"` の `/*` をコメント開始と誤認し約270行が抜けた
//   3. 新規ファイルは `git add` するまで未追跡＝検査対象に存在しなかった
//   4. check:css がクラスセレクタしか見ておらず、ID セレクタ（#stage）と
//      カンマ区切りで複数行に分かれたセレクタの非最終行を検査していなかった
// どれも「合成入力を1本流せば即バレる」ものだった。だから機械にする。
//
// 各ケースは①番人が落ちること（＝検出）と②生きているものを誤検知しないこと
// （＝負の対照）の両方を見る。落ちるべきものが落ちなければ、ここが落ちる。
//
// 実行はリポジトリを汚さない: 一時ディレクトリに git repo を作り、そこを cwd に
// して本番の番人スクリプトをそのまま起動する（番人は git ls-files で対象を
// 集めるので、cwd を差し替えるだけで合成入力に向けられる）。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')

// --- 合成リポジトリを作って番人を1本走らせる ------------------------------
const run = ({ files, gate, add = true }) => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    // 番人が読む定型のファイル（基準線は空配列＝ラチェットの現在値）
    const base = { 'scripts/css-dead-baseline.json': '[]', ...files }
    for (const [rel, body] of Object.entries(base)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true })
      writeFileSync(join(dir, rel), body)
    }
    if (add) execFileSync('git', ['add', '-A'], { cwd: dir })
    const r = spawnSync('node', [join(ROOT, 'scripts', gate)], { cwd: dir, encoding: 'utf8' })
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// check:css の報告行（`  app/t.css:12  .foo   ← .foo, .bar {`）から、
// **報告されたセレクタ名だけ**を取り出す。出力全文で照合すると、`←` の後ろに
// エコーされる元セレクタに生きている名前が含まれるため「誤検知した」と
// 読み違える（この自己テストを書いたとき実際に踏んだ）。
const reportedNames = (out) =>
  out
    .split('\n')
    .map((l) => l.match(/^\s+\S+:\d+\s+(\S+)/))
    .filter(Boolean)
    .map((m) => m[1])

// 「この文字列が出ること」「この名前が報告される/されないこと」を確かめる
const cases = []
const gateCase = (name, spec) => cases.push({ name, ...spec })

// ---------------------------------------------------------------- check:css
// 生きているクラス/IDを持つマークアップ。負の対照はすべてここに含める。
const LIVE_TSX = `const PANEL_ID = 'expr-id'
export default function P() {
  return (
    <div className="live-cls" id="live-id">
      <span id={PANEL_ID} />
      <a href="#live-id">jump</a>
    </div>
  )
}
`

gateCase('check:css — 死んだIDセレクタを検出する（#stage の穴）', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    'app/t.css': '#ghost-id { color: red }\n.live-cls { color: red }\n',
  },
  expectFail: true,
  reported: ['#ghost-id'],
  notReported: ['.live-cls', '#live-id'],
})

gateCase('check:css — カンマ列挙の非最終行も検査する（クラス／ID両方）', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    'app/t.css': '#ghost-id,\n.ghost-cls,\n.live-cls { color: red }\n',
  },
  expectFail: true,
  reported: ['#ghost-id', '.ghost-cls'],
  notReported: ['.live-cls'],
})

gateCase('check:css — 生きているクラス/IDと属性セレクタを誤検知しない', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    // #expr-id は id={PANEL_ID} 経由。#live-id は id 属性と href="#live-id"。
    'app/t.css': ".live-cls { color: red }\n#live-id { color: red }\n#expr-id { color: red }\na[href^='#'] { color: red }\n",
  },
  expectFail: false,
  notReported: ['.live-cls', '#live-id', '#expr-id'],
})

gateCase('check:css — css-ok の例外注記が効く（複数行セレクタの上でも）', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    'app/t.css': '/* css-ok: 動的に組むので grep に出ない */\n#ghost-id,\n.ghost-cls { color: red }\n',
  },
  expectFail: false,
  notReported: ['#ghost-id', '.ghost-cls'],
})

gateCase('check:css — 未追跡のCSSを見落とさず落ちる（git add 前の新規ファイル）', {
  gate: 'check-css.mjs',
  files: { 'components/P.tsx': LIVE_TSX, 'app/t.css': '#ghost-id { color: red }\n' },
  add: false,
  expectFail: true,
  contains: ['未追跡'],
})

// --------------------------------------------------------------- check:i18n
const DICT = "export const ja = { a: 'あ' }\n"

gateCase('check:i18n — トップレベルの app/page.tsx も検査する（pathspec ** の穴）', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': 'export default function P() {\n  return <p>Your work, given the space it deserves.</p>\n}\n',
    'lib/i18n/ja.ts': DICT,
  },
  expectFail: true,
  contains: ['app/page.tsx'],
})

gateCase('check:i18n — accept="image/*" の後ろも検査する（コメント誤認の穴）', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': [
      'export default function P() {',
      '  return (',
      '    <div>',
      '      <input accept="image/*,video/mp4" />',
      '      <p>Upload a piece and give it a wall.</p>',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    'lib/i18n/ja.ts': DICT,
  },
  expectFail: true,
  contains: ['Upload a piece'],
})

gateCase('check:i18n — 状態を語る定型句を検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': "export default function P() {\n  return <p>{t('x')}</p>\n}\nconst note = 'Coming soon'\n",
    'lib/i18n/ja.ts': DICT,
  },
  expectFail: true,
  contains: ['Coming soon'],
})

gateCase('check:i18n — 辞書を通した文言と i18n-ok を誤検知しない', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': [
      'export default function P() {',
      '  return (',
      '    <div>',
      "      <p>{t('lp.title')}</p>",
      '      {/* i18n-ok: ブランド名 */}',
      '      <p>Xibit360</p>',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    'lib/i18n/ja.ts': DICT,
  },
  expectFail: false,
})

gateCase('check:i18n — 未追跡のコードを見落とさず落ちる', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': 'export default function P() {\n  return <p>Your work, given the space it deserves.</p>\n}\n',
    'lib/i18n/ja.ts': DICT,
  },
  add: false,
  expectFail: true,
  contains: ['未追跡'],
})

// --------------------------------------------------------------------- 実行
let failed = 0
for (const c of cases) {
  const { code, out } = run(c)
  const problems = []
  const didFail = code !== 0
  if (c.expectFail && !didFail) problems.push('落ちるべき入力なのに通した（＝この穴が空いている）')
  if (!c.expectFail && didFail) problems.push('通るべき入力なのに落ちた（＝誤検知でpushが止まる）')
  for (const s of c.contains ?? []) if (!out.includes(s)) problems.push(`出力に「${s}」が無い`)
  const names = reportedNames(out)
  for (const s of c.reported ?? []) if (!names.includes(s)) problems.push(`${s} が報告されていない（この穴が空いている）`)
  for (const s of c.notReported ?? []) if (names.includes(s)) problems.push(`${s} が報告された（誤検知）`)

  if (problems.length) {
    failed++
    console.error(`✕ ${c.name}`)
    for (const p of problems) console.error(`    ${p}`)
    console.error(`    exit=${code}\n${out.replace(/^/gm, '    | ')}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

if (failed) {
  console.error(`\n番人の自己テスト: ${failed} / ${cases.length} 件 失敗`)
  console.error('番人を変えたなら、その変更で検出できなくなった入力がここに出ています。')
  process.exit(1)
}
console.log(`\n番人の自己テスト: ${cases.length} 件すべて通過`)
