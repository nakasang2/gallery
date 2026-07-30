// Publishing a gallery (writing to galleries + placements) and reading it for the public page
// The read path is used by both the server component (OGP generation) and the client
import { supabase } from './supabase'
import { rowToArtwork, artworkSrcSet } from './cloud'
import type { ArtworkData } from './artworks'
import {
  normalizeLayoutParams,
  normalizeDesignOverrides,
  type CustomLayoutParams,
  type DesignOverrides,
} from './presets'
import { PLAN } from './limits'

// SNS links (known platforms + custom) live in lib/sns.ts so both server code
// (this file, seo.ts) and client components can share them.
import { readSns, EMPTY_SNS, type SnsLinks, sanitizeSns } from './sns'
export { EMPTY_SNS, snsUrl, type SnsLinks } from './sns'

// Does this error mean migration 0035 (light_override) is missing? Gate the
// light-less retry on it, so a transient error doesn't silently drop the
// lighting overrides on a fully-migrated DB (レビュー指摘 2026-07-30).
function missingLightColumn(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === 'PGRST204' || e.code === '42703' || /light_override/.test(e.message ?? ''))
}

export interface PublicExhibition {
  galleryId: string
  title: string
  statement: string
  ownerName: string
  ownerAvatar: string | null
  ownerBio: string
  ownerSns: SnsLinks
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
  /** Looping ambient BGM track URL (§P3-12) — null when the owner set none */
  bgmUrl: string | null
  /** False when the artist has closed the guestbook (migration 0033). Defaults to
   *  true so rooms on a DB without 0033 behave exactly as before. */
  guestbookEnabled: boolean
  frameOverrides: Record<string, string>
  matOverrides: Record<string, string>
  hangingOverrides: Record<string, string>
  captionOverrides: Record<string, string>
  /** Per-work lighting override (migration 0035) — 'ceiling' | 'overhead' */
  lightOverrides: Record<string, string>
  /** This room's own work-slot cap (§11.5/§11.7) — the placements are already
   *  trimmed to it server-side; carried through so slotCount() agrees */
  workCap: number
  /** Design Tools overrides (§11.5/§11.8) — rendered for every visitor, not just the owner */
  designOverrides: DesignOverrides
  /** Manual slot placement (§11.13): arrangement[slotIndex] = artworkId | null,
   *  rebuilt from the placements' slot_index so visitors see the owner's layout */
  arrangement: (string | null)[]
  /** Cumulative visit count (§11.19) — drives the ambient past-visitor silhouettes */
  visitCount: number
  /** How many galleries this artist has open to the public, this one included.
   *  Exactly 1 means `/@name` renders THIS exhibition inline, so the two URLs are
   *  the same page and the canonical is `/@name` (docs/DECISIONS 2026-07-30 SEO).
   *  Fails soft to 1: with a broken count the worst case is a self-canonical page. */
  publicGalleryCount: number
  artworks: ArtworkData[]
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/** True when the exhibition has no real name — empty, or the old seeded default.
 *  Displays then lead with the ARTIST instead of a canned "My Gallery". */
export function isPlaceholderTitle(t?: string | null): boolean {
  const s = (t ?? '').trim()
  return !s || s === 'My Gallery'
}

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
  sns: SnsLinks
}

export async function getProfile(userId: string): Promise<ProfileFields> {
  const { data, error } = await supabase!
    .from('profiles')
    .select('display_name, bio, avatar_url, sns')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    displayName: data?.display_name ?? '',
    bio: data?.bio ?? '',
    avatarUrl: data?.avatar_url ?? null,
    sns: readSns(data?.sns),
  }
}

export async function saveProfile(
  userId: string,
  // sns is optional so the lightweight in-canvas editor (name + bio only) doesn't
  // have to round-trip it — omitting the key leaves the column untouched
  fields: Pick<ProfileFields, 'displayName' | 'bio'> & { sns?: SnsLinks }
): Promise<void> {
  const update: Record<string, unknown> = {
    display_name: fields.displayName.trim() || null,
    bio: fields.bio.trim(),
  }
  if (fields.sns) {
    update.sns = sanitizeSns(fields.sns)
  }
  const { error } = await supabase!.from('profiles').update(update).eq('id', userId)
  if (error) throw error
}

/* ---- Artist page (/@username) ---- */

