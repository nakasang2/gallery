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
  opts: { title: string; templateId?: string; statement?: string }
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
      statement: opts.statement?.trim() ?? '',
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

/** Change the public URL slug (/@username/[slug]). Unique per owner.
 *  NOTE: no UI calls this while the plan allows a single hakoniwa — the shared
 *  URL is just /@username. Kept for the multi-gallery future. */
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

/** Title + statement together: the exhibition's name and the concept/intro text
 *  shown on the title wall, the artist page and OGP descriptions */
export async function updateGalleryDetails(
  id: string,
  fields: { title: string; statement: string }
): Promise<void> {
  const { error } = await supabase!
    .from('galleries')
    .update({ title: fields.title.trim() || 'My Gallery', statement: fields.statement.trim() })
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

// Does this error mean migration 0011 (hanging/caption override columns) is missing?
function missingOverrideColumns(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    /hanging_override|caption_override/.test(error.message ?? '')
  )
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
      hanging_override: settings.hangingOverrides[art.id] ?? null,
      caption_override: settings.captionOverrides[art.id] ?? null,
    }))
    let { error } = await sb.from('placements').upsert(rows, { onConflict: 'gallery_id,slot_index' })
    if (error && missingOverrideColumns(error)) {
      // Migration 0011 not applied yet — keep publishing working, frame-only
      const legacy = rows.map(({ gallery_id, artwork_id, slot_index, frame_override }) => ({
        gallery_id,
        artwork_id,
        slot_index,
        frame_override,
      }))
      ;({ error } = await sb.from('placements').upsert(legacy, { onConflict: 'gallery_id,slot_index' }))
    }
    if (error) throw error
  }
  const { error: dErr } = await sb
    .from('placements')
    .delete()
    .eq('gallery_id', galleryId)
    .gte('slot_index', shown.length)
  if (dErr) throw dErr
}

/** Per-work design overrides (keyed by artwork id) as stored in the placements —
 *  the cross-device record; the local Settings maps only exist in one browser */
export interface PlacementOverrides {
  frames: Record<string, string>
  hangings: Record<string, string>
  captions: Record<string, string>
}

export const EMPTY_OVERRIDES: PlacementOverrides = { frames: {}, hangings: {}, captions: {} }

export async function fetchPlacementOverrides(galleryId: string): Promise<PlacementOverrides> {
  let res = await supabase!
    .from('placements')
    .select('artwork_id, frame_override, hanging_override, caption_override')
    .eq('gallery_id', galleryId)
  if (res.error && missingOverrideColumns(res.error)) {
    // Migration 0011 not applied yet — frame overrides still work
    res = (await supabase!
      .from('placements')
      .select('artwork_id, frame_override')
      .eq('gallery_id', galleryId)) as unknown as typeof res
  }
  if (res.error) throw res.error
  const out: PlacementOverrides = { frames: {}, hangings: {}, captions: {} }
  for (const r of (res.data ?? []) as Array<{
    artwork_id: string
    frame_override?: string | null
    hanging_override?: string | null
    caption_override?: string | null
  }>) {
    if (r.frame_override) out.frames[r.artwork_id] = r.frame_override
    if (r.hanging_override) out.hangings[r.artwork_id] = r.hanging_override
    if (r.caption_override) out.captions[r.artwork_id] = r.caption_override
  }
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
export function rowToSettings(row: GalleryRow, overrides: PlacementOverrides = EMPTY_OVERRIDES): Settings {
  return {
    theme: row.theme,
    layout: row.layout,
    layoutParams: normalizeLayoutParams(row.layout_params),
    frame: row.frame_default,
    hanging: row.hanging_default,
    caption: row.caption_default,
    showDemo: false,
    artworks: [],
    frameOverrides: overrides.frames,
    hangingOverrides: overrides.hangings,
    captionOverrides: overrides.captions,
  }
}
