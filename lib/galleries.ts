// Gallery CRUD — gallery_id-centric (REQUIREMENTS.md 10.2 / 10.9).
// The DB row is the source of truth for a signed-in user's space settings;
// the plan variable caps how many galleries one user can own.
import { supabase } from './supabase'
import { PLAN, effectiveSlotCount, gradeForNewRoom, tallyRooms } from './limits'
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
import { listSubmittedArtworksForRoom } from './invites'
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
  /** Whether this room's full capacity came included with a room purchase (migration
   *  0038). False = the plan's one free room. This is the only thing that can tell a
   *  bought room from a free room grown with $3 slots, so it is what the allowance is
   *  counted against — see `lib/limits.gradeForNewRoom`. */
  slots_included?: boolean | null
  /** 合同展示（migration 0044）の部屋なら、その展示のid。作家自身の部屋は null。 */
  expo_id?: string | null
}

const COLS =
  'id, slug, title, statement, theme, layout, layout_params, frame_default, mat_default, hanging_default, caption_default, cover_artwork_id, is_public, updated_at, work_cap, design_overrides, arrangement, bgm_url, guestbook_enabled, is_main, slots_included, expo_id'
// Pre-0044 shape (no expo_id column yet) — every room reads as the artist's own
const COLS_NO_EXPO = COLS.replace(', expo_id', '')
// Newest column first when degrading against a DB that hasn't applied 0038.
const COLS_NO_GRADE = COLS_NO_EXPO.replace(', slots_included', '')
// Post-0036/pre-0038 shape (no slots_included column yet)
const COLS_NO_MAIN = COLS_NO_GRADE.replace(', is_main', '')
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

/** 所有者のギャラリー行を全部引く（合同展示の部屋も含む）。列の後方互換フォール
 *  バックは `listMyGalleries` と共有する ── 分けて二重に持つと片方だけ直して
 *  忘れる事故になる。 */
async function fetchOwnedRooms(userId: string): Promise<GalleryRow[]> {
  let res = await supabase!
    .from('galleries')
    .select(COLS)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
  if (res.error && missingOverrideColumns(res.error)) {
    // 0044 (expo_id) not applied — there are no joint exhibitions yet, so every
    // room is the artist's own
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_EXPO)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0038 (slots_included) not applied — every room reads as the free grade, so the
    // allowance falls back to "one free room" until the migration lands
    res = (await supabase!
      .from('galleries')
      .select(COLS_NO_GRADE)
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })) as unknown as typeof res
  }
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

export async function listMyGalleries(userId: string): Promise<GalleryRow[]> {
  const rows = await fetchOwnedRooms(userId)
  // **合同展示の部屋は「自分の部屋」ではない**（migration 0044）。ここで落とさないと、
  // ダッシュボードの部屋タブに混ざり、部屋数（`rooms.length`）にも入って
  // 「もう1室ふやす」の判定や玄関（is_main）の解決まで狂う。合同展示の部屋は
  // `listExpoRooms()` から引く。
  return rows.filter((r) => !r.expo_id)
}

/** 所有するギャラリー行を**合同展示の部屋も含めて**全部引く。作品スロットの合計
 *  （`lib/limits.poolCapacityOf`）は個人の部屋⇄合同展示の部屋の間でも成り立つので、
 *  合算には `listMyGalleries()` が落とす合同展示の部屋も含める必要がある。 */
export async function listAllOwnedRooms(userId: string): Promise<GalleryRow[]> {
  return fetchOwnedRooms(userId)
}

/** `excludeRoomId`以外の**通常展示の**部屋すべての`arrangement`（保存済みの手動配置）に
 *  載っている作品idの集合。配置タブで「この作品は別の部屋にも掛かっている」を示すために
 *  使う（ユーザー指示 2026-08-11）。公開用の`placements`テーブルではなく各部屋の
 *  `arrangement`を見る ── 非公開の部屋でもオーナーが実際に組んだ配置だから。
 *
 *  **合同展示の部屋は除く**（migration 0061・ユーザー決定 2026-08-13）。合同展示の
 *  部屋は専用プール（作品自体が別の`gallery_id`の行）なので、通常展示の作品idと
 *  物理的に重ならない ── 除かないと `poolCapacityOf` が引いた共有プールに対して
 *  「他の部屋で使用中」の点数だけ合同展示の分を過剰に数え、通常展示側の残り枠を
 *  不当に狭める。 */
