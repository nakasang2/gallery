// SNS欄の入力→保存→表示の往復を、実装（lib/sns.ts）そのものを呼んで確かめる番人。
//
// なぜ要るか: **保存値が黙って空になる**バグを2度出した（別視点レビューが1度検出、その後
// ユーザーが本番で踏んだ 2026-08-09）。どちらも原因は同じで、「ドットが入っていれば URL」
// という判定を**ハンドルにも当てていた**こと。ハンドルにはドットが入る:
// Instagram の `art.by.jane`、Bluesky の `you.bsky.social`。
//
// 型チェックもビルドも通るし、画面も一見動く。**打ったものが消える**ことだけが症状なので、
// ここで入力ごとの期待値を固定しておく以外に気づく方法が無い。
//
// 実行: npm run check:sns
import {
  normalizeSnsValue,
  snsUrl,
  snsDisplayValue,
  snsMismatch,
  SNS_PLATFORMS,
} from '../lib/sns.ts'

interface Case {
  /** 欄（プラットフォームid） */
  id: string
  /** 打った／貼った文字列 */
  input: string
  /** 保存されるべき値。'' は「空で正しい」場合だけ */
  stored: string
  /** 来場者が開くURL。'' は保存値が空のとき */
  opens: string
  /** 取り違えの警告が出るべきか */
  warns?: boolean
}

const CASES: Case[] = [
  /* ---- ドット入りハンドル（この番人の主目的） ---- */
  { id: 'instagram', input: 'art.by.jane', stored: 'art.by.jane', opens: 'https://instagram.com/art.by.jane' },
  { id: 'instagram', input: 'https://www.instagram.com/art.by.jane/', stored: 'art.by.jane', opens: 'https://instagram.com/art.by.jane' },
  { id: 'threads', input: 'art.by.jane', stored: 'art.by.jane', opens: 'https://threads.com/@art.by.jane' },
  // Bluesky のハンドルは**必ず**ドットを含む
  { id: 'bluesky', input: 'you.bsky.social', stored: 'you.bsky.social', opens: 'https://bsky.app/profile/you.bsky.social' },

  /* ---- ふつうのハンドルとプロフィールURL ---- */
  { id: 'instagram', input: 'yourname', stored: 'yourname', opens: 'https://instagram.com/yourname' },
  { id: 'instagram', input: '@yourname', stored: 'yourname', opens: 'https://instagram.com/yourname' },
  { id: 'instagram', input: 'https://www.instagram.com/yourname', stored: 'yourname', opens: 'https://instagram.com/yourname' },
  { id: 'instagram', input: 'https://instagram.com/yourname?igsh=abc', stored: 'yourname', opens: 'https://instagram.com/yourname' },
  // **貼ったドメインが勝手に変わらないこと。** ハンドル欄は正規の前置きからURLを組み直す
  // ので、前置きが古いと「貼ったものと違うURL」が返る（Threads は 2025年に .net → .com）。
  { id: 'threads', input: 'https://www.threads.com/@yourname', stored: 'yourname', opens: 'https://threads.com/@yourname' },
  // 旧ドメインを貼られても取り違え警告は出さず、現行ドメインに寄せる
  { id: 'threads', input: 'https://www.threads.net/@yourname', stored: 'yourname', opens: 'https://threads.com/@yourname' },
  { id: 'x', input: 'https://x.com/yourname', stored: 'yourname', opens: 'https://x.com/yourname' },
  { id: 'tiktok', input: 'https://www.tiktok.com/@yourname', stored: 'yourname', opens: 'https://tiktok.com/@yourname' },
  { id: 'youtube', input: 'https://www.youtube.com/@yourname', stored: 'yourname', opens: 'https://youtube.com/@yourname' },

  /* ---- 一本道でないプロフィールは丸ごと保つ ---- */
  { id: 'youtube', input: 'https://youtube.com/channel/UCabcdef', stored: 'https://youtube.com/channel/UCabcdef', opens: 'https://youtube.com/channel/UCabcdef' },
  { id: 'line', input: 'https://line.me/R/ti/p/@abc', stored: 'https://line.me/R/ti/p/@abc', opens: 'https://line.me/R/ti/p/@abc' },
  { id: 'website', input: 'yoursite.com', stored: 'https://yoursite.com', opens: 'https://yoursite.com' },

  /* ---- 取り違えは警告する（黙って別のURLを作らない） ---- */
  { id: 'instagram', input: 'https://x.com/someone', stored: 'someone', opens: 'https://instagram.com/someone', warns: true },
  { id: 'instagram', input: 'x.com/someone', stored: 'someone', opens: 'https://instagram.com/someone', warns: true },
  { id: 'instagram', input: 'https://example.com/gallery', stored: 'gallery', opens: 'https://instagram.com/gallery', warns: true },

  /* ---- ホストだけ貼られた（プロフィールを指していない）→ 空で正しい ---- */
  { id: 'instagram', input: 'instagram.com', stored: '', opens: '' },
]

const errors: string[] = []

// 表に載せた欄が実在すること（idを打ち間違えると全ケースが黙って別経路を通る）
for (const c of CASES) {
  if (!SNS_PLATFORMS.some((p) => p.id === c.id)) {
    errors.push(`欄 '${c.id}' が SNS_PLATFORMS に無い（ケースの書き間違い）`)
  }
}

for (const c of CASES) {
  const stored = normalizeSnsValue(c.id, c.input)
  if (stored !== c.stored) {
    errors.push(
      `[${c.id}] "${c.input}" の保存値が ${JSON.stringify(stored)}（期待 ${JSON.stringify(c.stored)}）` +
        (stored === '' ? ' ← **打ったものが消えている**' : '')
    )
  }
  const opens = stored ? snsUrl(c.id, stored) : ''
  if (opens !== c.opens) {
    errors.push(`[${c.id}] "${c.input}" が開くURLが ${JSON.stringify(opens)}（期待 ${JSON.stringify(c.opens)}）`)
  }
  const warned = snsMismatch(c.id, c.input) !== null
  if (warned !== Boolean(c.warns)) {
    errors.push(
      `[${c.id}] "${c.input}" の取り違え警告が ${warned}（期待 ${Boolean(c.warns)}）` +
        (warned ? ' ← **正しい入力に警告を出している**' : '')
    )
  }
}

// 往復: 欄に表示された値をもう一度保存しても、保存値が変わらないこと。
// **これが崩れると「開き直して保存し直すたびに壊れる」**（実際にそうなっていた:
// 表示が `https://art.by.jane` になり、次の保存で空になった）。
for (const c of CASES) {
  if (!c.stored) continue
  const shown = snsDisplayValue(c.id, c.stored)
  const again = normalizeSnsValue(c.id, shown)
  if (again !== c.stored) {
    errors.push(
      `[${c.id}] 往復で壊れる: 保存 ${JSON.stringify(c.stored)} → 表示 ${JSON.stringify(shown)} → 再保存 ${JSON.stringify(again)}`
    )
  }
}

if (errors.length > 0) {
  console.error(`SNS欄の入出力: ${errors.length} 件おかしい\n`)
  for (const e of errors) console.error('  ✗ ' + e)
  console.error('\nlib/sns.ts の looksLikeAddress / normalizeHandle / snsUrl を確認すること。')
  console.error('ハンドルにドットは入る（Instagram の art.by.jane、Bluesky の you.bsky.social）。')
  process.exit(1)
}

console.log(
  `SNS欄の入出力: ${CASES.length} ケースすべて期待どおり` +
    `（保存値・開くURL・取り違え警告・表示→再保存の往復を照合）`
)
