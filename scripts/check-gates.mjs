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

gateCase('check:i18n — 訳文でプレースホルダが落ちているのを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // 訳文が `{email}` を持たないと、差し込むはずの値が文から消える（アドレスの
    // 出ない「リンクを送りました」）。太字を差し込む TextWithSlot はこの
    // プレースホルダで文を割るので、前半だけになる。
    'lib/i18n/en.ts': ['export const en = {', '  auth: {', "    sent: 'A link is on its way to {email}.',", '  },', '}', ''].join('\n'),
    'lib/i18n/ja.ts': ['export const ja = {', '  auth: {', "    sent: 'リンクを送りました。',", '  },', '}', ''].join('\n'),
  },
  expectFail: true,
  contains: ['{email}', 'auth.sent'],
})

gateCase('check:i18n — 語順が違うだけの訳文は誤検知しない（プレースホルダの点検）', {
  gate: 'check-i18n.mjs',
  files: {
    // 位置は言語が決めてよい。数と名前が同じなら通る。英語に無いキー（訳文だけの
    // 残骸）も、ここでは無視する（負の対照）
    'lib/i18n/en.ts': ['export const en = {', '  auth: {', "    sent: 'A link is on its way to {email}.',", '  },', '}', ''].join('\n'),
    // 残骸のキーには**プレースホルダを持たせてある** — 英語に無いキーを照合して
    // しまうと「英語は(なし)なのにこちらは {count}」と誤検知する形にしておく
    'lib/i18n/ja.ts': ['export const ja = {', '  auth: {', "    sent: '{email} にリンクを送りました。',", "    onlyHere: '{count} 件（訳文だけにあるキー）',", '  },', '}', ''].join('\n'),
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

// --- {式} の中のリテラル（2026-07-29 に足したルール） ----------------------
// テキストと属性の直書きだけを見ていた頃、`{busy ? 'Uploading…' : 'Upload'}` の形が
// まるごと素通りし、サインインした作家・管理者にだけ見える英語が30箇所以上
// 残っていた。**誤検知させないための線引き**（相対深さ0・三項/論理のオペランド
// 位置・JSXの子か目に入る属性だけ）も、ここで負の対照として押さえる。

gateCase('check:i18n — JSXの子に置いた {式} の中のリテラルを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': [
      'export default function P({ busy }: { busy: boolean }) {',
      '  return (',
      '    <div>',
      '      <button>',
      "        {busy ? 'Uploading…' : 'Upload avatar'}",
      '      </button>',
      "      <b>{name || 'Anonymous'}</b>",
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Uploading…', 'Upload avatar', 'Anonymous'],
})

gateCase('check:i18n — 目に入る属性の {式} の中のリテラルを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // className の三項は文言ではない（負の対照）。見るのは目に入る4属性だけ
    'app/page.tsx': [
      'export default function P({ framed }: { framed: boolean }) {',
      '  return (',
      "    <label className={framed ? 'is-framed' : 'is-bare'} title={framed ? 'Framed' : 'No frame'}>",
      "      {t('design.frame')}",
      '    </label>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Framed', 'No frame'],
  notContains: ['is-framed', 'is-bare'],
})

gateCase('check:i18n — テンプレート文字列の地の文を検出し、${…} だけの行は見逃す', {
  gate: 'check-i18n.mjs',
  files: {
    'app/page.tsx': [
      'export default function P({ art }: { art: { title: string; artist: string } }) {',
      '  return (',
      '    <div>',
      '      <button aria-label={`Move ${art.title} up`} />',
      '      <img alt={`${art.title} — ${art.artist}`} />',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Move {…} up'],
  // 中身が式と記号だけの文字列は文言ではない。ここが落ちると作品タイトルの
  // 組み立てを毎回 i18n-ok で黙らせることになる
  notContains: ['{…} — {…}'],
})

gateCase('check:i18n — プレースホルダを挟んで1語になるJSXテキストを検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // `Width {…}m` は「2語以上」でも「1語だけ」でもないので、どちらの条件にも
    // 引っかからず素通りしていた（スライダーの見出し 2026-07-29）
    'app/page.tsx': [
      'export default function P({ n, i, total }: { n: number; i: number; total: number }) {',
      '  return (',
      '    <div>',
      '      <span>Width {n}m</span>',
      '      <span>{i}/{total}</span>',
      '      <span>{n} · XIBIT360</span>',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Width'],
  notContains: ['XIBIT360'],
})

gateCase('check:i18n — UIラベルのオブジェクトキー（label:）を検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // 購入モーダルの見出しが `label:` 経由で渡されていた。同じ行の `kind:` /
    // `key:` は内部の識別子なので見ない（負の対照）
    'app/page.tsx': [
      'export default function P({ open }: { open: (x: unknown) => void }) {',
      '  return (',
      "    <button onClick={() => open({ kind: 'capacity', key: 'work-slots', label: 'Add work slots' })}>",
      "      {t('common.add')}",
      '    </button>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Add work slots'],
  notContains: ['work-slots'],
})

gateCase('check:i18n — 開きタグの `>` が単独行でも中身を検査する', {
  gate: 'check-i18n.mjs',
  files: {
    // 属性を複数行に分けて書くと最後が `>` だけの行になる。ここを「要素の中」と
    // 数えないと、その中身が丸ごと検査から外れる（埋め込みコードのボタン 2026-07-29）
    'app/page.tsx': [
      'export default function P({ copied }: { copied: boolean }) {',
      '  return (',
      '    <button',
      '      type="button"',
      '      disabled={copied}',
      '    >',
      "      {copied ? 'Copied ✓' : 'Copy embed code'}",
      '    </button>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Copy embed code'],
})

gateCase('check:i18n — タグや式と同じ行に始まり、行末まで続く地の文を検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // ルール2は `>text<`、ルール3は「タグの無い素の行」しか見ないので、**同じ行に
    // タグや式があり、地の文が行末まで続く**形がどちらにも当たらず素通りしていた。
    // 新規作家が最初に見る「最初の部屋を選ぶ」カードで2件（ユーザー指摘 2026-07-29）。
    // 2行目は「式の直後」で、`>` を持たないためルール2では拾えない形。
    // 負の対照を同じ入力に混ぜてある: 型引数（`useState<string | null>(null)`）を
    // タグと読むと `(null)` を1語ラベルとして報告する（実際にやった）。
    'app/page.tsx': [
      "import { useState } from 'react'",
      'export default function P({ label }: { label: string }) {',
      '  const [value, setValue] = useState<string | null>(null)',
      '  return (',
      '    <div onClick={() => setValue(label)}>',
      '      <p>',
      "        <b>{t('me.createStep1')}</b> — pick the room you will start from.",
      '      </p>',
      '      <span>',
      '        {label} is premium <i />',
      '      </span>',
      '      <span>{value}</span>',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['pick the room', 'is premium'],
  notContains: ['(null)'],
})

gateCase('check:i18n — 文字列リテラルの中身を地の文と読まない（シェーダ・正規表現）', {
  gate: 'check-i18n.mjs',
  files: {
    // 上のルールを足した直後、**タグを含む行の文字列リテラルの中身**を地の文として
    // 報告した（GLSLの `#include <fog_vertex>\n\tgl_PointSize = …` と、JSXの中の
    // `.replace(/^https?:\/\//, '')`）。判定は伏せ字側で行う — JSXの地の文は
    // クォートの中に無いので、失うものが無い。
    'app/page.tsx': [
      'export default function P({ url }: { url: string }) {',
      '  const patch = (src: string) =>',
      "    src.replace('#include <fog_vertex>', '#include <fog_vertex>\\n\\tgl_PointSize = min(gl_PointSize, 9.0);')",
      '  return (',
      '    <div>',
      "      <span>{patch(url).replace(/^https?:\\/\\//, '')}</span>",
      "      <span>{t('common.save')}</span>",
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: false,
})

gateCase('check:i18n — 自己閉じタグ（<br />）の直後のテキストも検査する', {
  gate: 'check-i18n.mjs',
  files: {
    // `/>` を「タグの終わりではない」と扱っていたため、その次の行の案内文が
    // 検査から外れていた（作家パネルの同期の説明文 2026-07-29）
    'app/page.tsx': [
      'export default function P() {',
      '  return (',
      '    <p>',
      "      {t('common.save')}",
      '      <br />',
      '      Your edits sync to this page automatically.',
      '    </p>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['Your edits sync'],
})

gateCase('check:i18n — 括弧や記号で飾った1語ラベルも検出する', {
  gate: 'check-i18n.mjs',
  files: {
    // `(untitled)` `Copied ✓` は「2語以上」でも「素の1語」でもないため、
    // 1語判定を入れた後も素通りしていた（管理画面で2件 2026-07-29）。
    // 記号だけ・番号だけのものは文言ではないので誤検知しないこと。
    'app/page.tsx': [
      'export default function P({ g, done }: { g: { title: string }; done: boolean }) {',
      '  return (',
      '    <div>',
      "      <span>{g.title || '(untitled)'}</span>",
      "      <span>{done ? 'Copied ✓' : '…'}</span>",
      '      <span>{done ? \'—\' : \'·\'}</span>',
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: true,
  contains: ['(untitled)', 'Copied ✓'],
})

gateCase('check:i18n — 三項・論理のオペランド以外のリテラルは誤検知しない', {
  gate: 'check-i18n.mjs',
  files: {
    // 「オペランド位置だけ見る」を外すと、リポジトリ中の 56 箇所がいきなり報告され
    // pushが止まる（実測 2026-07-29）。その代表形をそのまま置く:
    //   ① `{err && <p className="me-error">…}` の**クラス名**
    //   ② `{state === 'saving' && …}` の**比較の右辺**
    //   ③ `fmt(d, 'en-US')` の**引数**
    // `=> Promise<void>` は `=>` の `>` をJSXの開きタグと誤読した実例。
    'app/page.tsx': [
      'export default function P({ err, state, d }: { err: string; state: string; d: Date }) {',
      '  const run = (label: string, fn: () => Promise<void>) => void fn()',
      '  return (',
      "    <div onClick={() => run('go', async () => {})}>",
      '      {err && <p className="me-error">{err}</p>}',
      "      {state === 'saving' && <span className=\"hako-save-state\">{t('common.saving')}</span>}",
      "      <time>{d.toLocaleDateString('en-US')}</time>",
      '    </div>',
      '  )',
      '}',
    ].join('\n'),
    ...DICTS,
  },
  expectFail: false,
  notContains: ['me-error', 'hako-save-state', 'en-US', 'Promise', 'saving'],
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

// -------------------------------------------------------------- check:schema
// schema.sql（統合スナップショット）が migrations から取り残されるのを見る番人。
// 実際に 0025〜0034 の10本が入っていない状態で放置され、ユーザーの指摘で判明した
// （2026-07-29）。ここでは「入れ忘れた入力で落ちる」「揃っている入力では落ちない」を
// 軸に、ルール（ヘッダ／本文の部分列／README §1／取り残しヘッダ／前文の統合範囲）を
// 1つずつ守る。SQLは実行しないので合成入力はごく小さくてよい。
const MIG_A = ['-- 最初のテーブル', 'create table if not exists public.a (', '  id uuid primary key', ');'].join('\n')
const MIG_B = ['-- b列を足す', 'alter table public.a', '  add column if not exists b text;'].join('\n')

// 前文の「migrations 0001〜NNNN を統合」は、最新番号と合っていないと別途落ちる。
// ルールを1つずつ切り分けたいので、既定では最新に合わせておく。
const schemaOf = (sections, { claim = '0002' } = {}) =>
  [`-- Xibit360 全スキーマ統合ファイル(migrations 0001〜${claim} を統合)`, '', ...sections].join('\n')

const section = (name, body) => [`-- # ${name}`, body].join('\n')

const readmeOf = (items) =>
  [
    '# Supabase セットアップ手順',
    '',
    '## 1. スキーマの適用(必須・1回だけ)',
    '',
    '1. SQL Editor を開く',
    '2. `supabase/migrations/` のSQLを**番号順に**貼って Run',
    ...items.map((i) => `   - ${i}`),
    '',
    '## 2. 認証の設定',
    '',
    'メールで動く。',
    '',
  ].join('\n')

const READY_README = readmeOf(['`0001_a.sql` — 初期スキーマ', '`0002_b.sql` — b列'])
const MIGS = { 'supabase/migrations/0001_a.sql': MIG_A, 'supabase/migrations/0002_b.sql': MIG_B }

gateCase('check:schema — migration を足して schema.sql に入れ忘れた入力で落ちる', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    // 0002 を足したのに統合スナップショットが 0001 のままという、今回そのままの形
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A)]),
    'supabase/README.md': READY_README,
  },
  expectFail: true,
  contains: ['0002_b.sql', '節が無い'],
})

gateCase('check:schema — 揃っている入力では落ちない', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A), section('0002_b.sql', MIG_B)]),
    'supabase/README.md': READY_README,
  },
  expectFail: false,
  contains: ['0 件', 'migration 2 本を照合'],
})

gateCase('check:schema — 節はあるが本文が入っていない入力で落ちる', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    // 見出しだけコピーして中身を忘れる（手で統合するときに最も起きやすい）
    'supabase/schema.sql': schemaOf([
      section('0001_a.sql', MIG_A),
      section('0002_b.sql', '-- b列を足す'),
    ]),
    'supabase/README.md': READY_README,
  },
  expectFail: true,
  contains: ['0002_b.sql', '中身が schema.sql に入っていない'],
})

