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
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

// URL.pathname はパーセントエンコードされる（パスに空白があると
// `with%20space` になり、番人スクリプトを見つけられない）。必ず変換して使う。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --- 合成リポジトリを作って番人を1本走らせる ------------------------------
// Ctrl-C では finally が走らないので、作った一時ディレクトリを覚えておいて
// 終了時とシグナル時にまとめて消す（一時gitリポジトリが残るのを防ぐ）。
const madeDirs = new Set()
const cleanAll = () => {
  for (const d of madeDirs) rmSync(d, { recursive: true, force: true })
  madeDirs.clear()
}
process.on('exit', cleanAll)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    cleanAll()
    process.exit(130)
  })
}

const run = ({ files, gate, add = true, setup }) => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  madeDirs.add(dir)
  try {
    // `-b main` は必須: 既定のブランチ名は git の設定次第（master のこともある）で、
    // check:ship-ready は origin/main と比べるので、ここが揺れるとケースが嘘になる。
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    // 番人が読む定型のファイル（基準線は空配列＝ラチェットの現在値）
    const base = { 'scripts/css-dead-baseline.json': '[]', ...files }
    for (const [rel, body] of Object.entries(base)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true })
      writeFileSync(join(dir, rel), body)
    }
    if (add) execFileSync('git', ['add', '-A'], { cwd: dir })
    // git の履歴/リモートまで作らないと試せない番人（check:ship-ready）用のフック。
    // 合成リポジトリの中だけで完結させる（ネットワークには出ない）。
    if (setup) setup(dir, (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' }))
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', gate)], {
      cwd: dir,
      encoding: 'utf8',
      // 本番の番人は CI/Vercel では自分を飛ばす。自己テストでその分岐に入ると
      // 「落ちるべき入力が通った」が全部見逃しになるので、明示的に外す。
      env: { ...process.env, CI: '', VERCEL: '', SKIP_SHIP_READY: '' },
    })
    // status が null なのはシグナルで死んだとき。番人の「検出」と区別する。
    return {
      code: r.status,
      signal: r.signal,
      error: r.error,
      out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    madeDirs.delete(dir)
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
// 合成リポジトリにも辞書を置く。check:i18n は末尾で翻訳カバレッジを出すために
// lib/i18n/en.ts を読む（2026-07-28 の多言語SEO で追加された）ので、en が無いと
// 番人が ENOENT で死ぬ。**この自己テストが導入初日に捕まえたのがこれ**で、
// 「番人に足された前提」が合成入力から漏れると誤って「誤検知」に見える。
// 葉キーの数え方（4スペース以上のインデント）に合わせた形で書く。
const DICT_EN = ['export const en = {', '  common: {', "    save: 'Save',", "    cancel: 'Cancel',", '  },', '}', ''].join('\n')
const DICT_JA = ['export const ja = {', '  common: {', "    save: '保存',", '  },', '}', ''].join('\n')
const DICTS = { 'lib/i18n/en.ts': DICT_EN, 'lib/i18n/ja.ts': DICT_JA }

gateCase('check:i18n — トップレベルの app/page.tsx も検査する（pathspec ** の穴）', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': 'export default function P() {\n  return <p>Your work, given the space it deserves.</p>\n}\n',
    ...DICTS,
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
    ...DICTS,
  },
  expectFail: true,
  contains: ['Upload a piece'],
})

gateCase('check:i18n — 状態を語る定型句を検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': "export default function P() {\n  return <p>{t('x')}</p>\n}\nconst note = 'Coming soon'\n",
    ...DICTS,
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
    ...DICTS,
  },
  expectFail: false,
})

gateCase('check:i18n — 未追跡のコードを見落とさず落ちる', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': 'export default function P() {\n  return <p>Your work, given the space it deserves.</p>\n}\n',
    ...DICTS,
  },
  add: false,
  expectFail: true,
  contains: ['未追跡'],
})

// --- ここから下は「過去に空いた穴」ではなく**ルール本体**を守るケース --------
// レビュー指摘（2026-07-28）: 導入時の10ケースは4つの歴史的な穴しか見ておらず、
// その穴が住んでいる検出ルール自体を消しても 10/10 緑のままだった。
// 「落ちない自己テスト」は無いより悪いので、各ルールに1ケースずつ足す。

gateCase('check:i18n — 目に入る属性（placeholder / aria-label）の直書きを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': [
      'export default function P() {',
      '  return (',
      '    <div>',
      '      <input placeholder="Search your exhibitions" />',
      '      <button aria-label="Close the panel" />',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Search your exhibitions', 'Close the panel'],
})

gateCase('check:i18n — 1語だけのラベル（>Add<）も検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // looksEnglish は「2語以上」を条件にしているので、ボタンやリンクの短い
    // ラベルが素通りしていた（SettingsPanel の "Add" を、9言語を42%まで訳した
    // 後で見つけた 2026-07-29）。ブランド名や略語は誤検知しないこと。
    'app/page.tsx': [
      'export default function P() {',
      '  return (',
      '    <div>',
      '      <button>Add</button>',
      '      <span>XIBIT360</span>',
      '      <span>PDF</span>',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Add'],
  notContains: ['XIBIT360', 'PDF'],
})

