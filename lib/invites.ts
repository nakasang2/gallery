// 合同展示の招待と提出（migration 0047。0041 の部屋単位から**展示単位**へ載せ替えた）。
//
// 形は「主催者が招く → 作家が受諾する → **作家が出す作品を選ぶ** → 主催者が掛ける」。
// 主催者が相手のライブラリを漁る形（pull）にしなかったのは、合同展に誘われただけで
// 習作や未発表作まで他人に見える状態になるため。**見える範囲＝出すと決めた範囲**。
//
// **単位は展示（`expos`）。** 合同展示は部屋を複数ぶら下げられるので、部屋単位のままだと
// 主催者が2室目を作るたびに招き直しが必要になる（DECISIONS 2026-08-10）。作家が選ぶのは
// 「この展示に出す作品」で、どの部屋に掛けるかは主催者が決める。
//
// 権限はすべてDB側（0047 の RLS とトリガ）が持ち、ここは問い合わせるだけ。UIが状態を
// 読み違えても、書けるものは変わらない。
import { supabase } from './supabase'
import { rowToArtwork, type ArtworkRow } from './cloud'
import type { ArtworkData } from './artworks'

export type InviteStatus =
  /** 主催者が招いた。作家の返事待ち */
  | 'pending'
  /** **作家が希望を出した**（招待リンク経由。0048）。主催者の承認待ち */
  | 'requested'
  /** 参加確定。ここから作品を出せる */
  | 'accepted'
  /** 辞退（または希望の取り下げ） */
  | 'declined'

/** 招かれた相手（主催者の画面に出す）。 */
export interface InviteArtist {
  id: string
  username: string | null
  displayName: string
  avatarUrl: string | null
}

/** 主催者が見る1件。`submittedCount` は「その作家がこの展示に出した点数」。 */
export interface ExpoInvite {
  id: string
  expoId: string
  status: InviteStatus
  createdAt: string
  respondedAt: string | null
  artist: InviteArtist
  submittedCount: number
}

