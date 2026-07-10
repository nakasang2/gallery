// Publishing a gallery (writing to galleries + placements) and reading it for the public page
// The read path is used by both the server component (OGP generation) and the client
import { supabase } from './supabase'
import { rowToArtwork } from './cloud'
import type { ArtworkData } from './artworks'
import { normalizeLayoutParams, type CustomLayoutParams } from './presets'

export interface PublicExhibition {
  galleryId: string
  title: string
  statement: string
  ownerName: string
  ownerAvatar: string | null
  username: string
  slug: string
  theme: string
  layout: string
  layoutParams: CustomLayoutParams
  frame: string
  mat: string
  hanging: string
  caption: string
  coverArtworkId: string | null
  frameOverrides: Record<string, string>
  matOverrides: Record<string, string>
  hangingOverrides: Record<string, string>
  captionOverrides: Record<string, string>
  artworks: ArtworkData[]
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export async function setUsername(userId: string, username: string): Promise<void> {
  const { error } = await supabase!
    .from('profiles')
    .update({ username })
    .eq('id', userId)
  if (error) {
    if (error.code === '23505') throw new Error('This username is already taken')
    throw error
  }
}

export interface ProfileFields {
  displayName: string
  bio: string
  avatarUrl: string | null
}

export async function getProfile(userId: string): Promise<ProfileFields> {
  const { data, error } = await supabase!
    .from('profiles')
    .select('display_name, bio, avatar_url')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    displayName: data?.display_name ?? '',
    bio: data?.bio ?? '',
    avatarUrl: data?.avatar_url ?? null,
  }
}

export async function saveProfile(
  userId: string,
  fields: Pick<ProfileFields, 'displayName' | 'bio'>
): Promise<void> {
  const { error } = await supabase!
    .from('profiles')
    .update({ display_name: fields.displayName.trim() || null, bio: fields.bio.trim() })
    .eq('id', userId)
  if (error) throw error
}

/* ---- Artist page (/@username) ---- */

export interface PublicProfile {
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  galleries: {
    slug: string
    title: string
    statement: string
    /** Cover image URL (slot 0 work; decision 10.8-7) */
    cover: string | null
    workCount: number
  }[]
}

/** Profile + public hakoniwa list for /@username (null if the user doesn't exist or the fetch fails) */
export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  if (!supabase) return null
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, display_name, bio, avatar_url')
      .eq('username', username)
      .maybeSingle()
    if (!profile) return null

    const { data: galleries } = await supabase
      .from('galleries')
      .select('id, slug, title, statement, cover_artwork_id')
      .eq('owner_id', profile.id)
      .eq('is_public', true)
      .order('created_at', { ascending: true })

    const out: PublicProfile = {
      username: profile.username!,
      displayName: profile.display_name || profile.username || '',
      bio: profile.bio ?? '',
      avatarUrl: profile.avatar_url ?? null,
      galleries: [],
    }
    for (const g of galleries ?? []) {
      const { data: placements } = await supabase
        .from('placements')
        .select('slot_index, artworks (*)')
        .eq('gallery_id', g.id)
        .order('slot_index', { ascending: true })
      const rows = (placements ?? [])
        .map((p) => p.artworks as unknown as Parameters<typeof rowToArtwork>[0] | null)
        .filter(Boolean)
      // Cover: the manually chosen work if it hangs here, otherwise slot 0 (decision 10.8-7)
      const coverRow = rows.find((r) => r!.id === g.cover_artwork_id) ?? rows[0]
      const first = coverRow ? rowToArtwork(coverRow, out.displayName) : null
      out.galleries.push({
        slug: g.slug,
        title: g.title,
        statement: g.statement,
        cover: first ? (first.kind === 'video' ? first.poster ?? null : first.src ?? null) : null,
        workCount: rows.length,
      })
    }
    return out
  } catch (e) {
    console.error('fetchPublicProfile failed:', e)
    return null
  }
}

/** For the public page: fetch the full exhibition from username + slug (null if private, missing, or the fetch fails) */
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
    .select('id, username, display_name, avatar_url')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  let gRes = await supabase!
    .from('galleries')
    .select(
      'id, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public'
    )
    .eq('owner_id', profile.id)
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle()
  if (gRes.error) {
    // Migration 0012 (mat) not applied — the public page must still render
    gRes = (await supabase!
      .from('galleries')
      .select(
        'id, title, statement, theme, layout, layout_params, frame_default, hanging_default, caption_default, cover_artwork_id, is_public'
      )
      .eq('owner_id', profile.id)
      .eq('slug', slug)
      .eq('is_public', true)
      .maybeSingle()) as unknown as typeof gRes
  }
  const gallery = gRes.data as
    | (NonNullable<typeof gRes.data> & { mat_default?: string | null })
    | null
  if (!gallery) return null

  let pRes = await supabase!
    .from('placements')
    .select('slot_index, frame_override, mat_override, hanging_override, caption_override, artworks (*)')
    .eq('gallery_id', gallery.id)
    .order('slot_index', { ascending: true })
  if (pRes.error) {
    // Migration 0011/0012 (per-work overrides) not applied — the page must still render
    pRes = (await supabase!
      .from('placements')
      .select('slot_index, frame_override, artworks (*)')
      .eq('gallery_id', gallery.id)
      .order('slot_index', { ascending: true })) as unknown as typeof pRes
  }
  if (pRes.error) throw pRes.error

  const ownerName = profile.display_name || profile.username || ''
  const frameOverrides: Record<string, string> = {}
  const matOverrides: Record<string, string> = {}
  const hangingOverrides: Record<string, string> = {}
  const captionOverrides: Record<string, string> = {}
  const artworks: ArtworkData[] = []
  for (const p of (pRes.data ?? []) as Array<{
    frame_override?: string | null
    mat_override?: string | null
    hanging_override?: string | null
    caption_override?: string | null
    artworks: unknown
  }>) {
    const row = p.artworks as Parameters<typeof rowToArtwork>[0] | null
    if (!row) continue
    artworks.push(rowToArtwork(row, ownerName))
    if (p.frame_override) frameOverrides[row.id] = p.frame_override
    if (p.mat_override) matOverrides[row.id] = p.mat_override
    if (p.hanging_override) hangingOverrides[row.id] = p.hanging_override
    if (p.caption_override) captionOverrides[row.id] = p.caption_override
  }

  return {
    galleryId: gallery.id,
    title: gallery.title,
    statement: gallery.statement,
    ownerName,
    ownerAvatar: profile.avatar_url ?? null,
    username: profile.username!,
    slug,
    theme: gallery.theme,
    layout: gallery.layout,
    layoutParams: normalizeLayoutParams(gallery.layout_params),
    frame: gallery.frame_default,
    // Older galleries predate these columns; fall back to sensible defaults
    mat: gallery.mat_default ?? 'auto',
    hanging: gallery.hanging_default ?? 'wire',
    caption: gallery.caption_default ?? 'side',
    coverArtworkId: gallery.cover_artwork_id ?? null,
    frameOverrides,
    matOverrides,
    hangingOverrides,
    captionOverrides,
    artworks,
  }
}
