// サインイン／サインアップの後にどこへ戻すか（`?next=` の1箇所しかない解釈）。
//
// 招待リンク（`/join/{token}`。0048）を未登録の人が踏んだとき、登録してから**元のリンクに
// 戻す**ために足した。戻せないと「登録したけど、何に誘われたのか分からない」で終わる。
//
// **オープンリダイレクトにしない。** `?next=` はURLに載る＝誰でも書けるので、
// 受け取った値をそのまま `router.push` すると外部サイトへ飛ばす踏み台になる
// （`//evil.example` や `https://evil.example` を渡されるだけで成立する）。
// 通すのは**この site の中の絶対パス1本**だけ。

/** 既定の行き先。`next` が無い／通せない値なら必ずここ。 */
export const AFTER_AUTH_DEFAULT = '/me'

/**
 * `?next=` を安全な行き先に畳む。
 *
 * 通す条件は3つとも必要:
 *   ・`/` で始まる（サイト内の絶対パス）
 *   ・`//` で始まらない（`//host` は「プロトコル相対」＝外部サイト）
 *   ・`\` を含まない（ブラウザによって `\` が `/` として扱われ `/\evil.example` が外部になる）
 */
export function safeNext(next: string | null | undefined): string {
  const raw = (next ?? '').trim()
  if (!raw) return AFTER_AUTH_DEFAULT
  if (!raw.startsWith('/')) return AFTER_AUTH_DEFAULT
  if (raw.startsWith('//')) return AFTER_AUTH_DEFAULT
  if (raw.includes('\\')) return AFTER_AUTH_DEFAULT
  return raw
}

/** 認証ページへのリンクに付ける `?next=`。行き先が既定と同じなら付けない（URLを汚さない）。 */
export function withNext(path: string, next: string): string {
  return next === AFTER_AUTH_DEFAULT ? path : `${path}?next=${encodeURIComponent(next)}`
}
