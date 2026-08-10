// 通知（migration 0042、ユーザー指示 2026-08-09）。
//
// 行を書くのは**DB側だけ**（0042 のトリガと管理者RPC）。ここには「作る」関数が無い
// のが正しい状態で、insert を足したくなったらそれは設計を壊している合図（クライアント
// から insert できると他人宛に偽の通知を作れる）。
//
// 読むのは本人の分だけ。RLS が本体なので、ここで user_id を絞らなくても他人の行は
// 返らない — それでもクエリに入れるのは、索引を効かせるため。
import { supabase } from './supabase'

export type NotificationKind =
  | 'invite'
  | 'invite_reply'
  /** 招待リンクから参加希望が来た（0048）。**宛先は主催者**。 */
  | 'invite_request'
  /** その参加希望が承認された（0048）。**宛先は作家**。 */
  | 'invite_approved'
  | 'submission'
  | 'like'
  | 'guestbook'
  | 'announce'

export interface AppNotification {
  id: string
  kind: NotificationKind
  galleryId: string | null
  artworkId: string | null
  /** 書かれた時点の見出し（部屋名・作品名・お知らせのタイトル）。 */
  title: string
  /** 芳名帳の本文、お知らせの本文、招待の返事なら 'accepted' / 'declined'。 */
  body: string
  actorName: string | null
  count: number
  readAt: string | null
  createdAt: string
}

interface NotificationRow {
  id: string
  kind: string
  gallery_id: string | null
  artwork_id: string | null
  title: string | null
  body: string | null
  actor_name: string | null
  count: number | null
  read_at: string | null
  created_at: string
}

const KINDS: readonly string[] = [
  'invite',
  'invite_reply',
  'invite_request',
  'invite_approved',
  'submission',
  'like',
  'guestbook',
  'announce',
]

function rowToNotification(r: NotificationRow): AppNotification | null {
  // 知らない種類は**捨てる**。表示側が種類ごとに文面を選ぶので、知らない種類を通すと
  // 空の行が並ぶ。将来 0043 で種類を足したときに古いクライアントが空行を出すより、
  // 出ない方がまし。
  if (!KINDS.includes(r.kind)) return null
  return {
    id: r.id,
    kind: r.kind as NotificationKind,
    galleryId: r.gallery_id,
    artworkId: r.artwork_id,
    title: r.title ?? '',
    body: r.body ?? '',
    actorName: r.actor_name,
    count: Math.max(1, r.count ?? 1),
    readAt: r.read_at,
    createdAt: r.created_at,
  }
}

/** ベルを開いたときの一覧。新しい順。既定50件（それ以上を遡る導線は作っていない）。 */
export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  const { data: auth } = await supabase!.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return []

  const { data, error } = await supabase!
    .from('notifications')
    .select('id, kind, gallery_id, artwork_id, title, body, actor_name, count, read_at, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  return ((data ?? []) as NotificationRow[])
    .map(rowToNotification)
    .filter((n): n is AppNotification => n !== null)
}

/** バッジの数字。行は引かずに件数だけ数える（ベルは常に画面に居るので軽くする）。 */
export async function countUnread(): Promise<number> {
  const { data: auth } = await supabase!.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return 0

  const { count, error } = await supabase!
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

/** まとめて既読。開いた時点の未読を全部畳む（1件ずつ既読にする導線は作っていない）。 */
export async function markAllRead(): Promise<void> {
  const { error } = await supabase!.rpc('mark_notifications_read')
  if (error) throw error
}

/** 1件消す。読み終わったものを片付けたい人向け。 */
export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase!.from('notifications').delete().eq('id', id)
  if (error) throw error
}

/**
 * 管理者の一斉送信。**取り消せない**（配った行を回収する経路は作っていない）ので、
 * 呼ぶ側は必ず確認を挟む。返り値は配った人数。
 */
export async function broadcastAnnouncement(title: string, body: string): Promise<number> {
  const { data, error } = await supabase!.rpc('broadcast_announcement', {
    p_title: title,
    p_body: body,
  })
  if (error) throw error
  return typeof data === 'number' ? data : 0
}

/**
 * その通知を押したときに飛ぶ先。**無い場合は null**（お知らせは行き先が無い）。
 *
 * 招待・提出・芳名帳・いいねはどれも /me（ダッシュボード）で扱う話なので、行き先は
 * `/me` 1つ。**部屋ごとのURLは作らない** — /me のタブは `gallery` / `account` の
 * 2つで、部屋を指す経路が存在しないため。`/me#room-<id>` のようなハッシュを返すのは、
 * 誰も読まないアンカーで「その部屋に飛ぶ」と嘘をつくことになる（一度書いて消した）。
 *
 * 部屋ごとに飛ばしたくなったら、先に /me 側に部屋を指す経路を作る。
 */
export function notificationHref(n: AppNotification): string | null {
  // お知らせは行き先が無い（読むだけ）。それ以外はダッシュボードで対応する。
  return n.kind === 'announce' ? null : '/me'
}
