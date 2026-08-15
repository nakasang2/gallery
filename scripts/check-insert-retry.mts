// 「列が無いときだけ落として入れ直す」判定を、実装（lib/insertRetry.ts）そのものを
// 呼んで固定する番人。
//
// なぜ要るか（2026-08-15 に本番のコードで見つけた実バグ）: 元の判定は
//   INSERT_OPTIONAL.find((c) => new RegExp(c).test(error.message))
// で、**エラーメッセージに列名が出ていれば「その列が無い」と読んでいた**。ところが
// migration 0061 の拒否は理由の説明として列名を含む:
//   artworks.gallery_id must be one of your own joint-exhibition rooms
// その結果、DBが正しく拒否したアップロードで `gallery_id` を落として入れ直し、
// **合同展示の部屋に入るはずの作品が黙って共有プールへ落ちていた**。エラーは出ない
// ので誰も気づけない ── 型チェックもビルドも画面も、この食い違いを何も言わない。
//
// ここで固定するのは1点だけ: **拒否（P0001 / 23514 / 42501）では絶対に列を落とさない。**
// 落としてよいのは「列そのものが無い」を表すコード（42703 / PGRST204）のときだけ。
//
// 実行: npm run check:insert-retry
import { optionalColumnToDrop } from '../lib/insertRetry.ts'

const OPTIONAL = ['bytes', 'gallery_id'] as const
/** 通常のアップロードが送る行（`gallery_id` は合同展示の部屋のときだけ id が入る） */
const ROW = { id: 'x', owner_id: 'o', bytes: 123, gallery_id: 'g' }

interface Case {
  name: string
  code: string
  message: string
  row?: Record<string, unknown>
  /** 落とすべき列。落としてはいけない場合は null */
  drop: string | null
}

const CASES: Case[] = [
  /* ---- ここがこの番人の主目的: 拒否で列を落とさない ---- */
  {
    name: '0061 の拒否（メッセージに gallery_id を含む）で列を落とさない',
    code: 'P0001',
    message: 'artworks.gallery_id must be one of your own joint-exhibition rooms',
    drop: null,
  },
  {
    name: '0059 の枠超過（P0001）で列を落とさない',
    code: 'P0001',
    message: 'work slot pool exceeded: 6 works for a pool of 5',
    drop: null,
  },
  {
    name: '0061 の部屋プール超過（メッセージに room… を含む）でも落とさない',
    code: 'P0001',
    message: 'room work slot pool exceeded: 16 works for a room pool of 15',
    drop: null,
  },
  {
    name: 'check 制約違反（23514）で列を落とさない',
    code: '23514',
    message: 'new row for relation "artworks" violates check constraint "artworks_gallery_id_check"',
    drop: null,
  },
  {
    name: 'RLS 拒否（42501）で列を落とさない',
    code: '42501',
    message: 'new row violates row-level security policy for table "artworks"',
    drop: null,
  },
  {
    name: 'コードが無いエラーでは落とさない（保守的に throw する）',
    code: '',
    message: 'gallery_id something went wrong',
    drop: null,
  },

  /* ---- 本来の目的: 列がまだ無いDBでも通す ---- */
  {
    name: 'PGRST204（スキーマキャッシュに bytes が無い）なら bytes を落とす',
    code: 'PGRST204',
    message: "Could not find the 'bytes' column of 'artworks' in the schema cache",
    drop: 'bytes',
  },
  {
    name: 'PGRST204（gallery_id が無い＝0061 未適用）なら gallery_id を落とす',
    code: 'PGRST204',
    message: "Could not find the 'gallery_id' column of 'artworks' in the schema cache",
    drop: 'gallery_id',
  },
  {
    name: '42703（undefined_column）でも落とす',
    code: '42703',
    message: 'column "gallery_id" of relation "artworks" does not exist',
    drop: 'gallery_id',
  },
  {
    name: '既に落とした列は二度と落とさない（行に無い）',
    code: 'PGRST204',
    message: "Could not find the 'gallery_id' column of 'artworks' in the schema cache",
    row: { id: 'x', owner_id: 'o', bytes: 123 },
    drop: null,
  },
  {
    name: '列が無いコードでも、どの列か分からなければ落とさない',
    code: '42703',
    message: 'column "title" of relation "artworks" does not exist',
    drop: null,
  },
]

let bad = 0
for (const c of CASES) {
  const got = optionalColumnToDrop({ code: c.code, message: c.message }, c.row ?? ROW, OPTIONAL) ?? null
  if (got !== c.drop) {
    bad++
    console.error(`✗ ${c.name}`)
    console.error(`    期待: ${c.drop ?? '落とさない'} / 実際: ${got ?? '落とさない'}`)
  }
}

if (bad) {
  console.error(`\n入れ直しの判定: ${bad} 件が期待と違います`)
  console.error('**拒否で列を落とすと、DBの守りをクライアントの再試行が迂回します**')
  console.error('（2026-08-15: 合同展示の部屋に入るはずの作品が黙って共有プールへ落ちていた）')
  process.exit(1)
}
console.log(`入れ直しの判定: ${CASES.length} ケースすべて期待どおり（拒否では列を落とさない／列が無いときだけ落とす）`)
