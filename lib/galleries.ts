// Gallery CRUD — gallery_id-centric (REQUIREMENTS.md 10.2 / 10.9).
// The DB row is the source of truth for a signed-in user's space settings;
// the plan variable caps how many galleries one user can own.
import { supabase } from './supabase'
import { PLAN, capForNewRoom, effectiveSlotCount, roomAllowance } from './limits'
import {
  TEMPLATES,
  resolveLayout,
  normalizeLayoutParams,
  normalizeDesignOverrides,
  normalizeArrangement,
  type CustomLayoutParams,
  type DesignOverrides,
} from './presets'
import { placeWorks, balancedFillOrder } from './arrangement'
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
  mat_default: string
  hanging_default: string
  caption_default: string
  cover_artwork_id: string | null
  is_public: boolean
  updated_at: string | null
  /** This room's own work-slot cap, fixed at creation time (§11.5/§11.7) */
  work_cap: number
  /** Design Tools overrides (§11.5/§11.8), jsonb — null on pre-0014 rows */
  design_overrides: unknown
  /** Manual slot placement (§11.13), jsonb array — null on pre-0023 rows */
  arrangement: unknown
  /** Looping ambient BGM track URL (§P3-12), text — null/absent on pre-0027 rows */
  bgm_url?: string | null
  /** Whether visitors may sign the guestbook — absent on pre-0033 rows, where the
   *  guestbook was always on and could not be closed. */
  guestbook_enabled?: boolean | null
  /** The room `/@username` itself renders — the front door of a multi-room show
   *  (migration 0036). Absent/false on pre-0036 rows, where a single room needed
   *  no designation; `mainRoomOf()` falls back to the oldest room so those keep
   *  behaving exactly as before. */
  is_main?: boolean | null
}

const COLS =
  'id, slug, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public, updated_at, work_cap, design_overrides, arrangement, bgm_url, guestbook_enabled, is_main'
// Newest column first when degrading against a DB that hasn't applied 0036.
const COLS_NO_MAIN = COLS.replace(', is_main', '')
// Post-0033/pre-0036 shape (no is_main column yet)
const COLS_NO_GB = COLS_NO_MAIN.replace(', guestbook_enabled', '')
// Post-0023/pre-0027 shape (no bgm_url column yet)
const COLS_NO_BGM = COLS_NO_GB.replace(', bgm_url', '')
// Post-0014/pre-0023 shape (no arrangement column yet)
const COLS_NO_ARR = COLS_NO_BGM.replace(', arrangement', '')
// Post-0013/pre-0014 shape (no design_overrides column yet)
const COLS_NO_DESIGN = COLS_NO_ARR.replace(', design_overrides', '')
// Post-0012/pre-0013 shape (no work_cap column yet)
const COLS_NO_CAP = COLS_NO_DESIGN.replace(', work_cap', '')
// Pre-0012 shape (no mat, no work_cap, no design_overrides) — reads fall back to this so an
// unapplied migration never breaks the dashboard; mat then defaults to 'auto', cap to the plan default
const LEGACY_COLS = COLS_NO_CAP.replace('mat_default, ', '')

export async function listMyGalleries(userId: string): Promise<GalleryRow[]> {
  let res = await supabase!
    .from('galleries')
    .select(COLS)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
  if (res.error && missingOverrideColumns(res.error)) {
    // 0036 (is_main) not applied — the oldest room stays the front door
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_MAIN)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0033 (guestbook_enabled) not applied
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_GB)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0027 (bgm_url) not applied
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_BGM)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0023 (arrangement) not applied
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_ARR)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_DESIGN)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_CAP)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    res = (await supabase!
      .from('galleries')
      .select(LEGACY_COLS)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error) throw res.error
  return (res.data ?? []).map((r) => ({
    ...(r as object),
    mat_default: (r as { mat_default?: string }).mat_default ?? 'auto',
    work_cap: (r as { work_cap?: number }).work_cap ?? PLAN.worksPerGallery,
    design_overrides: (r as { design_overrides?: unknown }).design_overrides ?? null,
    arrangement: (r as { arrangement?: unknown }).arrangement ?? null,
  })) as GalleryRow[]
}

