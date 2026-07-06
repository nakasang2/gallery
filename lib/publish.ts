// ギャラリーの公開(galleries + placements への書き込み)と、公開ページ用の読み出し
// 読み出しはサーバーコンポーネント(OGP生成)とクライアントの両方から使う
import { supabase } from './supabase'
import { rowToArtwork } from './cloud'
import type { ArtworkData } from './artworks'
import type { Settings } from './store'
import { LAYOUTS } from './presets'

export interface PublicExhibition {
  title: string
  statement: string
  ownerName: string
  username: string
  slug: string
  theme: string
  layout: string
  frame: string
  frameOverrides: Record<string, string>
  artworks: ArtworkData[]
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export async function setUsername(userId: string, username: string): Promise<void> {
  const { error } = await supabase!
    .from('profiles')
    .update({ username })
    .eq('id', userId)
  if (error) {
    if (error.code === '23505') throw new Error('このユーザー名は既に使われています')
    throw error
  }
}

/** 現在の空間設定と出展作品を galleries / placements に反映する(slugは当面 'main' 固定) */
export async function publishGallery(params: {
  userId: string
  title: string
  isPublic: boolean
  settings: Settings
  /** いま展示中の自分の作品(表示順) */
  ownArtworks: ArtworkData[]
}): Promise<void> {
  const sb = supabase!
  const { settings } = params

  const { data: gallery, error: gErr } = await sb
    .from('galleries')
    .upsert(
      {
        owner_id: params.userId,
        slug: 'main',
        title: params.title,
        theme: settings.theme,
        layout: settings.layout,
        frame_default: settings.frame,
        is_public: params.isPublic,
      },
      { onConflict: 'owner_id,slug' }
    )
    .select('id')
    .single()
  if (gErr) throw gErr

  // 配置を作り直す(スロット数で頭打ち)
  const slots = LAYOUTS[settings.layout].slots.length
  const shown = params.ownArtworks.slice(0, slots)
  const { error: dErr } = await sb.from('placements').delete().eq('gallery_id', gallery.id)
  if (dErr) throw dErr
  if (shown.length) {
    const rows = shown.map((art, i) => ({
      gallery_id: gallery.id,
      artwork_id: art.id,
      slot_index: i,
      frame_override: settings.frameOverrides[art.id] ?? null,
    }))
    const { error: pErr } = await sb.from('placements').insert(rows)
    if (pErr) throw pErr
  }
}

/** 自分の公開状態を取得(設定パネル表示用) */
export async function getMyGallery(userId: string) {
  const { data, error } = await supabase!
    .from('galleries')
    .select('title, is_public')
    .eq('owner_id', userId)
    .eq('slug', 'main')
    .maybeSingle()
  if (error) throw error
  return data
}

/** 公開ページ用: username + slug から展示一式を取得(非公開・不存在・取得失敗は null) */
export async function fetchPublicExhibition(
  username: string,
  slug: string
): Promise<PublicExhibition | null> {
  if (!supabase) return null
  try {
    return await fetchPublicExhibitionInner(username, slug)
  } catch (e) {
    console.error('fetchPublicExhibition failed:', e)
    return null
  }
}

async function fetchPublicExhibitionInner(
  username: string,
  slug: string
): Promise<PublicExhibition | null> {
  const { data: profile } = await supabase!
    .from('profiles')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  const { data: gallery } = await supabase!
    .from('galleries')
    .select('id, title, statement, theme, layout, frame_default, is_public')
    .eq('owner_id', profile.id)
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle()
  if (!gallery) return null

  const { data: placements } = await supabase!
    .from('placements')
    .select('slot_index, frame_override, artworks (*)')
    .eq('gallery_id', gallery.id)
    .order('slot_index', { ascending: true })

  const ownerName = profile.display_name || profile.username || ''
  const frameOverrides: Record<string, string> = {}
  const artworks: ArtworkData[] = []
  for (const p of placements ?? []) {
    const row = p.artworks as unknown as Parameters<typeof rowToArtwork>[0] | null
    if (!row) continue
    artworks.push(rowToArtwork(row, ownerName))
    if (p.frame_override) frameOverrides[row.id] = p.frame_override
  }

  return {
    title: gallery.title,
    statement: gallery.statement,
    ownerName,
    username: profile.username!,
    slug,
    theme: gallery.theme,
    layout: gallery.layout,
    frame: gallery.frame_default,
    frameOverrides,
    artworks,
  }
}