export interface PublicProfile {
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  sns: SnsLinks
  galleries: {
    slug: string
    title: string
    statement: string
    /** Cover image URL (slot 0 work; decision 10.8-7) */
    cover: string | null
    /** thumb+card srcset for the cover, or null when we can't state widths honestly */
    coverSrcSet: string | null
    workCount: number
  }[]
}

/** Profile + public galleries list for /@username (null if the user doesn't exist or the fetch fails) */
export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  if (!supabase) return null
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, display_name, bio, avatar_url, sns')
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
      sns: readSns(profile.sns),
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
        // Cards render ~330px wide; hand them the 800px derivative when the work has
        // one (migration 0032) instead of the full display image, and fall back to
        // display.jpg for anything uploaded before that.
        cover: first ? (first.kind === 'video' ? first.poster ?? null : first.card ?? first.src ?? null) : null,
        coverSrcSet: first ? artworkSrcSet(first, 'card') ?? null : null,
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
    .select('id, username, display_name, avatar_url, bio, sns')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  let gRes = await supabase!
    .from('galleries')
    .select(
      'id, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public, work_cap, design_overrides, bgm_url, guestbook_enabled'
    )
    .eq('owner_id', profile.id)
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle()
  if (gRes.error) {
    // Migration 0027 (bgm_url) not applied — bgm_url is the newest column, drop it first
    gRes = (await supabase!
      .from('galleries')
      .select(
        'id, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public, work_cap, design_overrides'
      )
      .eq('owner_id', profile.id)
      .eq('slug', slug)
      .eq('is_public', true)
      .maybeSingle()) as unknown as typeof gRes
  }
  if (gRes.error) {
    // Migration 0014 (design_overrides) not applied
    gRes = (await supabase!
      .from('galleries')
      .select(
        'id, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public, work_cap'
      )
      .eq('owner_id', profile.id)
      .eq('slug', slug)
      .eq('is_public', true)
      .maybeSingle()) as unknown as typeof gRes
  }
  if (gRes.error) {
    // Migration 0013 (work_cap) not applied
    gRes = (await supabase!
      .from('galleries')
      .select(
        'id, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public'
      )
      .eq('owner_id', profile.id)
      .eq('slug', slug)
      .eq('is_public', true)
      .maybeSingle()) as unknown as typeof gRes
  }
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
    | (NonNullable<typeof gRes.data> & {
        mat_default?: string | null
        work_cap?: number | null
        design_overrides?: unknown
        bgm_url?: string | null
      })
    | null
  if (!gallery) return null

  let pRes = await supabase!
    .from('placements')
    .select('slot_index, frame_override, mat_override, hanging_override, caption_override, light_override, artworks (*)')
    .eq('gallery_id', gallery.id)
    .order('slot_index', { ascending: true })
  if (pRes.error && missingLightColumn(pRes.error)) {
    // Migration 0035 (light_override) not applied — the other four axes must survive
    pRes = (await supabase!
      .from('placements')
      .select('slot_index, frame_override, mat_override, hanging_override, caption_override, artworks (*)')
      .eq('gallery_id', gallery.id)
      .order('slot_index', { ascending: true })) as unknown as typeof pRes
  }
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
  const lightOverrides: Record<string, string> = {}
  const artworks: ArtworkData[] = []
  // Rebuild the manual arrangement (§11.13) from each placement's slot_index, so a
  // published room hangs works on the same walls (and keeps the same empty slots) the
  // owner arranged — not just packed from slot 0.
  const arrangement: (string | null)[] = []
  for (const p of (pRes.data ?? []) as Array<{
    slot_index?: number | null
    frame_override?: string | null
    mat_override?: string | null
    hanging_override?: string | null
    caption_override?: string | null
    light_override?: string | null
    artworks: unknown
  }>) {
    const row = p.artworks as Parameters<typeof rowToArtwork>[0] | null
    if (!row) continue
    artworks.push(rowToArtwork(row, ownerName))
    if (typeof p.slot_index === 'number' && p.slot_index >= 0) arrangement[p.slot_index] = row.id
    if (p.frame_override) frameOverrides[row.id] = p.frame_override
    if (p.mat_override) matOverrides[row.id] = p.mat_override
    if (p.hanging_override) hangingOverrides[row.id] = p.hanging_override
    if (p.caption_override) captionOverrides[row.id] = p.caption_override
    if (p.light_override) lightOverrides[row.id] = p.light_override
  }
  // Array holes (JS leaves them `undefined`) normalise to intentionally-empty slots.
  for (let i = 0; i < arrangement.length; i++) if (arrangement[i] == null) arrangement[i] = null

  // Cumulative visits for the ambient presence (§11.19). Aggregate-only RPC; fail soft
  // to 0 (older DBs without 0024 just show an empty room, which is fine).
  let visitCount = 0
  try {
    const { data: vc } = await supabase!.rpc('public_visit_count', { p_gallery: gallery.id })
    if (typeof vc === 'number' && Number.isFinite(vc)) visitCount = vc
  } catch {
    /* non-fatal */
  }

  // Which URL is canonical depends on whether `/@name` is this exhibition or a
  // listing (docs/DECISIONS 2026-07-30 SEO). `head: true` fetches no rows, so this
  // is the cheapest question we can ask — and we already hold `profile.id`.
  let publicGalleryCount = 1
  try {
    const { count } = await supabase!
      .from('galleries')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', profile.id)
      .eq('is_public', true)
    if (typeof count === 'number' && count > 0) publicGalleryCount = count
  } catch {
    /* non-fatal — a self-canonical page is a safe default */
  }

  return {
    galleryId: gallery.id,
    title: gallery.title,
    statement: gallery.statement,
    ownerName,
    ownerAvatar: profile.avatar_url ?? null,
    ownerBio: profile.bio ?? '',
    ownerSns: readSns(profile.sns),
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
    bgmUrl: gallery.bgm_url ?? null,
    // Absent column (pre-0033) means the guestbook was always open — keep that.
    guestbookEnabled: gallery.guestbook_enabled !== false,
    workCap: gallery.work_cap ?? PLAN.worksPerGallery,
    designOverrides: normalizeDesignOverrides(gallery.design_overrides),
    arrangement,
    visitCount,
    publicGalleryCount,
    frameOverrides,
    matOverrides,
    hangingOverrides,
    captionOverrides,
    lightOverrides,
    artworks,
  }
}