gateCase('check:schema — 本文の順序が入れ替わっていたら落ちる（部分列は順序を見る）', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    // 行は両方あるが順序が逆。alter より先に add column が来ても通るなら、
    // 「部分列」ではなく「集合」を見ていることになる。
    'supabase/schema.sql': schemaOf([
      section('0001_a.sql', MIG_A),
      section('0002_b.sql', ['  add column if not exists b text;', 'alter table public.a'].join('\n')),
    ]),
    'supabase/README.md': READY_README,
  },
  expectFail: true,
  contains: ['0002_b.sql'],
})

gateCase('check:schema — 本文が自分のヘッダより前にしか無いなら落ちる', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    // 0002 の本文は schema.sql に「ある」が、置かれているのは 0001 の節の中で、
    // 0002 の節は空。照合を「どこかにあればよい」にすると通ってしまう。
    // migration どうしは `);` や grant 行のような同じ行を大量に共有するので、
    // 下限を外すと**別の節の行で新しい節の中身が満たされたことになる**。
    // 変異テストで見つけた穴（この下限を外すと自己テストが緑のままだった 2026-07-29）。
    'supabase/schema.sql': schemaOf([
      section('0001_a.sql', [MIG_A, 'alter table public.a', '  add column if not exists b text;'].join('\n')),
      section('0002_b.sql', '-- 中身を入れ忘れた'),
    ]),
    'supabase/README.md': READY_README,
  },
  expectFail: true,
  contains: ['0002_b.sql', '中身が schema.sql に入っていない'],
})