export function elsewherePlacedWorkIds(rooms: GalleryRow[], excludeRoomId: string): Set<string> {
  const ids = new Set<string>()
  for (const r of rooms) {
    if (r.id === excludeRoomId || r.expo_id) continue
    for (const id of normalizeArrangement(r.arrangement)) {
      if (id) ids.add(id)
    }
  }
  return ids
}

/** How many physical slots `excludeRoomId`'s siblings are using, for the shared-pool
 *  placement cap (ユーザー決定 2026-08-12: 部屋ごと固定ではなく口座全体で自由配分)。
 *  **Not** `elsewherePlacedWorkIds(...).size` — that de-dupes by work id, so hanging
 *  the same work in two other rooms would only count once and let this room's derived
 *  cap creep past the account's real total (別視点レビュー指摘 2026-08-12). Counting
 *  filled slots rather than distinct works matches what actually consumes the pool.
 *
 *  **合同展示の部屋は除く**（migration 0061・ユーザー決定 2026-08-13。理由は
 *  `elsewherePlacedWorkIds` と同じ）。 */
export function elsewherePlacedCount(rooms: GalleryRow[], excludeRoomId: string): number {
  let n = 0
  for (const r of rooms) {
    if (r.id === excludeRoomId || r.expo_id) continue
    for (const id of normalizeArrangement(r.arrangement)) {
      if (id) n++
    }
  }
  return n
}

/** 1つの合同展示に属する部屋（migration 0044）。所有者の視点で引く。 */
export async function listExpoRooms(expoId: string): Promise<GalleryRow[]> {
  const { data, error } = await supabase!
    .from('galleries')
    .select(COLS)
    .eq('expo_id', expoId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({
    ...(r as object),
    mat_default: (r as { mat_default?: string }).mat_default ?? 'auto',
    work_cap: (r as { work_cap?: number }).work_cap ?? PLAN.worksPerGallery,
    design_overrides: (r as { design_overrides?: unknown }).design_overrides ?? null,
    arrangement: (r as { arrangement?: unknown }).arrangement ?? null,
  })) as GalleryRow[]
}

/**
 * 1件だけ、idで直接引く。**合同展示の部屋を`roomId`で開くときに使う**
 * ── `listMyGalleries()` は合同展示の部屋を弾くので、そちらの一覧には乗ってこない
 * （このファイル冒頭のコメント参照）。RLS は所有者なら `expo_id` の有無に関わらず
 * 読めるので、素直に id で引くだけでよい。見つからない/権限が無いときは null。
 */
