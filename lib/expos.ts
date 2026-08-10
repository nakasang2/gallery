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
  /** 会期中。`/expo/{slug}` が見えている */
  | 'running'
  /** 会期は終わったが、猶予のあいだURLは生きている（表示側が「終了」と出す） */
  | 'ended'

export interface Expo {
  id: string
  slug: string
  title: string
  statement: string
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
  duration_days: number | null
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

const COLS = 'id, slug, title, statement, duration_days, starts_at, ends_at, created_at'

function rowToExpo(r: ExpoRow): Expo {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title ?? '',
    statement: r.statement ?? '',
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
 */
export function expoPhase(x: Expo, now = Date.now()): ExpoPhase {
  if (!x.startsAt || !x.endsAt) return 'draft'
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

export type ExpoError = 'slug_taken' | 'slug_invalid' | 'missing_table' | 'other'

/** 生のDBエラーを、UIが文言を選べる形に翻訳する。 */
export function expoErrorKey(e: unknown): ExpoError {
  const err = e as { code?: string; message?: string } | null
  const code = err?.code ?? ''
  const msg = (err?.message ?? '').toLowerCase()
  // 表がまだ無い（0044 未適用）。**コードだけで見分ける** — 表名の文字列一致で拾うと、
  // ポリシー再帰や権限エラーまで「未適用」に見える（LESSONS 2026-08-09）。
  if (code === '42P01' || code === 'PGRST205') return 'missing_table'
  if (code === '23505') return 'slug_taken'
  if (code === '23514' || msg.includes('expos_slug_check')) return 'slug_invalid'
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
 * 金額も日数も送らない（SKUから一意に決まる）。
 */
export async function startExpoCheckout(expoId: string, sku: string): Promise<string> {
  const { data: auth } = await supabase!.auth.getSession()
  const token = auth.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sku, expoId }),
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