gateCase('check:schema — README §1 の一覧に無い migration を検出する', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A), section('0002_b.sql', MIG_B)]),
    'supabase/README.md': readmeOf(['`0001_a.sql` — 初期スキーマ']),
  },
  expectFail: true,
  contains: ['0002_b.sql', 'README'],
})

gateCase('check:schema — README の範囲表記（`0001`〜`0002`）は一覧として認める', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A), section('0002_b.sql', MIG_B)]),
    // README は実際に `0011`〜`0015` とまとめている。これを未記載と言い出すと
    // 番人が既存の書き方を否定してしまう（＝誤検知でpushが止まる）。
    'supabase/README.md': readmeOf(['`0001`〜`0002` — 初期スキーマとb列']),
  },
  expectFail: false,
})

gateCase('check:schema — §1 の地の文の範囲表記は一覧のカバーと認めない', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A), section('0002_b.sql', MIG_B)]),
    // 一覧には 0001 しか無いが、地の文が「下の 0001〜0002 が一括で適用されます」と
    // 言っている。地の文まで範囲として数えると、この一言で一覧の照合がまるごと
    // 空振りになる（実際にこの番人を入れた作業でREADMEにこの一文を書いて踏んだ）。
    'supabase/README.md': [
      '# Supabase セットアップ手順',
      '',
      '## 1. スキーマの適用(必須・1回だけ)',
      '',
      '`supabase/schema.sql` を貼り付けて Run すれば、下の 0001〜0002 が一括で適用されます。',
      '',
      '1. SQL Editor を開く',
      '   - `0001_a.sql` — 初期スキーマ',
      '',
      '## 2. 認証の設定',
      '',
    ].join('\n'),
  },
  expectFail: true,
  contains: ['0002_b.sql', 'README'],
})