/**
 * The room that `/@username` renders — the front door of the show.
 *
 * The flagged room (migration 0036) when there is one, otherwise the FIRST room in
 * the list. `listMyGalleries` orders by `created_at`, so on a pre-0036 database (or
 * before anyone has picked) this is the oldest room: exactly what `/@username`
 * rendered when a user could only own one. Pass a filtered list to scope the answer
 * (visitors get only the public rooms).
 */
export function mainRoomOf<T extends { is_main?: boolean | null }>(rooms: T[]): T | null {
  return rooms.find((r) => r.is_main) ?? rooms[0] ?? null
}

/** The signed-in user's front-door room (see `mainRoomOf`). */
export async function getMyGalleryRow(userId: string): Promise<GalleryRow | null> {
  return mainRoomOf(await listMyGalleries(userId))
}

/** A URL-safe slug from a room title, or '' when the title yields nothing usable. */
function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/** A slug this owner is not using yet. The first room keeps 'main' (the historical
 *  value, and the one `/@username` used to be built on); later rooms take their
 *  title, falling back to room-2, room-3… and suffixing on collision. */
function freeSlug(title: string, taken: Set<string>, roomNumber: number): string {
  const base = roomNumber === 1 ? 'main' : slugifyTitle(title) || `room-${roomNumber}`
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 37)}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  // 99 rooms sharing one title is not a real case; a timestamp still beats throwing.
  return `${base.slice(0, 33)}-${Date.now().toString(36).slice(-6)}`
}