/** 作家が見る1件（自分宛の招待）。 */
export interface MyInvite {
  id: string
  expoId: string
  status: InviteStatus
  createdAt: string
  /** 招いてきた展示。0047 の `expos_select_invited` があるので**会期前でも読める**。 */
  expo: { slug: string; title: string; organizer: InviteArtist | null }
  /** この展示に出している自分の作品の id。 */
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

/**
 * 「表がまだ無い（0047 未適用）」だけを見分ける。**広く採ってはいけない** —
 * ここで true にすると呼び手は「提出ゼロ」として先に進み、`rebuildPlacements` の
 * 末尾の delete が**他作家の作品を壁から外す**（LESSONS 2026-08-09 の損失そのもの）。
 *
 * なので判定は**エラーコードだけ**に寄せる: `42P01`（undefined_table）と
 * `PGRST205`（PostgREST がスキーマキャッシュに表を見つけられない）。表名や
 * 'schema cache' の**文字列一致で拾ってはいけない** — ポリシー再帰や権限エラーまで
 * 「未適用」に見える（別視点レビューが検出 2026-08-09）。
 */
function missingSubmissionsTable(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205'
}

/* ============================ 主催者側 ============================ */

/** この展示の招待。`profiles` は `using (true)` なので埋め込みで引ける。 */
export async function listExpoInvites(expoId: string): Promise<ExpoInvite[]> {
  const { data, error } = await supabase!
    .from('expo_invites')
    .select('id, expo_id, artist_id, status, created_at, responded_at, profiles (id, username, display_name, avatar_url)')
    .eq('expo_id', expoId)
    .order('created_at', { ascending: true })
  if (error) throw error

  // 提出点数は別クエリで数える。埋め込みで取ろうとすると `expo_submissions` には
  // artist_id が無く（作品経由でしか作家に繋がらない）2段の埋め込みが要るため。
  // error を捨てると**読めなかったのが「0点提出」に見える**（招待中と区別がつかない）。
  const { data: subs, error: subErr } = await supabase!
    .from('expo_submissions')
    .select('artwork_id, artworks (owner_id)')
    .eq('expo_id', expoId)
  if (subErr && !missingSubmissionsTable(subErr)) throw subErr
  const byArtist = new Map<string, number>()
  for (const s of (subs ?? []) as unknown as { artworks: { owner_id: string } | null }[]) {
    const owner = s.artworks?.owner_id
    if (owner) byArtist.set(owner, (byArtist.get(owner) ?? 0) + 1)
  }

  return ((data ?? []) as unknown as {
    id: string
    expo_id: string
    artist_id: string
    status: InviteStatus
    created_at: string
    responded_at: string | null
    profiles: ProfileEmbed
  }[]).map((r) => ({
    id: r.id,
    expoId: r.expo_id,
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
  if (m.includes('not your exhibition') || m.includes('no such exhibition')) return 'notYours'
  return 'unknown'
}

/** `@ハンドル` で招く。ハンドル → id の解決とinsertを**DB側で1文にまとめてある**
 *  （2往復にすると、その間に相手がハンドルを変えたら別人を招いてしまう）。 */
export async function inviteArtistToExpo(expoId: string, handle: string): Promise<void> {
  const { error } = await supabase!.rpc('invite_artist_to_expo', {
    p_expo: expoId,
    p_handle: handle,
  })
  if (error) throw new Error(error.message)
}

/** 招待を取り下げる。0047 のトリガが、その作家の提出と掛かっている作品も引き上げる。 */
export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase!.from('expo_invites').delete().eq('id', inviteId)
  if (error) throw error
}

/**
 * **この部屋に掛けられる他作家の作品**（配置トレイがこれを自分の作品に足して並べる）。
 *
 * 提出は展示単位なので、部屋から展示を引いてから読む。**通常の部屋なら1往復で終わる**
 * （`expo_id` が null ＝ 他作家の作品が入る道が無い）。呼び手に展示idを渡させないのは、
 * `rebuildPlacements` の全経路がこれを通り、渡し忘れが**「公開したら他作家の作品だけ
 * 消える」**静かな損失になるため（LESSONS 2026-08-09。既定値が `[]` なので tsc も黙る）。
 *
 * 作者名は作品の所有者のものを使う（部屋の所有者ではない — DECISIONS 2026-08-09）。
 */
export async function listSubmittedArtworksForRoom(galleryId: string): Promise<ArtworkData[]> {
  const { data: room, error: rErr } = await supabase!
    .from('galleries')
    .select('expo_id')
    .eq('id', galleryId)
    .maybeSingle()
  // 0044 未適用（列が無い）なら合同展示は存在しない＝提出ゼロで正しい。
  if (rErr) {
    if (rErr.code === '42703' || missingSubmissionsTable(rErr)) return []
    throw rErr
  }
  const expoId = (room as { expo_id?: string | null } | null)?.expo_id ?? null
  if (!expoId) return []

  return listSubmittedArtworks(expoId)
}

/** この展示に提出された作品（主催者向け。0047 の `artworks_select_submitted_to_my_expo`
 *  があるので中身まで読める）。 */
export async function listSubmittedArtworks(expoId: string): Promise<ArtworkData[]> {
  const { data, error } = await supabase!
    .from('expo_submissions')
    .select('created_at, artworks (*, profiles (username, display_name))')
    .eq('expo_id', expoId)
    .order('created_at', { ascending: true })
  if (error) {
    // 0047 未適用なら提出は存在しない＝ゼロで正しい。それ以外は投げる（呼び手が
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
 *  `artist_id` の絞りは飾りではない: `expo_invites_owner_read`(0047) は**展示の
 *  主催者にも** その展示の招待の SELECT を許すので、絞らないと**自分が出した招待が
 *  自分の受信箱に並ぶ**。しかも受諾ボタンを押すと `expo_invites_artist_respond` が
 *  行を落として 0件更新＝エラーも出ないので、UIは成功したと言いながら何も起きない
 *  （RLS が読ませる範囲 ≠ この画面が意味する範囲）。 */
export async function listMyInvites(artistId: string): Promise<MyInvite[]> {
  const { data, error } = await supabase!
    .from('expo_invites')
    .select('id, expo_id, status, created_at, expos (slug, title, owner_id, profiles (id, username, display_name, avatar_url))')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as unknown as {
    id: string
    expo_id: string
    status: InviteStatus
    created_at: string
    expos: {
      slug: string
      title: string
      owner_id: string
      profiles: ProfileEmbed
    } | null
  }[]
  if (rows.length === 0) return []

  // 自分がどの展示に何を出しているか。招待ごとに引くとN+1になるので1回で取る
  // （RLS が自分の提出だけに絞ってくれる）。読めなかったのを「1点も出していない」と
  // 表示すると、作家は掛かっている自分の作品を取り下げたのかと思う。
  const { data: subs, error: subErr } = await supabase!
    .from('expo_submissions')
    .select('expo_id, artwork_id')
    .in('expo_id', rows.map((r) => r.expo_id))
  if (subErr && !missingSubmissionsTable(subErr)) throw subErr
  const byExpo = new Map<string, string[]>()
  for (const s of (subs ?? []) as { expo_id: string; artwork_id: string }[]) {
    const list = byExpo.get(s.expo_id)
    if (list) list.push(s.artwork_id)
    else byExpo.set(s.expo_id, [s.artwork_id])
  }

  return rows.map((r) => ({
    id: r.id,
    expoId: r.expo_id,
    status: r.status,
    createdAt: r.created_at,
    expo: {
      slug: r.expos?.slug ?? '',
      title: r.expos?.title ?? '',
      organizer: r.expos ? toArtist(r.expos.profiles, r.expos.owner_id) : null,
    },
    submittedIds: byExpo.get(r.expo_id) ?? [],
  }))
}

/* ============================ 招待リンク（0048） ============================ */

/**
 * 配れるURL。**トークンはサーバが決める**（クライアントが弱い値を選べない）。
 * 返るのはトークンだけなので、URLの組み立ては `inviteLinkPath()` が1か所で行う。
 */
export async function createInviteLink(expoId: string): Promise<string> {
  const { data, error } = await supabase!.rpc('create_expo_invite_link', { p_expo: expoId })
  if (error) throw new Error(error.message)
  const token = typeof data === 'string' ? data : ''
  if (!token) throw new Error('No token returned.')
  return token
}

export interface InviteLink {
  id: string
  token: string
  revokedAt: string | null
  createdAt: string
}

/** その展示のリンク。**主催者にしか見えない**（0048 のポリシー）。 */
export async function listInviteLinks(expoId: string): Promise<InviteLink[]> {
  const { data, error } = await supabase!
    .from('expo_invite_links')
    .select('id, token, revoked_at, created_at')
    .eq('expo_id', expoId)
    .order('created_at', { ascending: false })
  if (error) {
    // 0048 未適用なら「リンクはまだ無い」と同じ扱い（合同展示タブ全体を落とさない）。
    if (missingSubmissionsTable(error)) return []
    throw error
  }
  return ((data ?? []) as { id: string; token: string; revoked_at: string | null; created_at: string }[]).map(
    (r) => ({ id: r.id, token: r.token, revokedAt: r.revoked_at, createdAt: r.created_at })
  )
}

/** リンクを止める。**行は消さない** — いつ止めたかを残す（0048）。 */
export async function revokeInviteLink(linkId: string): Promise<void> {
  const { error } = await supabase!
    .from('expo_invite_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
  if (error) throw error
}

/** リンクのURL。**組み立てはここだけ**（配る文字列と受け取るルートが食い違わないように）。 */
export function inviteLinkPath(token: string): string {
  return `/join/${token}`
}

/** リンク先で見せる展示。**部屋も作品も返らない** — リンクは案内で、中身の先行公開ではない。 */
export interface JoinTarget {
  expoId: string
  slug: string
  title: string
  statement: string
  startsAt: string | null
  endsAt: string | null
  organizerName: string
  organizerUsername: string | null
  /** 自分の招待の状態。未ログイン、または関わりが無ければ null。 */
  myStatus: InviteStatus | null
}

/**
 * トークンから展示を引く。**未ログインでも呼べる**（`security definer`）。
 * 無効なトークン・止めたリンクは null（「無効」と「存在しない」を区別しない ──
 * 区別すると総当たりで有効なトークンを探せる）。
 */
export async function fetchJoinTarget(token: string): Promise<JoinTarget | null> {
  const { data, error } = await supabase!.rpc('expo_by_invite_token', { p_token: token })
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        expo_id: string
        slug: string
        title: string | null
        statement: string | null
        starts_at: string | null
        ends_at: string | null
        organizer_name: string | null
        organizer_username: string | null
        my_status: string | null
      }
    | undefined
  if (!row) return null
  return {
    expoId: row.expo_id,
    slug: row.slug,
    title: row.title ?? '',
    statement: row.statement ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    organizerName: row.organizer_name ?? '',
    organizerUsername: row.organizer_username,
    myStatus: (row.my_status as InviteStatus | null) ?? null,
  }
}

/**
 * 「参加したい」を出す。**これは権限を1つも増やさない** — 主催者が承認するまで
 * `accepted` にならず、作品は1点も出せない（0048）。
 * 返るのは結果の状態（画面がそのまま文言を選べる）。
 */
export async function requestInvite(token: string): Promise<InviteStatus> {
  const { data, error } = await supabase!.rpc('request_expo_invite', { p_token: token })
  if (error) throw new Error(error.message)
  return (typeof data === 'string' ? data : 'requested') as InviteStatus
}

/** 参加希望を承認する。**招待（pending）には使えない** — あれは作家の意思表示なので
 *  主催者が代わりに受諾できない（0048 が弾く）。 */
export async function approveRequest(inviteId: string): Promise<void> {
  const { error } = await supabase!.rpc('approve_expo_request', { p_invite: inviteId })
  if (error) throw new Error(error.message)
}

/** 受諾・辞退。辞退すると 0047 のトリガが提出も掛かっている作品も引き上げる
 *  ＝**いつでも降りられる**（同意が意味を持つのはこれがあるからで、UIの都合ではない）。 */
export async function respondToInvite(inviteId: string, accept: boolean): Promise<void> {
  const { error } = await supabase!
    .from('expo_invites')
    .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', inviteId)
  if (error) throw error
}

/** この展示に出す作品を選び直す。差分だけ書く（全消し→全入れにすると、掛かっている
 *  作品が一瞬 placement から落ちる＝0047 の取り下げトリガが発火して主催者の配置が壊れる）。 */
export async function setMySubmissions(expoId: string, artworkIds: string[]): Promise<void> {
  const { data, error } = await supabase!
    .from('expo_submissions')
    .select('artwork_id')
    .eq('expo_id', expoId)
  if (error) throw error

  const before = new Set(((data ?? []) as { artwork_id: string }[]).map((r) => r.artwork_id))
  const after = new Set(artworkIds)
  const added = artworkIds.filter((id) => !before.has(id))
  const removed = [...before].filter((id) => !after.has(id))

  if (added.length) {
    const { error: e } = await supabase!
      .from('expo_submissions')
      .insert(added.map((artwork_id) => ({ expo_id: expoId, artwork_id })))
    if (e) throw e
  }
  if (removed.length) {
    const { error: e } = await supabase!
      .from('expo_submissions')
      .delete()
      .eq('expo_id', expoId)
      .in('artwork_id', removed)
    if (e) throw e
  }
}