gateCase('check:schema — コメント・インデント・空行の違いを誤検知しない', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    // 統合するときに説明コメントを書き換える／インデントを揃えるのは普通の作業。
    // これで落ちるなら番人が使われなくなる。照合するのはコード行だけ。
    'supabase/schema.sql': schemaOf([
      section('0001_a.sql', MIG_A),
      section(
        '0002_b.sql',
        [
          '-- 統合側では説明を書き換えている',
          '/* 複数行の',
          '   ブロックコメント */',
          '',
          'alter    table   public.a',
          '    add column if not exists b text;',
        ].join('\n'),
      ),
    ]),
    'supabase/README.md': READY_README,
  },
  expectFail: false,
  contains: ['0 件'],
})

gateCase('check:schema — 文字列リテラルの中の `--` をコメントと読まない', {
  gate: 'check-schema-sync.mjs',
  files: {
    'supabase/migrations/0001_a.sql': ["insert into public.a (note) values ('a--b');"].join('\n'),
    // `--` を素朴に切ると migration 側の行が `insert into public.a (note) values ('a`
    // になり、schema.sql 側と同じように壊れるので**両方壊れて通ってしまう**。
    // schema.sql 側だけ後半を落として、切り方が間違っていれば落ちるようにする。
    'supabase/schema.sql': schemaOf([section('0001_a.sql', "insert into public.a (note) values ('a")], {
      claim: '0001',
    }),
    'supabase/README.md': readmeOf(['`0001_a.sql` — 初期スキーマ']),
  },
  expectFail: true,
  contains: ['0001_a.sql'],
})