gateCase('check:i18n — タグをまたぐ（行が分かれた）JSXテキストを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': [
      'export default function P() {',
      '  return (',
      '    <p>',
      '      Upload a piece and give it a wall.',
      '    </p>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Upload a piece'],
})

// --- 複数形キーの対（2026-07-29 に足した番人） -------------------------------
// 発端: 8キーが `_other` だけを持ち、単数は素のキーに書かれていた。translate() が
// 素のキーより先に `_other` を見ていたため、英語で count=1 のとき「1 works」と
// 読める文が出ていた。**番人は1つもこれを見ていなかった**ので、対の有無を見る。
const PLURAL_DICT = (lines) => ['export const en = {', '  common: {', "    save: 'Save',", ...lines, '  },', '}', ''].join('\n')

gateCase('check:i18n — `_other` だけで相方の無いキーを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'lib/i18n/en.ts': PLURAL_DICT(["    works_other: '{count} works',"]),
    'lib/i18n/ja.ts': DICT_JA,
  },
  expectFail: true,
  contains: ['works_other'],
})

gateCase('check:i18n — `_one` だけで `_other` の無いキーを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'lib/i18n/en.ts': PLURAL_DICT(["    works_one: '{count} work',"]),
    'lib/i18n/ja.ts': DICT_JA,
  },
  expectFail: true,
  contains: ['works_one'],
})

gateCase('check:i18n — 対になっている複数形キーを誤検知しない（素のキー／_one の両方の書き方）', {
  gate: 'check-i18n.mjs',
  files: {
    // 値の中の `{count}` を波括弧として数えると階層がずれる。両方の書き方が
    // 同じファイルに混在していても通ること。
    'lib/i18n/en.ts': PLURAL_DICT([
      "    works: '{count} work',",
      "    works_other: '{count} works',",
      "    seats_one: '{count} seat',",
      "    seats_other: '{count} seats',",
    ]),
    'lib/i18n/ja.ts': DICT_JA,
  },
  expectFail: false,
})

gateCase('check:i18n — 複数行コメントの後ろでも行番号が合っている', {
  gate: 'check-i18n.mjs',
  files: {
    // コメントを1文字に潰すと、その後ろのキーの行番号が縮んで報告が嘘になる
    // （辞書は各グループの上に複数行の解説コメントを置く書き方をしている）。
    // 期待: `works_other` は8行目。合成コメントを日本語で書くと**他言語混入の番人が
    // 先に落ちる**（あちらはブロックコメントの中身を除外していない）ので英語で書く。
    'lib/i18n/en.ts': [
      'export const en = {', // 1
      '  /*', // 2
      '   * Why this group exists,', // 3
      '   * spelled out over several lines', // 4
      '   */', // 5
      '  common: {', // 6
      "    save: 'Save',", // 7
      "    works_other: '{count} works',", // 8
      '  },',
      '}',
      '',
    ].join('\n'),
    'lib/i18n/ja.ts': DICT_JA,
  },
  expectFail: true,
  contains: ['lib/i18n/en.ts:8'],
})

gateCase('check:i18n — 値の中の波括弧やコロンを階層／キーと読まない', {
  gate: 'check-i18n.mjs',
  files: {
    // 文言の値は波括弧やコロンを含む。これを構文として読むと階層がずれ、対に
    // なっているキーを「相方が無い」と誤検知して push が止まる。カバレッジ計測が
    // 値の中の `Live at:'` をキーと数えて分母を水増ししたのと同じ穴（2026-07-29）。
    'lib/i18n/en.ts': PLURAL_DICT([
      "    works: '{count} work',",
      "    tip: 'Type } to close the block',",
      "    works_other: '{count} works',",
      "    note: 'Shown as Live at: {time}',",
    ]),
    'lib/i18n/ja.ts': DICT_JA,
  },
  expectFail: false,
  notContains: ['works_other'],
})

gateCase('check:i18n — 別のグループの同名キーを相方と数えない（入れ子の道筋を見る）', {
  gate: 'check-i18n.mjs',
  files: {
    // `panel.works` は `artwork.works_other` の相方ではない。道筋を見ずに
    // キー名だけ集めると、この入力を取りこぼす。
    'lib/i18n/en.ts': [
      'export const en = {',
      '  artwork: {',
      "    works_other: '{count} works',",
      '  },',
      '  panel: {',
      "    works: '{count} work',",
      '  },',
      '}',
      '',
    ].join('\n'),
    'lib/i18n/ja.ts': DICT_JA,
  },
  expectFail: true,
  contains: ['artwork.works_other'],
})