/** Owner-only private preview (client-side). Returns the SIGNED-IN viewer's OWN
 *  gallery at exactly their own handle, even when is_public = false — so an owner
 *  can walk their draft at its real public URL before publishing. Returns null
 *  for anyone who isn't the owner of a PRIVATE gallery at this username (public
 *  ones are already rendered by the server page, so we only surface private
 *  drafts here). Relies on the browser session + RLS (an owner can read their own
 *  rows). Self-contained on purpose: it never touches the public fetch path, and
 *  the prod DB is current so no legacy-migration fallbacks are needed. */
export async function fetchOwnExhibition(expectedUsername: string): Promise<PublicExhibition | null> {
  if (!supabase) return null
  try {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id
    if (!uid) return null

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio, sns')
      .eq('id', uid)
      .maybeSingle()
    // Only ever surface the viewer's OWN handle — never someone else's private room
    if (!profile || profile.username !== expectedUsername) return null

    const { data: gallery, error: gErr } = await supabase
      .from('galleries')
      .select(
        'id, slug, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public, work_cap, design_overrides, bgm_url, guestbook_enabled'
      )
      .eq('owner_id', uid)
      .eq('is_public', false) // public galleries are already shown by the server page
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (gErr || !gallery) return null

    let pRes = await supabase
      .from('placements')
      .select('slot_index, frame_override, mat_override, hanging_override, caption_override, light_override, artworks (*)')
      .eq('gallery_id', gallery.id)
      .order('slot_index', { ascending: true })
    if (pRes.error && missingLightColumn(pRes.error)) {
      // Migration 0035 (light_override) not applied — the other four axes must survive
      pRes = (await supabase
        .from('placements')
        .select('slot_index, frame_override, mat_override, hanging_override, caption_override, artworks (*)')
        .eq('gallery_id', gallery.id)
        .order('slot_index', { ascending: true })) as unknown as typeof pRes
    }
    if (pRes.error) return null
    const placements = pRes.data

    const ownerName = profile.display_name || profile.username || ''
    const frameOverrides: Record<string, string> = {}
    const matOverrides: Record<string, string> = {}
    const hangingOverrides: Record<string, string> = {}
    const captionOverrides: Record<string, string> = {}
    const lightOverrides: Record<string, string> = {}
    const artworks: ArtworkData[] = []
    const arrangement: (string | null)[] = []
    for (const p of (placements ?? []) as Array<{
      slot_index?: number | null
      frame_override?: string | null
      mat_override?: string | null
      hanging_override?: string | null
      caption_override?: string | null
      light_override?: string | null
      artworks: unknown
    }>) {
      const row = p.artworks as Parameters<typeof rowToArtwork>[0] | null
      if (!row) continue
      artworks.push(rowToArtwork(row, ownerName))
      if (typeof p.slot_index === 'number' && p.slot_index >= 0) arrangement[p.slot_index] = row.id
      if (p.frame_override) frameOverrides[row.id] = p.frame_override
      if (p.mat_override) matOverrides[row.id] = p.mat_override
      if (p.hanging_override) hangingOverrides[row.id] = p.hanging_override
      if (p.caption_override) captionOverrides[row.id] = p.caption_override
      if (p.light_override) lightOverrides[row.id] = p.light_override
    }
    for (let i = 0; i < arrangement.length; i++) if (arrangement[i] == null) arrangement[i] = null

    return {
      galleryId: gallery.id,
      title: gallery.title,
      statement: gallery.statement,
      ownerName,
      ownerAvatar: profile.avatar_url ?? null,
      ownerBio: profile.bio ?? '',
      ownerSns: readSns(profile.sns),
      username: profile.username!,
      slug: gallery.slug,
      theme: gallery.theme,
      layout: gallery.layout,
      layoutParams: normalizeLayoutParams(gallery.layout_params),
      frame: gallery.frame_default,
      mat: gallery.mat_default ?? 'auto',
      hanging: gallery.hanging_default ?? 'wire',
      caption: gallery.caption_default ?? 'side',
      coverArtworkId: gallery.cover_artwork_id ?? null,
      bgmUrl: gallery.bgm_url ?? null,
      // Absent column (pre-0033) means the guestbook was always open — keep that.
      guestbookEnabled: gallery.guestbook_enabled !== false,
      workCap: gallery.work_cap ?? PLAN.worksPerGallery,
      designOverrides: normalizeDesignOverrides(gallery.design_overrides),
      arrangement,
      visitCount: 0, // a private draft has no public visits to show
      // This path only ever returns a PRIVATE draft, which is never indexed and
      // never reached by a crawler — the value is unused, so state the truth.
      publicGalleryCount: 0,
      frameOverrides,
      matOverrides,
      hangingOverrides,
      captionOverrides,
      lightOverrides,
      artworks,
    }
  } catch (e) {
    console.error('fetchOwnExhibition failed:', e)
    return null
  }
}