export async function createGallery(
  userId: string,
  opts: { title: string; templateId?: string; statement?: string; roomsPurchased?: number }
): Promise<GalleryRow> {
  const existing = await listMyGalleries(userId)
  const allowance = roomAllowance(opts.roomsPurchased ?? 0)
  if (existing.length >= allowance) {
    throw new Error(`Your plan allows ${allowance} ${allowance === 1 ? 'room' : 'rooms'}.`)
  }
  // Default new rooms to the "studio" template (whitecube / corridor) — the free
  // tier's theme + layout — so a free gallery never starts on paid content (the
  // DB column default is the older chic/hall, which only paying users can keep).
  // A bought room is no exception: the room price does not include a theme or a
  // layout (ユーザー決定 2026-08-09), and anything the owner already bought is
  // account-wide, so they can switch to it right away at no extra cost.
  const t = TEMPLATES[opts.templateId ?? 'studio'] ?? TEMPLATES.studio
  const firstRoom = existing.length === 0
  const row = {
    owner_id: userId,
    slug: freeSlug(opts.title, new Set(existing.map((g) => g.slug)), existing.length + 1),
    // An empty title is fine — displays lead with the artist instead of a canned name
    title: opts.title.trim(),
    statement: opts.statement?.trim() ?? '',
    // Capacity is fixed at creation time (§11.7 — "the room inherits the plan's cap
    // at purchase time"), not the column's own default (which only exists to
    // grandfather pre-0013 rooms). The free first room starts at the plan's 5; every
    // room after it exists because one was bought, and that price includes the
    // room's full capacity, so it starts at the physical max.
    work_cap: capForNewRoom(existing.length),
    // The first room is the front door by default. Later rooms never steal it —
    // the partial unique index in 0036 would reject a second main anyway.
    is_main: firstRoom,
    // A NEW room opens empty. An unset arrangement means "auto-fill from slot 0"
    // (lib/arrangement), which is right for the first room — you upload works and they
    // hang themselves — but wrong for every room after it: the account already has a
    // library, so a just-bought room would open pre-hung with the works from the room
    // next door, and the new doorway would walk visitors into a duplicate show. An
    // array of explicit nulls is the "intentionally empty" state (§11.13), so the owner
    // chooses what goes on these walls.
    arrangement: firstRoom ? null : new Array(resolveLayout(t.layout, null).slots.length).fill(null),
    theme: t.theme,
    layout: t.layout,
    frame_default: t.frame,
    hanging_default: t.hanging,
    caption_default: t.caption,
  }
  let res = await supabase!.from('galleries').insert(row).select(COLS).single()
  if (res.error && missingOverrideColumns(res.error)) {
    // 0036 not applied — no is_main column to write; the oldest room stays the front door
    const { is_main: _isMain, ...rowNoMain } = row
    res = (await supabase!.from('galleries').insert(rowNoMain).select(COLS_NO_MAIN).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0023 not applied — no arrangement column to write, so a new room falls back to
    // auto-fill there (the pre-0023 behaviour) instead of opening empty
    const { is_main: _isMain, arrangement: _arr, ...rowNoArr } = row
    res = (await supabase!.from('galleries').insert(rowNoArr).select(COLS_NO_ARR).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0014 not applied — design_overrides was never in the insert payload,
    // only the ?select= shape needs to shrink
    const { is_main: _isMain, arrangement: _arr, ...rowNoDesign } = row
    res = (await supabase!.from('galleries').insert(rowNoDesign).select(COLS_NO_DESIGN).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0013 not applied — an unknown column in the insert payload fails before it runs
    const { work_cap: _workCap, is_main: _isMain, arrangement: _arr, ...rowNoCap } = row
    res = (await supabase!.from('galleries').insert(rowNoCap).select(COLS_NO_CAP).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0012 not applied either — mat_default was never in the insert payload,
    // only the ?select= shape needs to shrink further
    const { work_cap: _workCap, is_main: _isMain, arrangement: _arr, ...rowLegacy } = row
    res = (await supabase!.from('galleries').insert(rowLegacy).select(LEGACY_COLS).single()) as unknown as typeof res
  }
  if (res.error) throw res.error
  return {
    mat_default: 'auto',
    work_cap: capForNewRoom(existing.length),
    design_overrides: null,
    arrangement: null,
    is_main: firstRoom,
    ...(res.data as object),
  } as GalleryRow
}

/**
 * Make this room the one `/@username` renders. Goes through an RPC (migration 0036)
 * because the partial unique index allows exactly one main room per owner: clearing
 * the old flag and setting the new one have to happen in the same transaction, or a
 * two-step client update can leave the account with none (or be rejected outright).
 */
export async function setMainRoom(id: string): Promise<void> {
  const { error } = await supabase!.rpc('set_main_room', { p_gallery: id })
  if (error) {
    if (missingOverrideColumns(error) || error.code === 'PGRST202') {
      throw new Error('Choosing the front-door room needs migration 0036 applied first.')
    }
    throw error
  }
}

export const SLUG_RE = /^[a-z0-9-]{1,40}$/

/** Change the public URL slug (/@username/[slug]). Unique per owner.
 *  NOTE: no UI calls this while the plan allows a single gallery — the shared
 *  URL is just /@username. Kept for the multi-gallery future. */
export async function updateGallerySlug(id: string, slug: string): Promise<void> {
  const clean = slug.trim().toLowerCase()
  if (!SLUG_RE.test(clean)) {
    throw new Error('URLs are 1–40 characters: lowercase letters, digits and hyphens.')
  }
  const { error } = await supabase!.from('galleries').update({ slug: clean }).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('You already use this URL for another gallery.')
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
    .update({ title: fields.title.trim(), statement: fields.statement.trim() })
    .eq('id', id)
  if (error) throw error
}

/** Deletes the gallery (placements cascade; the works themselves stay in the library) */
export async function deleteGallery(id: string): Promise<void> {
  const { error } = await supabase!.from('galleries').delete().eq('id', id)
  if (error) throw error
}

/** Persist the space settings (theme/layout/framing/mat/hanging/caption/design) to the gallery row */
export async function saveGallerySpace(id: string, s: Settings): Promise<void> {
  const fields: Record<string, unknown> = {
    theme: s.theme,
    layout: s.layout,
    frame_default: s.frame,
    mat_default: s.mat,
    hanging_default: s.hanging,
    caption_default: s.caption,
    design_overrides: s.designOverrides,
    arrangement: s.arrangement,
  }
  // Only overwrite layout_params while ON the custom layout — switching to a preset
  // must not destroy a saved custom room (switching back recovers it)
  if (s.layout === 'custom') fields.layout_params = s.layoutParams
  let { error } = await supabase!.from('galleries').update(fields).eq('id', id)
  if (error && missingOverrideColumns(error)) {
    // 0023 not applied — manual placement stays local until then
    delete fields.arrangement
    ;({ error } = await supabase!.from('galleries').update(fields).eq('id', id))
  }
  if (error && missingOverrideColumns(error)) {
    // 0014 not applied — design tools stay local until then
    delete fields.design_overrides
    ;({ error } = await supabase!.from('galleries').update(fields).eq('id', id))
  }
  if (error && missingOverrideColumns(error)) {
    // 0012 not applied — save everything else, mat stays local until then
    delete fields.mat_default
    ;({ error } = await supabase!.from('galleries').update(fields).eq('id', id))
  }
  if (error) throw error
}

/** Design Tools overrides only (wall/floor/light colour, logo) — purely cosmetic,
 *  so unlike saveGallerySpace this never touches placements */
export async function saveDesignOverrides(id: string, overrides: DesignOverrides): Promise<void> {
  const { error } = await supabase!.from('galleries').update({ design_overrides: overrides }).eq('id', id)
  if (error && missingOverrideColumns(error)) return // 0014 not applied — no column to save to yet
  if (error) throw error
}

/** Set (or clear, with null) the gallery's looping ambient BGM track URL (§P3-12). */
export async function saveGalleryBgm(id: string, url: string | null): Promise<void> {
  const { error } = await supabase!.from('galleries').update({ bgm_url: url }).eq('id', id)
  if (error && missingOverrideColumns(error)) {
    throw new Error('BGM needs migration 0027 (galleries.bgm_url) applied first.')
  }
  if (error) throw error
}

/** Open or close this room's guestbook (migration 0033). Closing stops new
 *  entries — it does not remove the ones already left. Enforced by RLS, not just
 *  by hiding the form. */
export async function saveGuestbookEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase!.from('galleries').update({ guestbook_enabled: enabled }).eq('id', id)
  if (error && missingOverrideColumns(error)) {
    throw new Error('Closing the guestbook needs migration 0033 applied first.')
  }
  if (error) throw error
}

/** Pick the work used for the OGP card / artist-page cover (null = slot 0) */
export async function setGalleryCover(id: string, artworkId: string | null): Promise<void> {
  const { error } = await supabase!.from('galleries').update({ cover_artwork_id: artworkId }).eq('id', id)
  if (error) throw error
}

// Does this error mean migration 0011/0012 (per-work override / mat columns) is missing?
function missingOverrideColumns(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    /light_override|hanging_override|caption_override|mat_override|mat_default|work_cap|design_overrides|arrangement|guestbook_enabled|bgm_url|is_main/.test(error.message ?? '')
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
  const layout = resolveLayout(settings.layout, settings.layoutParams)
  const cap = effectiveSlotCount(layout.slots.length, settings.workCap)
  // Honour the room's manual arrangement (§11.13): a work hangs on its chosen slot,
  // and an intentionally-empty slot is simply skipped. No demo collection on a real
  // published gallery, so `extra` is empty and this reduces to the owner's own works.
  // Auto-filled works spread across the walls (same balanced order the live scene uses).
  const perSlot = placeWorks(
    layout.slots.length,
    settings.arrangement,
    ownArtworks,
    [],
    balancedFillOrder(layout),
    cap
  )
  const rows = perSlot
    .map((art, i) =>
      art
        ? {
            gallery_id: galleryId,
            artwork_id: art.id,
            slot_index: i,
            frame_override: settings.frameOverrides[art.id] ?? null,
            mat_override: settings.matOverrides[art.id] ?? null,
            hanging_override: settings.hangingOverrides[art.id] ?? null,
            caption_override: settings.captionOverrides[art.id] ?? null,
            light_override: settings.lightOverrides[art.id] ?? null,
          }
        : null
    )
    .filter((r): r is NonNullable<typeof r> => r !== null)
  if (rows.length) {
    let { error } = await sb.from('placements').upsert(rows, { onConflict: 'gallery_id,slot_index' })
    if (error && missingOverrideColumns(error)) {
      // Migration 0035 (light_override) not applied yet — keep the other four axes
      const noLight = rows.map(({ light_override: _light, ...rest }) => rest)
      ;({ error } = await sb.from('placements').upsert(noLight, { onConflict: 'gallery_id,slot_index' }))
    }
    if (error && missingOverrideColumns(error)) {
      // Migration 0011/0012 not applied yet — keep publishing working, frame-only
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
  // Trim any placement whose slot is no longer used (slots the arrangement freed, or
  // rows past a shrunk cap). Sparse indices mean we can't just delete "slot >= count".
  const usedList = `(${rows.map((r) => r.slot_index).join(',')})`
  let delQ = sb.from('placements').delete().eq('gallery_id', galleryId)
  delQ = rows.length ? delQ.not('slot_index', 'in', usedList) : delQ
  const { error: dErr } = await delQ
  if (dErr) throw dErr
}

/** Per-work design overrides (keyed by artwork id) as stored in the placements —
 *  the cross-device record; the local Settings maps only exist in one browser */
export interface PlacementOverrides {
  frames: Record<string, string>
  mats: Record<string, string>
  hangings: Record<string, string>
  captions: Record<string, string>
  lights: Record<string, string>
}

export const EMPTY_OVERRIDES: PlacementOverrides = { frames: {}, mats: {}, hangings: {}, captions: {}, lights: {} }

export async function fetchPlacementOverrides(galleryId: string): Promise<PlacementOverrides> {
  let res = await supabase!
    .from('placements')
    .select('artwork_id, frame_override, mat_override, hanging_override, caption_override, light_override')
    .eq('gallery_id', galleryId)
  if (res.error && missingOverrideColumns(res.error)) {
    // Migration 0035 (light_override) not applied yet — the other four axes still work
    res = (await supabase!
      .from('placements')
      .select('artwork_id, frame_override, mat_override, hanging_override, caption_override')
      .eq('gallery_id', galleryId)) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // Migration 0011/0012 not applied yet — frame overrides still work
    res = (await supabase!
      .from('placements')
      .select('artwork_id, frame_override')
      .eq('gallery_id', galleryId)) as unknown as typeof res
  }
  if (res.error) throw res.error
  const out: PlacementOverrides = { frames: {}, mats: {}, hangings: {}, captions: {}, lights: {} }
  for (const r of (res.data ?? []) as Array<{
    artwork_id: string
    frame_override?: string | null
    mat_override?: string | null
    hanging_override?: string | null
    caption_override?: string | null
    light_override?: string | null
  }>) {
    if (r.frame_override) out.frames[r.artwork_id] = r.frame_override
    if (r.mat_override) out.mats[r.artwork_id] = r.mat_override
    if (r.hanging_override) out.hangings[r.artwork_id] = r.hanging_override
    if (r.caption_override) out.captions[r.artwork_id] = r.caption_override
    if (r.light_override) out.lights[r.artwork_id] = r.light_override
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
    mat: row.mat_default,
    hanging: row.hanging_default,
    caption: row.caption_default,
    showDemo: false,
    artworks: [],
    frameOverrides: overrides.frames,
    matOverrides: overrides.mats,
    hangingOverrides: overrides.hangings,
    captionOverrides: overrides.captions,
    lightOverrides: overrides.lights,
    workCap: row.work_cap ?? PLAN.worksPerGallery,
    designOverrides: normalizeDesignOverrides(row.design_overrides),
    arrangement: normalizeArrangement(row.arrangement),
  }
}