gateCase('check:css — 複数行コメントの中のクラス名を誤検知しない', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    'app/t.css': ['/*', '.ghost-cls { color: red }', '#ghost-id { color: red }', '*/', '.live-cls { color: red }'].join('\n'),
  },
  expectFail: false,
  notReported: ['.ghost-cls', '#ghost-id'],
})

gateCase('check:css — 同じ行に前ルールの } が残っても16進カラーをIDと読まない', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    // 「宣言が行頭から始まり、その行で前のルールを閉じて次を開く」形でないと
    // 再現しない。1行に収めると split('{')[0] が最初の { より前を返すため
    // 16進カラーがそもそもセレクタ部分に入らず、変異させても落ちなかった。
    'app/t.css': ['.live-cls {', '  color: #ff0000; } #live-id { color: red }'].join('\n'),
  },
  expectFail: false,
  notReported: ['#ff0000', '#ff'],
})

gateCase('check:css — 死んだクラス（IDではない従来の検出）も引き続き検出する', {
  gate: 'check-css.mjs',
  files: {
    'components/P.tsx': LIVE_TSX,
    'app/t.css': '.ghost-cls { color: red }\n',
  },
  expectFail: true,
  reported: ['.ghost-cls'],
})

// -------------------------------------------------------------- check:ship-ready
// 並行セッション起因の手戻りを止める番人（/kaizen 昇格 2026-07-29、×6）。
// 合成リポジトリに「ローカルの origin」を作って、base が動いている状態などを再現する。
const shipRepo = (opts = {}) => (dir, git) => {
  git('config', 'user.email', 'gate@example.com')
  git('config', 'user.name', 'gate')
  git('commit', '-qm', 'base')
  // ベアリポジトリを origin にして push（ネットワークに出ずに remote-tracking を作る）。
  // **作業ツリーの外**に置く: 中に作ると未追跡ファイルとして番人に見え、
  // 「クリーンなら通す」の負の対照が自分の仕掛けのせいで落ちる（実際に踏んだ）。
  const remote = mkdtempSync(join(tmpdir(), 'gate-origin-'))
  madeDirs.add(remote)
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  git('remote', 'add', 'origin', remote)
  git('push', '-q', 'origin', 'main')
  if (opts.remoteAhead) {
    // origin だけを1コミット進める（= 別セッションが push した状態）
    git('commit', '-qm', 'theirs', '--allow-empty')
    git('push', '-q', 'origin', 'main')
    git('reset', '-q', '--hard', 'HEAD~1')
  }
  if (opts.dirty) writeFileSync(join(dir, 'app/dirty.tsx'), 'export const x = 1\n')
  if (opts.untracked) writeFileSync(join(dir, 'app/brand-new.tsx'), 'export const y = 2\n')
}

const SHIP_FILES = { 'app/page.tsx': 'export default function P() { return null }\n' }

gateCase('check:ship-ready — 早送り可能でクリーンなら通す（負の対照）', {
  gate: 'check-ship-ready.mjs',
  files: SHIP_FILES,
  setup: shipRepo(),
  expectFail: false,
  contains: ['push 前の確認: OK'],
})

gateCase('check:ship-ready — origin/main が進んでいたら止める（検証やり直しが必要）', {
  gate: 'check-ship-ready.mjs',
  files: SHIP_FILES,
  setup: shipRepo({ remoteAhead: true }),
  expectFail: true,
  contains: ['origin/main が進んでいます', 'rebase'],
})

gateCase('check:ship-ready — 未コミットの変更が残っていたら止める（別セッションの巻き込み）', {
  gate: 'check-ship-ready.mjs',
  files: SHIP_FILES,
  setup: shipRepo({ dirty: true }),
  expectFail: true,
  contains: ['未コミット'],
})

gateCase('check:ship-ready — 未追跡ファイルだけでも止める（検証対象から漏れる）', {
  gate: 'check-ship-ready.mjs',
  files: SHIP_FILES,
  setup: shipRepo({ untracked: true }),
  expectFail: true,
  contains: ['未コミット'],
})

// --------------------------------------------------------------------- 実行
let failed = 0
for (const c of cases) {
  const { code, out, signal, error } = run(c)
  const problems = []
  if (error) problems.push(`番人を起動できなかった: ${error.message}`)
  if (signal) problems.push(`番人がシグナル ${signal} で死んだ（検出ではない）`)
  const didFail = code !== 0
  if (c.expectFail && !didFail) problems.push('落ちるべき入力なのに通した（＝この穴が空いている）')
  if (!c.expectFail && didFail) problems.push('通るべき入力なのに落ちた（＝誤検知でpushが止まる）')
  for (const s of c.contains ?? []) if (!out.includes(s)) problems.push(`出力に「${s}」が無い`)
  // notContains は宣言だけされて一度も照合されていなかった（2026-07-29 に気づいた）。
  // 「誤検知しないこと」を書いたつもりのケースが黙って何も見ていない状態だった。
  for (const s of c.notContains ?? []) if (out.includes(s)) problems.push(`出力に「${s}」が出た（誤検知）`)
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