/* ---- Explore feed (/explore) — every public galleries across the platform ---- */

export interface FeedItem {
  username: string
  ownerName: string
  ownerAvatar: string | null
  slug: string
  title: string
  /** Cover image URL (manually chosen work, else slot 0) */
  cover: string | null
  /** thumb+card srcset for the cover, or null when we can't state widths honestly */
  coverSrcSet: string | null
  workCount: number
}

export interface FeedPage {
  items: FeedItem[]
  hasMore: boolean
}

/** Cards per /explore page load (initial SSR page and each "Load more" tap) */
export const EXPLORE_PAGE_SIZE = 24

/** A page of the public galleries feed, newest-edited first. RLS already
 *  allows anon to read any is_public gallery / any profile (see 0001_init.sql).
 *  `supabase` runs the anon key everywhere, so this is safe to call from the
 *  browser too — that's what powers "Load more" without a separate API route. */
export async function fetchPublicFeed(offset = 0, limit = EXPLORE_PAGE_SIZE): Promise<FeedPage> {
  if (!supabase) return { items: [], hasMore: false }
  try {
    // Fetch one extra row so we know whether another page exists without a second round-trip.
    // updated_at ties (e.g. bulk-seeded rows) would otherwise let a row hop pages or repeat,
    // so id is a stable tiebreak.
    const { data: galleries, error } = await supabase
      .from('galleries')
      .select('id, slug, title, cover_artwork_id, updated_at, profiles (username, display_name, avatar_url)')
      .eq('is_public', true)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit)
    if (error) throw error

    const hasMore = (galleries ?? []).length > limit
    const page = (galleries ?? []).slice(0, limit)

    type OwnerProfile = { username: string | null; display_name: string | null; avatar_url: string | null }
    type Row = {
      id: string
      slug: string
      title: string
      cover_artwork_id: string | null
      profiles: unknown
    }
    const withOwner = (page as Row[]).map((g) => ({
      ...g,
      profiles: g.profiles as OwnerProfile | null,
    }))
    const items = await buildFeedItems(withOwner)
    return { items, hasMore }
  } catch (e) {
    console.error('fetchPublicFeed failed:', e)
    return { items: [], hasMore: false }
  }
}

