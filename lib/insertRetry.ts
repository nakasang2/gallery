// 「その列がまだ無いDBに向けて、コードだけ先に出てしまった」ときの入れ直し判定。
//
// `lib/cloud.ts` の `insertArtworkRow` は、`bytes`（migration 0035）や `gallery_id`
// （0061）が未適用のデータベースでもアップロードが全滅しないよう、**列が無いと言われた
// ときだけ**その列を落として入れ直す。判定だけをここに切り出してあるのは、番人
// （`npm run check:insert-retry`）から実装そのものを呼んで固定するため。
//
// **なぜ切り出したか（2026-08-15 に見つけた実バグ）**: 元の判定は
//   `INSERT_OPTIONAL.find((c) => new RegExp(c).test(error.message))`
// で、**エラーメッセージに列名が出ていれば列が無いと読んでいた**。ところが
// migration 0061 の拒否は
//   `artworks.gallery_id must be one of your own joint-exhibition rooms`
// と、**理由の説明として列名を含む**。その結果、DBが正しく拒否したアップロードで
// クライアントが `gallery_id` を落として入れ直し、**合同展示の部屋に入るはずの作品が
// 黙って共有プールへ落ちていた**（しかもエラーは出ないので誰も気づけない）。
// DBの守りを、クライアントの再試行が迂回していたことになる。
//
// したがって見るのは**エラーコードだけ**にする。メッセージは「どの列か」を決めるのに
// しか使わない。

/** Supabase（PostgREST）が返すエラーのうち、この判定が見る部分だけ。 */
export interface InsertErrorLike {
  code?: string | null
  message?: string | null
}

/**
 * 「その列が存在しない」ことだけを表すコード。
 *   - `42703` … PostgreSQL の undefined_column
 *   - `PGRST204` … PostgREST の「スキーマキャッシュに列が無い」
 * **拒否（`23514` check_violation・`P0001` raise exception・`42501` RLS）はここに
 * 入れてはいけない** — 入れた瞬間に、DBの拒否をクライアントが握り潰す形に戻る。
 */
const COLUMN_MISSING_CODES = new Set(['42703', 'PGRST204'])

/**
 * 落として入れ直すべき列名。無ければ `undefined`（＝そのまま throw する）。
 *
 * @param error    insert が返したエラー
 * @param row      いま送ろうとしている行（既に落とした列は入っていない）
 * @param optional 落としてよい列（先頭から順に見る）
 */
export function optionalColumnToDrop(
  error: InsertErrorLike | null | undefined,
  row: Record<string, unknown>,
  optional: readonly string[]
): string | undefined {
  if (!error) return undefined
  if (!COLUMN_MISSING_CODES.has(error.code ?? '')) return undefined
  const message = error.message ?? ''
  // コードで「列が無い」と分かったうえで、**どの列か**をメッセージから決める。
  // 列名は識別子なので単純な部分一致でよい（`RegExp` を作らないのは、列名に
  // 正規表現の特殊文字が入ったときに意味が変わるのを避けるため）。
  return optional.find((c) => c in row && message.includes(c))
}
