// 合同展示の招待と提出（migration 0041、ユーザー承認 2026-08-09）。
//
// 形は「主催者が招く → 作家が受諾する → **作家が出す作品を選ぶ** → 主催者が掛ける」。
// 主催者が相手のライブラリを漁る形（pull）にしなかったのは、合同展に誘われただけで
// 習作や未発表作まで他人に見える状態になるため。**見える範囲＝出すと決めた範囲**。
//
// 権限はすべてDB側（0041 の RLS とトリガ）が持ち、ここは問い合わせるだけ。UIが状態を
// 読み違えても、書けるものは変わらない。
import { supabase } from './supabase'
import { rowToArtwork, type ArtworkRow } from './cloud'
import type { ArtworkData } from './artworks'

export type InviteStatus = 'pending' | 'accepted' | 'declined'

/** 招かれた相手（主催者の画面に出す）。 */
export interface InviteArtist {
  id: string
  username: string | null
  displayName: string
  avatarUrl: string | null
}

/** 主催者が見る1件。`submittedCount` は「その作家がこの部屋に出した点数」。 */
export interface RoomInvite {
  id: string
  galleryId: string
  status: InviteStatus
  createdAt: string
  respondedAt: string | null
  artist: InviteArtist
  submittedCount: number
}

/** 作家が見る1件（自分宛の招待）。 */
export interface MyInvite {
  id: string
  galleryId: string
  status: InviteStatus
  createdAt: string
  /** 招いてきた展示。0041 の `galleries_select_invited` があるので**非公開でも読める**。 */
  room: { slug: string; title: string; isPublic: boolean; organizer: InviteArtist | null }
  /** この部屋に出している自分の作品の id。 */
  submittedIds: string[]
}

type ProfileEmbed = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
} | null

function toArtist(p: ProfileEmbed, fallbackId: string): InviteArtist {
  return {
    id: p?.id ?? fallbackId,
    username: p?.username ?? null,
    displayName: p?.display_name || p?.username || '',
    avatarUrl: p?.avatar_url ?? null,
  }
}

/* ============================ 主催者側 ============================ */

/** この部屋の招待。`profiles` は `using (true)` なので埋め込みで引ける。 */
export async function listRoomInvites(galleryId: string): Promise<RoomInvite[]> {
  const { data, error } = await supabase!
    .from('room_invites')
    .select('id, gallery_id, artist_id, status, created_at, responded_at, profiles (id, username, display_name, avatar_url)')
    .eq('gallery_id', galleryId)
    .order('created_at', { ascending: true })
  if (error) throw error

  // 提出点数は別クエリで数える。埋め込みで取ろうとすると `room_submissions` には
  // artist_id が無く（作品経由でしか作家に繋がらない）2段の埋め込みが要るため。
  // error を捨てると**読めなかったのが「0点提出」に見える**（招待中と区別がつかない）。
  const { data: subs, error: subErr } = await supabase!
    .from('room_submissions')
    .select('artwork_id, artworks (owner_id)')
    .eq('gallery_id', galleryId)
  if (subErr && !missingSubmissionsTable(subErr)) throw subErr
  const byArtist = new Map<string, number>()
  for (const s of (subs ?? []) as unknown as { artworks: { owner_id: string } | null }[]) {
    const owner = s.artworks?.owner_id
    if (owner) byArtist.set(owner, (byArtist.get(owner) ?? 0) + 1)
  }

  return ((data ?? []) as unknown as {
    id: string
    gallery_id: string
    artist_id: string
    status: InviteStatus
    created_at: string
    responded_at: string | null
    profiles: ProfileEmbed
  }[]).map((r) => ({
    id: r.id,
    galleryId: r.gallery_id,
    status: r.status,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
    artist: toArtist(r.profiles, r.artist_id),
    submittedCount: byArtist.get(r.artist_id) ?? 0,
  }))
}

/** 招待の失敗理由。DBの例外文をそのまま出すと英語が画面に漏れるので、i18n キーに畳む。 */
export type InviteError = 'notFound' | 'self' | 'empty' | 'notYours' | 'unknown'

export function inviteErrorKey(e: unknown): InviteError {
  const m = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  if (m.includes('no such artist')) return 'notFound'
  if (m.includes('cannot invite yourself')) return 'self'
  if (m.includes('no handle given')) return 'empty'
  if (m.includes('not your room') || m.includes('no such room')) return 'notYours'
  return 'unknown'
}

/** `@ハンドル` で招く。ハンドル → id の解決とinsertを**DB側で1文にまとめてある**
 *  （2往復にすると、その間に相手がハンドルを変えたら別人を招いてしまう）。 */
export async function inviteArtistByHandle(galleryId: string, handle: string): Promise<void> {
  const { error } = await supabase!.rpc('invite_artist_by_handle', {
    p_gallery: galleryId,
    p_handle: handle,
  })
  if (error) throw new Error(error.message)
}

/** 招待を取り下げる。0041 のトリガが、その作家の提出と掛かっている作品も引き上げる。 */
export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase!.from('room_invites').delete().eq('id', inviteId)
  if (error) throw error
}

/** 0041 が未適用のDBか（表そのものが無い）。**通信の失敗と区別する**のが要点:
 *  表が無いなら「提出ゼロ」で正しいが、読めなかっただけなら**ゼロとして扱うと
 *  掛かっている他作家の作品を消してしまう**（`rebuildPlacements` は解決できた分だけを
 *  残して他を削除する）。 */
function missingSubmissionsTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const msg = (error.message ?? '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('room_submissions') ||
    msg.includes('schema cache')
  )
}

/** この部屋に**提出された他作家の作品**。配置トレイがこれを自分の作品に足して並べる。
 *  作者名は作品の所有者のものを使う（部屋の所有者ではない — DECISIONS 2026-08-09）。 */
export async function listSubmittedArtworks(galleryId: string): Promise<ArtworkData[]> {
  const { data, error } = await supabase!
    .from('room_submissions')
    .select('created_at, artworks (*, profiles (username, display_name))')
    .eq('gallery_id', galleryId)
    .order('created_at', { ascending: true })
  if (error) {
    // 0041 未適用なら提出は存在しない＝ゼロで正しい。それ以外は投げる（呼び手が
    // 破壊的な再構築に進まないように）。
    if (missingSubmissionsTable(error)) return []
    throw error
  }

  const out: ArtworkData[] = []
  for (const row of (data ?? []) as unknown as {
    artworks: (ArtworkRow & { profiles: { username: string | null; display_name: string | null } | null }) | null
  }[]) {
    const a = row.artworks
    if (!a) continue
    const name = a.profiles?.display_name || a.profiles?.username || ''
    out.push(rowToArtwork(a, name))
  }
  return out
}

/* ============================ 作家側 ============================ */

/** 自分宛の招待。辞退したものも返す（受信箱から消えると何が起きたか分からない）。
 *
 *  `artist_id` の絞りは飾りではない: `room_invites_owner_manage`(0037) は**部屋の
 *  所有者にも** その部屋の招待の SELECT を許すので、絞らないと**自分が出した招待が
 *  自分の受信箱に並ぶ**。しかも受諾ボタンを押すと `room_invites_artist_respond` が
 *  行を落として 0件更新＝エラーも出ないので、UIは成功したと言いながら何も起きない。
 *  この diff の `listMyArtworks` と同じ種類の取り違え（RLS が読ませる範囲 ≠
 *  この画面が意味する範囲）。 */
export async function listMyInvites(artistId: string): Promise<MyInvite[]> {
  const { data, error } = await supabase!
    .from('room_invites')
    .select('id, gallery_id, status, created_at, galleries (slug, title, is_public, owner_id, profiles (id, username, display_name, avatar_url))')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as unknown as {
    id: string
    gallery_id: string
    status: InviteStatus
    created_at: string
    galleries: {
      slug: string
      title: string
      is_public: boolean
      owner_id: string
      profiles: ProfileEmbed
    } | null
  }[]
  if (rows.length === 0) return []

  // 自分がどの部屋に何を出しているか。招待ごとに引くとN+1になるので1回で取る
  // （RLS が自分の提出だけに絞ってくれる）。
  // 同上。読めなかったのを「1点も出していない」と表示すると、作家は掛かっている
  // 自分の作品を取り下げたのかと思う。
  const { data: subs, error: subErr } = await supabase!
    .from('room_submissions')
    .select('gallery_id, artwork_id')
    .in('gallery_id', rows.map((r) => r.gallery_id))
  if (subErr && !missingSubmissionsTable(subErr)) throw subErr
  const byRoom = new Map<string, string[]>()
  for (const s of (subs ?? []) as { gallery_id: string; artwork_id: string }[]) {
    const list = byRoom.get(s.gallery_id)
    if (list) list.push(s.artwork_id)
    else byRoom.set(s.gallery_id, [s.artwork_id])
  }

  return rows.map((r) => ({
    id: r.id,
    galleryId: r.gallery_id,
    status: r.status,
    createdAt: r.created_at,
    room: {
      slug: r.galleries?.slug ?? '',
      title: r.galleries?.title ?? '',
      isPublic: r.galleries?.is_public ?? false,
      organizer: r.galleries ? toArtist(r.galleries.profiles, r.galleries.owner_id) : null,
    },
    submittedIds: byRoom.get(r.gallery_id) ?? [],
  }))
}

/** 受諾・辞退。辞退すると 0041 のトリガが提出も掛かっている作品も引き上げる
 *  ＝**いつでも降りられる**（同意が意味を持つのはこれがあるからで、UIの都合ではない）。 */
export async function respondToInvite(inviteId: string, accept: boolean): Promise<void> {
  const { error } = await supabase!
    .from('room_invites')
    .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', inviteId)
  if (error) throw error
}

/** この部屋に出す作品を選び直す。差分だけ書く（全消し→全入れにすると、掛かっている
 *  作品が一瞬 placement から落ちる＝0041 の取り下げトリガが発火して主催者の配置が壊れる）。 */
export async function setMySubmissions(galleryId: string, artworkIds: string[]): Promise<void> {
  const { data, error } = await supabase!
    .from('room_submissions')
    .select('artwork_id')
    .eq('gallery_id', galleryId)
  if (error) throw error

  const before = new Set(((data ?? []) as { artwork_id: string }[]).map((r) => r.artwork_id))
  const after = new Set(artworkIds)
  const added = artworkIds.filter((id) => !before.has(id))
  const removed = [...before].filter((id) => !after.has(id))

  if (added.length) {
    const { error: e } = await supabase!
      .from('room_submissions')
      .insert(added.map((artwork_id) => ({ gallery_id: galleryId, artwork_id })))
    if (e) throw e
  }
  if (removed.length) {
    const { error: e } = await supabase!
      .from('room_submissions')
      .delete()
      .eq('gallery_id', galleryId)
      .in('artwork_id', removed)
    if (e) throw e
  }
}