export async function getGalleryById(id: string): Promise<GalleryRow | null> {
  const { data, error } = await supabase!
    .from('galleries')
    .select(COLS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...(data as object),
    mat_default: (data as { mat_default?: string }).mat_default ?? 'auto',
    work_cap: (data as { work_cap?: number }).work_cap ?? PLAN.worksPerGallery,
    design_overrides: (data as { design_overrides?: unknown }).design_overrides ?? null,
    arrangement: (data as { arrangement?: unknown }).arrangement ?? null,
  } as GalleryRow
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
  // Grade accounting, not position: a paid room only while an unused room purchase
  // exists, the free room only while the account has none. See gradeForNewRoom for why
  // position was laundering-prone. The DB enforces the same rule (0038) because this
  // check runs in the browser and `galleries` is inserted into directly through RLS.
  const grade = gradeForNewRoom(tallyRooms(existing), opts.roomsPurchased ?? 0)
  if (!grade) throw new Error('No room left to build on your plan.')
  const firstRoom = existing.length === 0
  // The FIRST room starts from the "studio" template (whitecube / corridor) — the free
  // tier's theme + layout — so a free gallery never starts on paid content (the DB
  // column default is the older chic/hall, which only paying users can keep).
  //
  // A LATER room copies the front-door room's look instead (ユーザー決定 2026-08-09):
  // the rooms of one show read as one show, and switching is free anyway because
  // themes/layouts/frames are owned per ACCOUNT (lib/entitlements has no gallery scope)
  // while the choice is per room (`galleries.theme`/`.layout` are columns). Starting a
  // bought room on the white default made it look like the artist's theme had been taken
  // away — the room price genuinely does not include a theme, but they already own theirs.
  // Not a new grant either: the source room is this same owner's, so nothing gets
  // unlocked that was not already unlocked.
  const look = firstRoom ? null : mainRoomOf(existing)
  const t = TEMPLATES[opts.templateId ?? 'studio'] ?? TEMPLATES.studio
  const theme = look?.theme ?? t.theme
  const layout = look?.layout ?? t.layout
  const row = {
    owner_id: userId,
    slug: freeSlug(opts.title, new Set(existing.map((g) => g.slug)), existing.length + 1),
    // An empty title is fine — displays lead with the artist instead of a canned name
    title: opts.title.trim(),
    statement: opts.statement?.trim() ?? '',
    // Capacity is fixed at creation time (§11.7 — "the room inherits the plan's cap
    // at purchase time"), not the column's own default (which only exists to
    // grandfather pre-0013 rooms). The free room starts at the plan's 5 and grows by
    // $3 slots; a room built against a purchase has its full capacity included.
    work_cap: grade.cap,
    // What the row remembers so the two can be told apart later (0038).
    slots_included: grade.slotsIncluded,
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
    arrangement: firstRoom
      ? null
      : new Array(resolveLayout(layout, look?.layout_params ?? null).slots.length).fill(null),
    theme,
    layout,
    // Carried with the layout, or a copied `custom` room would come out at the default
    // dimensions instead of the ones the artist actually shaped.
    layout_params: look?.layout === 'custom' ? look.layout_params : null,
    frame_default: look?.frame_default ?? t.frame,
    mat_default: look?.mat_default ?? 'auto',
    hanging_default: look?.hanging_default ?? t.hanging,
    caption_default: look?.caption_default ?? t.caption,
    // Design Tools (wall/floor/light colour, the artist's mark) is part of "the look" and
    // is free for everyone, so it travels too. The STATEMENT and the cover deliberately
    // do not: those are about this particular exhibition, not about the room's design.
    design_overrides: look?.design_overrides ?? null,
  }
  let res = await supabase!.from('galleries').insert(row).select(COLS).single()
  if (res.error && missingOverrideColumns(res.error)) {
    // 0038 not applied — no slots_included column to write. The room is still created;
    // until the migration lands, `listMyGalleries` reads every room as the free grade.
    const { slots_included: _grade, ...rowNoGrade } = row
    res = (await supabase!.from('galleries').insert(rowNoGrade).select(COLS_NO_GRADE).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0036 not applied — no is_main column to write; the oldest room stays the front door
    const { slots_included: _grade, is_main: _isMain, ...rowNoMain } = row
    res = (await supabase!.from('galleries').insert(rowNoMain).select(COLS_NO_MAIN).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0023 not applied — no arrangement column to write, so a new room falls back to
    // auto-fill there (the pre-0023 behaviour) instead of opening empty
    const { slots_included: _grade, is_main: _isMain, arrangement: _arr, ...rowNoArr } = row
    res = (await supabase!.from('galleries').insert(rowNoArr).select(COLS_NO_ARR).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0014 not applied — no design_overrides column, so a copied room keeps the
    // theme/layout but not the Design Tools colours
    const { slots_included: _grade, is_main: _isMain, arrangement: _arr, design_overrides: _design, ...rowNoDesign } = row
    res = (await supabase!.from('galleries').insert(rowNoDesign).select(COLS_NO_DESIGN).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0013 not applied — an unknown column in the insert payload fails before it runs
    const { work_cap: _workCap, slots_included: _grade, is_main: _isMain, arrangement: _arr, design_overrides: _design, ...rowNoCap } = row
    res = (await supabase!.from('galleries').insert(rowNoCap).select(COLS_NO_CAP).single()) as unknown as typeof res
  }
  if (res.error && missingOverrideColumns(res.error)) {
    // 0012 not applied either — no mat_default column, so the copied room falls back
    // to the automatic mat
    const { work_cap: _workCap, slots_included: _grade, is_main: _isMain, arrangement: _arr, design_overrides: _design, mat_default: _mat, ...rowLegacy } = row
    res = (await supabase!.from('galleries').insert(rowLegacy).select(LEGACY_COLS).single()) as unknown as typeof res
  }
  if (res.error) throw res.error
  return {
    mat_default: 'auto',
    work_cap: grade.cap,
    design_overrides: null,
    arrangement: null,
    is_main: firstRoom,
    slots_included: grade.slotsIncluded,
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
    /light_override|hanging_override|caption_override|mat_override|mat_default|work_cap|design_overrides|arrangement|guestbook_enabled|bgm_url|is_main|slots_included/.test(error.message ?? '')
  )
}

/** One placement row, as `replace_placements` (migration 0058) takes them. */
type PlacementRow = {
  gallery_id: string
  artwork_id: string
  slot_index: number
  frame_override: string | null
  mat_override: string | null
  hanging_override: string | null
  caption_override: string | null
  light_override: string | null
}

/** Rebuild placements from the current works, capped at the plan's effective slot count.
 *  **1トランザクションで置き換える**（`replace_placements`・migration 0058）。以前は
 *  upsert と trim が別々のリクエストで、あいだの状態がコミットされていた。 */
export async function rebuildPlacements(
  galleryId: string,
  settings: Settings,
  ownArtworks: ArtworkData[],
  /** 合同展示で他の作家がこの部屋に出した作品。**既定は「自分で取ってくる」**。
   *
   *  最初は呼び手に渡させる引数にしたが、別視点レビューが**渡し忘れを2箇所**見つけた
   *  （`setGalleryPublic` と store の `runGallerySync`）。この関数は arrangement を
   *  解決できた分だけを upsert して**残りを delete する**ので、渡し忘れは
   *  「公開したら他作家の作品だけ消える」という静かなデータ損失になる。しかも既定値が
   *  `[]` だったので **tsc は何も言わない**。
   *
   *  なので既定を安全側にした: 省略すると自分で取る。渡すのは「たった今取ったものが
   *  手元にある」呼び手だけの最適化。 */
  guestArtworks?: ArtworkData[]
): Promise<void> {
  const sb = supabase!
  // 取得の失敗は**投げる**。ゼロ件として続けると下の delete が他作家の作品を落とす。
  // （0041 未適用のDBは `listSubmittedArtworks` が [] を返すので落ちない。）
  const guests = guestArtworks ?? (await listSubmittedArtworksForRoom(galleryId))
  const layout = resolveLayout(settings.layout, settings.layoutParams)
  // 自動で埋める枚数の上限。**手で並べた部屋では効かない**（`placeWorks` が
  // `usableSlots` でそう決める）── ここで切り捨てると下の delete が実際に placements の
  // 行を消すので、「ダッシュボードで15点並べたのに3Dには5点」の直接の原因だった
  // （ユーザー報告 2026-08-12）。
  const cap = effectiveSlotCount(layout.slots.length, settings.workCap)
  // Honour the room's manual arrangement (§11.13): a work hangs on its chosen slot,
  // and an intentionally-empty slot is simply skipped. No demo collection on a real
  // published gallery, so `extra` is empty and this reduces to the owner's own works
  // plus whatever guests the organiser actually hung.
  // Auto-filled works spread across the walls (same balanced order the live scene uses).
  const perSlot = placeWorks(
    layout.slots.length,
    settings.arrangement,
    ownArtworks,
    [],
    balancedFillOrder(layout),
    cap,
    guests
  )
  const rows = perSlot
    .map((art, i): PlacementRow | null =>
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
    .filter((r): r is PlacementRow => r !== null)
  // 0058 のRPCで**まるごと置き換える**。関数は呼び手のトランザクションで走るので、
  // delete → insert が原子的になる（＝上限を超えた中間状態がコミットされない）。
  // 権限と同意の判定は placements のRLS（0037）に任せている＝RPCは security invoker。
  const { error } = await sb.rpc('replace_placements', { p_gallery: galleryId, p_rows: rows })
  if (!error) return
  // **旧経路（upsert → 余りを delete）は 0059 で撤去した。** 残しておくと、0059 の件数
  // トリガが**あいだの状態**（枠を移す瞬間に上限＋1行）を拒否するので、正常な配置操作が
  // 落ちる（別視点レビュー指摘 2026-08-13）。`PGRST202` はここでは「関数が見つからない」
  // ＝**0058/0059 が未適用**か、migration 直後で PostgREST のスキーマキャッシュがまだ
  // 古いかのどちらか。黙って別の書き方に逃げず、何をすればいいかを言って投げる。
  if (error.code === 'PGRST202') {
    throw new Error(
      'Placements need migration 0058 applied first (and 0059 for the slot limits). ' +
        'If it was just applied, reload — PostgREST caches the schema for a moment.'
    )
  }
  throw error
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
