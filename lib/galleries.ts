// Hakoniwa (gallery) CRUD — gallery_id-centric (REQUIREMENTS.md 10.2 / 10.9).
// The DB row is the source of truth for a signed-in user's space settings;
// the plan variable caps how many hakoniwa one user can own.
import { supabase } from './supabase'
import { PLAN, effectiveSlotCount } from './limits'
import { TEMPLATES, resolveLayout, normalizeLayoutParams, type CustomLayoutParams } from './presets'
import type { Settings } from './store'
import type { ArtworkData } from './artworks'

export interface GalleryRow {
  id: string
  slug: string
  title: string
  statement: string
  theme: string
  layout: string
  layout_params: Partial<CustomLayoutParams> | null
  frame_default: string
  hanging_default: string
  caption_default: string
  cover_artwork_id: string | null
  is_public: boolean
  updated_at: string | null
}

const COLS =
  'id, slug, title, statement, theme, layout, layout_params, frame_default, hanging_default, caption_default, cover_artwork_id, is_public, updated_at'

export async function listMyGalleries(userId: string): Promise<GalleryRow[]> {
  const { data, error } = await supabase!
    .from('galleries')
    .select(COLS)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as GalleryRow[]
}

/** The signed-in user's hakoniwa (first one; the release plan allows a single gallery) */
export async function getMyGalleryRow(userId: string): Promise<GalleryRow | null> {
  const rows = await listMyGalleries(userId)
  return rows[0] ?? null
}

export async function createGallery(
  userId: string,
  opts: { title: string; templateId?: string }
): Promise<GalleryRow> {
  const existing = await listMyGalleries(userId)
  if (existing.length >= PLAN.galleries) {
    throw new Error(`Your plan allows ${PLAN.galleries} hakoniwa.`)
  }
  const t = opts.templateId ? TEMPLATES[opts.templateId] : undefined
  const { data, error } = await supabase!
    .from('galleries')
    .insert({
      owner_id: userId,
      slug: 'main', // slug editing arrives with multi-gallery plans
      title: opts.title.trim() || 'My Gallery',
      ...(t
        ? {
            theme: t.theme,
            layout: t.layout,
            frame_default: t.frame,
            hanging_default: t.hanging,
            caption_default: t.caption,
          }
        : {}),
    })
    .select(COLS)
    .single()
  if (error) throw error
  return data as GalleryRow
}

export const SLUG_RE = /^[a-z0-9-]{1,40}$/

/** Change the public URL slug (/@username/[slug]). Unique per owner */
export async function updateGallerySlug(id: string, slug: string): Promise<void> {
  const clean = slug.trim().toLowerCase()
  if (!SLUG_RE.test(clean)) {
    throw new Error('URLs are 1–40 characters: lowercase letters, digits and hyphens.')
  }
  const { error } = await supabase!.from('galleries').update({ slug: clean }).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('You already use this URL for another hakoniwa.')
    throw error
  }
}

export async function renameGallery(id: string, title: string): Promise<void> {
  const { error } = await supabase!
    .from('galleries')
    .update({ title: title.trim() || 'My Gallery' })
    .eq('id', id)
  if (error) throw error
}

/** Deletes the hakoniwa (placements cascade; the works themselves stay in the library) */
export async function deleteGallery(id: string): Promise<void> {
  const { error } = await supabase!.from('galleries').delete().eq('id', id)
  if (error) throw error
}

/** Persist the space settings (theme/layout/framing/hanging/caption) to the gallery row */
export async function saveGallerySpace(id: string, s: Settings): Promise<void> {
  const fields: Record<string, unknown> = {
    theme: s.theme,
    layout: s.layout,
    frame_default: s.frame,
    hanging_default: s.hanging,
    caption_default: s.caption,
  }
  // Only overwrite layout_params while ON the custom layout — switching to a preset
  // must not destroy a saved custom room (switching back recovers it)
  if (s.layout === 'custom') fields.layout_params = s.layoutParams
  const { error } = await supabase!.from('galleries').update(fields).eq('id', id)
  if (error) throw error
}

/** Pick the work used for the OGP card / artist-page cover (null = slot 0) */
export async function setGalleryCover(id: string, artworkId: string | null): Promise<void> {
  const { error } = await supabase!.from('galleries').update({ cover_artwork_id: artworkId }).eq('id', id)
  if (error) throw error
}

/** Rebuild placements from the current works, capped at the plan's effective slot count.
 *  Upsert-then-trim (not delete-then-insert): a failure mid-way leaves stale extras,
 *  never an emptied public gallery. */
export async function rebuildPlacements(
  galleryId: string,
  settings: Settings,
  ownArtworks: ArtworkData[]
): Promise<void> {
  const sb = supabase!
  const slots = effectiveSlotCount(resolveLayout(settings.layout, settings.layoutParams).slots.length)
  const shown = ownArtworks.slice(0, slots)
  if (shown.length) {
    const rows = shown.map((art, i) => ({
      gallery_id: galleryId,
      artwork_id: art.id,
      slot_index: i,
      frame_override: settings.frameOverrides[art.id] ?? null,
    }))
    const { error } = await sb.from('placements').upsert(rows, { onConflict: 'gallery_id,slot_index' })
    if (error) throw error
  }
  const { error: dErr } = await sb
    .from('placements')
    .delete()
    .eq('gallery_id', galleryId)
    .gte('slot_index', shown.length)
  if (dErr) throw dErr
}

/** frame_override per artwork as stored in the placements — the cross-device record
 *  of per-work framing (local frameOverrides only exist in one browser) */
export async function fetchPlacementOverrides(galleryId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase!
    .from('placements')
    .select('artwork_id, frame_override')
    .eq('gallery_id', galleryId)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const r of data ?? []) if (r.frame_override) out[r.artwork_id] = r.frame_override
  return out
}

/** Toggle public. Turning public also (re)builds the placements so the page is complete */
export async function setGalleryPublic(
  row: GalleryRow,
  isPublic: boolean,
  settings: Settings,
  ownArtworks: ArtworkData[]
): Promise<void> {
  if (isPublic) await rebuildPlacements(row.id, settings, ownArtworks)
  const { error } = await supabase!.from('galleries').update({ is_public: isPublic }).eq('id', row.id)
  if (error) throw error
}

/** View a gallery row as Settings (for placement rebuilds initiated from the dashboard) */
export function rowToSettings(row: GalleryRow, frameOverrides: Record<string, string> = {}): Settings {
  return {
    theme: row.theme,
    layout: row.layout,
    layoutParams: normalizeLayoutParams(row.layout_params),
    frame: row.frame_default,
    hanging: row.hanging_default,
    caption: row.caption_default,
    showDemo: false,
    artworks: [],
    frameOverrides,
  }
}
