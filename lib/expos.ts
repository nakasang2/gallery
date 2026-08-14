// 合同展示（Expo）— migration 0044。DECISIONS 2026-08-09 に決定の全文。
//
// 通常展示（`galleries`）とは**別の実体**。`/expo/{slug}` で開き、会期があり、主催者が
// 公開時に場所代を払う（7日 $15 / 14日 $25 / 30日 $40）。参加作家は無料。
//
// **ここに「公開する」関数は無い。** 公開は支払いと同じ1つの操作で、Stripe の webhook が
// `record_expo_purchase` を呼ぶときにだけ起きる（0044）。クライアントから会期を始める
// 経路が無いのが設計で、ここに publish を足したくなったらそれは設計を壊している合図。
import { supabase } from './supabase'

/** 会期の状態。**日付から導出**する（DBに旗を持たない）。 */
export type ExpoPhase =
  /** まだ払っていない。誰にも見えない。無料で準備できる */
  | 'draft'
  /** 支払いは済んだが、選んだ開始日時がまだ来ていない（ユーザー指示 2026-08-10:
   *  公開日を予約できるようにした）。`starts_at` はあるが `now() < starts_at`。 */
  | 'scheduled'
  /** 会期中。`/expo/{slug}` が見えている */
  | 'running'
  /** 会期は終わったが、猶予のあいだURLは生きている（表示側が「終了」と出す） */
  | 'ended'

export interface Expo {
  id: string
  slug: string
  title: string
  statement: string
  /** 主催者のid。**参加作家の部屋を編集しているとき、自分が主催者かどうかを見分ける**
   *  ために使う（migration 0062・ユーザー決定 2026-08-13: 参加者にも自分の部屋が
   *  あるので、「参加者」タブ・会期の決済は主催者だけに絞る必要がある）。 */
  ownerId: string
  /** 選んでいる会期の長さ。公開後は動かせない。 */
  durationDays: number
  /** 会期の開始。null = 下書き。 */
  startsAt: string | null
  /** 会期の終わり（開始＋長さ。DBが必ず導出する）。 */
  endsAt: string | null
  createdAt: string
}

interface ExpoRow {
  id: string
  slug: string
  title: string | null
  statement: string | null
  owner_id: string
  duration_days: number | null
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

const COLS = 'id, slug, title, statement, owner_id, duration_days, starts_at, ends_at, created_at'

function rowToExpo(r: ExpoRow): Expo {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title ?? '',
    statement: r.statement ?? '',
    ownerId: r.owner_id,
    durationDays: r.duration_days ?? 14,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
  }
}

/** 猶予（会期後もURLが生きている日数）。DB の `expo_grace_days()` と対で保つ。 */
export const EXPO_GRACE_DAYS = 7

/**
 * いまどの段階か。**表示のためだけに使う** — 見せてよいかどうかを本当に決めているのは
 * DB の RLS（`expo_is_live`）で、ここが間違っても他人の下書きは見えない。
 *
 * `scheduled`（支払い済みだが選んだ開始日時がまだ来ていない）は `starts_at` が未来の
 * ときだけ成立する。会期の予約（migration 0051）を入れる前は `starts_at` は常に
 * 「今」だったので、この分岐は実質常に false だった。
 */
export function expoPhase(x: Expo, now = Date.now()): ExpoPhase {
  if (!x.startsAt || !x.endsAt) return 'draft'
  const starts = new Date(x.startsAt).getTime()
  if (now < starts) return 'scheduled'
  return now < new Date(x.endsAt).getTime() ? 'running' : 'ended'
}

/** 猶予が切れて消える日（`ended` のときだけ意味がある）。 */
export function expoPurgeAt(x: Expo): Date | null {
  if (!x.endsAt) return null
  return new Date(new Date(x.endsAt).getTime() + EXPO_GRACE_DAYS * 86400000)
}

/** 名前の形（DBの check と同じ）。UIが先に弾いて、無駄な往復と生の制約違反を防ぐ。 */
export const EXPO_SLUG_RE = /^[a-z0-9-]{3,40}$/

/** 自分が主催している展示。新しい順。 */
export async function listMyExpos(ownerId: string): Promise<Expo[]> {
  const { data, error } = await supabase!
    .from('expos')
    .select(COLS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as ExpoRow[]).map(rowToExpo)
}

/**
 * 1件だけ、idで直接引く。**部屋編集画面（合同展示の部屋の「公開」ステージ）が、
 * その部屋が属する展示の題名・会期を出すために使う**（ユーザー指示 2026-08-10:
 * 通常展示と合同展示の部屋編集画面を同じ形にする）。見つからなければ null。
 */