gateCase('check:schema — migration が存在しない取り残しヘッダを検出する', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    'supabase/schema.sql': schemaOf([
      section('0001_a.sql', MIG_A),
      section('0002_b.sql', MIG_B),
      section('0003_gone.sql', 'select 1;'),
    ]),
    'supabase/README.md': READY_README,
  },
  expectFail: true,
  contains: ['0003_gone.sql', '取り残し'],
})

gateCase('check:schema — 前文が名乗る統合範囲が古い入力で落ちる', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    // 中身は揃っているが「0001〜0001 を統合」と名乗っている。実際に schema.sql は
    // 「0001〜0022 を統合」と言いながら 0024 まで入っていた。
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A), section('0002_b.sql', MIG_B)], { claim: '0001' }),
    'supabase/README.md': READY_README,
  },
  expectFail: true,
  contains: ['統合範囲'],
})

gateCase('check:schema — 未追跡の migration を見落とさず落ちる（git add 前の新規ファイル）', {
  gate: 'check-schema-sync.mjs',
  files: {
    ...MIGS,
    'supabase/schema.sql': schemaOf([section('0001_a.sql', MIG_A), section('0002_b.sql', MIG_B)]),
    'supabase/README.md': READY_README,
  },
  add: false,
  expectFail: true,
  contains: ['未追跡'],
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