// Shared shape for a gallery row that can become a FeedItem (fed by the public
// feed and the curated spotlight alike).
export type FeedGalleryRow = {
  id: string
  slug: string
  title: string
  cover_artwork_id: string | null
  profiles: { username: string | null; display_name: string | null; avatar_url: string | null } | null
}

/** Turn gallery rows (with embedded owner profile) into FeedItems: fetch their
 *  placements in one query, resolve each cover, drop rows with no public username.
 *  Preserves input order, so a curated list stays in its chosen order. */
async function buildFeedItems(rows: FeedGalleryRow[]): Promise<FeedItem[]> {
  if (!supabase) return []
  // Skip anyone who hasn't finished picking a username yet — there's no public URL to link to
  const named = rows.filter((g) => g.profiles?.username)
  if (!named.length) return []

  const { data: placementRows } = await supabase
    .from('placements')
    .select('gallery_id, slot_index, artworks (*)')
    .in('gallery_id', named.map((g) => g.id))
    .order('slot_index', { ascending: true })
  type PlacementRow = { gallery_id: string; artworks: unknown }
  const byGallery = new Map<string, Parameters<typeof rowToArtwork>[0][]>()
  for (const p of (placementRows ?? []) as PlacementRow[]) {
    const row = p.artworks as Parameters<typeof rowToArtwork>[0] | null
    if (!row) continue
    const list = byGallery.get(p.gallery_id) ?? []
    list.push(row)
    byGallery.set(p.gallery_id, list)
  }

  return named.map((g): FeedItem => {
    const ownerName = g.profiles!.display_name || g.profiles!.username || ''
    const artworkRows = byGallery.get(g.id) ?? []
    const coverRow = artworkRows.find((r) => r.id === g.cover_artwork_id) ?? artworkRows[0]
    const cover = coverRow ? rowToArtwork(coverRow, ownerName) : null
    return {
      username: g.profiles!.username!,
      ownerName,
      ownerAvatar: g.profiles!.avatar_url ?? null,
      slug: g.slug,
      title: g.title,
      cover: cover ? (cover.kind === 'video' ? cover.poster ?? null : cover.card ?? cover.src ?? null) : null,
      coverSrcSet: cover ? artworkSrcSet(cover, 'card') ?? null : null,
      workCount: artworkRows.length,
    }
  })
}

/** Resolve a curated list of (username, slug) refs to FeedItems, in the given
 *  order, keeping only the ones that are still public. Powers the Explore
 *  spotlight (企画展 / 特集). Refs whose gallery is unpublished or deleted just
 *  drop out, so a stale curation degrades gracefully rather than 404-ing. */
export async function fetchSpotlightGalleries(refs: { username: string; slug: string }[]): Promise<FeedItem[]> {
  if (!supabase || refs.length === 0) return []
  try {
    const usernames = [...new Set(refs.map((r) => r.username.toLowerCase()))]
    // !inner so we can filter on the embedded profile's username
    const { data, error } = await supabase
      .from('galleries')
      .select('id, slug, title, cover_artwork_id, profiles!inner (username, display_name, avatar_url)')
      .eq('is_public', true)
      .in('profiles.username', usernames)
    if (error || !data) return []

    const rows = (data as unknown as FeedGalleryRow[]).filter((g) => g.profiles?.username)
    const items = await buildFeedItems(rows)
    // Re-order to match the curation, matching on (username, slug)
    const key = (u: string, s: string) => `${u.toLowerCase()}/${s}`
    const byKey = new Map(items.map((it) => [key(it.username, it.slug), it]))
    const seen = new Set<string>()
    const ordered: FeedItem[] = []
    for (const r of refs) {
      const k = key(r.username, r.slug)
      const hit = byKey.get(k)
      if (hit && !seen.has(k)) {
        ordered.push(hit)
        seen.add(k)
      }
    }
    return ordered
  } catch (e) {
    console.error('fetchSpotlightGalleries failed:', e)
    return []
  }
}