export async function getExpoById(id: string): Promise<Expo | null> {
  const { data, error } = await supabase!
    .from('expos')
    .select(COLS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? rowToExpo(data as ExpoRow) : null
}

export type ExpoError = 'slug_taken' | 'slug_invalid' | 'room_exists' | 'missing_table' | 'other'

/** 生のDBエラーを、UIが文言を選べる形に翻訳する。 */
export function expoErrorKey(e: unknown): ExpoError {
  const err = e as { code?: string; message?: string } | null
  const code = err?.code ?? ''
  const msg = (err?.message ?? '').toLowerCase()
  // 表がまだ無い（0044 未適用）。**コードだけで見分ける** — 表名の文字列一致で拾うと、
  // ポリシー再帰や権限エラーまで「未適用」に見える（LESSONS 2026-08-09）。
  if (code === '42P01' || code === 'PGRST205') return 'missing_table'
  if (code === '23505') return 'slug_taken'
  // 「この展示にはもう自分の部屋がある」（0062 の `enforce_room_allowance`）。
  // **`23514` より先に見る。** 下の行がかつて `code === '23514'` だけで
  // `slug_invalid` に丸めていたので、**URLの入力欄が無い操作なのに「3〜40文字、
  // 半角の小文字・数字…」というまるで関係ない注意書きが出ていた**（別視点レビューで
  // 検出）。`23514` は check 制約すべてに付く汎用のコードで、それだけでは何が
  // 起きたか決まらない。
  if (msg.includes('you already have a room')) return 'room_exists'
  // 名前の形（`expos_slug_check`）。**制約名で見分ける** — コードだけで判断しない。
  if (msg.includes('expos_slug_check')) return 'slug_invalid'
  return 'other'
}

/**
 * 下書きを作る。**この時点では無料で、誰にも見えない。**
 * 会期の長さはあとで選び直せる（公開＝支払いの時点で確定する）。
 */
export async function createExpo(
  ownerId: string,
  input: { slug: string; title: string; durationDays?: number }
): Promise<Expo> {
  const { data, error } = await supabase!
    .from('expos')
    .insert({
      owner_id: ownerId,
      slug: input.slug.trim().toLowerCase(),
      title: input.title.trim(),
      // 会期の長さは**支払いの直前に決まる**ので、作成時は既定（14日）に任せる。
      ...(input.durationDays === undefined ? {} : { duration_days: input.durationDays }),
    })
    .select(COLS)
    .single()
  if (error) throw error
  return rowToExpo(data as ExpoRow)
}

/**
 * 下書きの手直し。**会期の長さと名前は公開後に送っても DB が弾く**
 * （`guard_expo_run`）ので、ここでは何も判断しない ── UIが状態を読み違えても、
 * 書けるものは変わらない。
 */
export async function updateExpo(
  expoId: string,
  patch: { slug?: string; title?: string; statement?: string; durationDays?: number }
): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.slug !== undefined) row.slug = patch.slug.trim().toLowerCase()
  if (patch.title !== undefined) row.title = patch.title.trim()
  if (patch.statement !== undefined) row.statement = patch.statement
  if (patch.durationDays !== undefined) row.duration_days = patch.durationDays
  if (Object.keys(row).length === 0) return
  const { error } = await supabase!.from('expos').update(row).eq('id', expoId)
  if (error) throw error
}

/** 下書きを捨てる。会期が始まったものは消さない（DB側は消せるが、UIから出さない）。 */
export async function deleteExpo(expoId: string): Promise<void> {
  const { error } = await supabase!.from('expos').delete().eq('id', expoId)
  if (error) throw error
}

/**
 * 展示に部屋を1つ足す。**主催者の部屋枠（$25）は消費しない** — 場所代で払っている
 * ので、`enforce_room_allowance` が `expo_id` のある部屋を勘定から外す（0044）。
 *
 * `slug` は展示の中で一意でよいが、`galleries` の一意制約は (owner_id, slug) なので
 * 主催者の他の部屋ともぶつからない名前にする。
 */
export async function addExpoRoom(
  ownerId: string,
  expoId: string,
  input: { slug: string; title: string }
): Promise<string> {
  const { data, error } = await supabase!
    .from('galleries')
    .insert({
      owner_id: ownerId,
      expo_id: expoId,
      slug: input.slug,
      title: input.title,
      // 場所代に含まれるので物理上限まで使える（0044 は expo の部屋を勘定外にするので、
      // ここは番人に通る）。
      work_cap: 15,
      slots_included: true,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * 場所代の決済へ送る。**公開はこの決済が通ったときにだけ起きる**（webhook →
 * `record_expo_purchase`）。ここが返すのは Stripe のURLだけで、会期は始まらない。
 *
 * 金額も日数も送らない（SKUから一意に決まる）。`startsAt` は**いつから見せるか**の
 * 予約（migration 0051。ユーザー指示 2026-08-10）── 省略すると支払い完了と同時に
 * 公開される（従来どおり）。
 */
export async function startExpoCheckout(expoId: string, sku: string, startsAt?: string): Promise<string> {
  const { data: auth } = await supabase!.auth.getSession()
  const token = auth.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sku, expoId, ...(startsAt ? { startsAt } : {}) }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Could not start checkout (${res.status}).`)
  }
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error('Stripe returned no checkout URL.')
  return url
}

/** 公開URL。会期が始まっていなくても形は同じ（開くと404になる）。 */
export function expoPath(slug: string): string {
  return `/expo/${slug}`
}

/* `switchRoomExpo` / `roomExpoSwitchErrorKey` はここにあったが、**呼び手が無くなったので
   撤去した**（ユーザー選択 2026-08-14: 画面から「この部屋を展示から外す」を消した）。
   **DB側の RPC `switch_room_expo` は残っている** ── migration 0063 が「主催者以外は
   展示から外せない」を強制しており、その番人はアプリの都合で消してよいものではない。
   将来この操作を画面に戻すなら、ここに薄いラッパーを書き直す。 */

/**
 * 参加作家の「準備できた」トグル（migration 0062、ユーザー決定 2026-08-13）。
 * 自分の合同展示の部屋でオンにすると、主催者に `room_ready` 通知が届く。
 * オフに戻すこともできる（`expo_ready_at` を null に戻すだけ）。
 */
export async function setExpoRoomReady(galleryId: string, ready: boolean): Promise<void> {
  const { error } = await supabase!.rpc('set_expo_room_ready', { p_gallery: galleryId, p_ready: ready })
  if (error) throw error
}
