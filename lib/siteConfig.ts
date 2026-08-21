// Site-wide config (migration 0018). Currently: which images the LP's 3D museum
// shows (all 23 frames — entrance / corridor / final hall), and the Explore
// spotlight. The admin console writes it; the public pages read it (anon key,
// world-readable rows). Hook-free on purpose so server components (e.g. /explore)
// can import the fetchers — the one hook (useLpFaces) lives in its only consumer,
// components/landing/HeroScene.
import { supabase } from './supabase'

export interface LpHeroImage {
  url: string
  /** Intrinsic width/height (after resize) — the hero frames key off the ratio */
  w: number
  h: number
}
export type LpHeroSlot = LpHeroImage | null

// ---- LPの3D美術館に掛かる絵（全23枠） ----
//
// カメラの旅路は「入口 → 廊下 → 通路 → 最後の部屋」で進む（components/landing/HeroScene）。
// 管理画面は**その体感と同じ3節**に分け、性質の違う枠は節の中で帯に分ける
// （ユーザー選択 2026-08-20 A案）:
//   ① 1st View（入口）      … lp_hero        3枠
//   ② 廊下                  … lp_panels      6枠（訴求パネルの絵）
//                            + lp_approach   7枠（通路の作品）
//   ③ 最後の部屋            … lp_hall_front  3枠（正面の壁）
//                            + lp_hall_sides 4枠（左右の壁）
// **1帯＝site_config の1行**にしてある（帯ごとに保存が独立し、正規化も枠数だけで済む）。

// center / left / right — the three works visible at the LP entrance
export const LP_HERO_SLOTS = 3
/** 枠のラベルは辞書のキーで持つ。表示文字列をここに置くと、`lib/` は
 *  `npm run check:i18n` の検査対象外なので英語のまま静かに残る（実際に残っていた）。
 *  解決するのは呼び出し側（components/LpHeroEditor）。 */
export const LP_HERO_SLOT_LABEL_KEYS = [
  'adminUi.slotCenter',
  'adminUi.slotLeft',
  'adminUi.slotRight',
] as const

// 3Dの廊下に並ぶ6枚の訴求パネル。板（文字）は辞書から焼くが、その隣に掛かる
// 1点はここで差し替える ── 訴求ごとに「それが何なのか見える絵」を運営が入れる。
export const LP_PANEL_SLOTS = 6
/** パネルの枠に添えるラベルは、そのパネルの見出しをそのまま使う。専用の辞書キーを
 *  作ると、パネルの文言を変えたときに管理画面のラベルだけ古いまま残る。 */
export const LP_PANEL_SLOT_LABEL_KEYS = ['lp.f1Title', 'lp.f2Title', 'lp.f3Title', 'lp.f4Title', 'lp.f5Title', 'lp.f6Title'] as const

// 廊下を抜けた先の暗い通路に、両壁へ交互に掛かる7枚（Concept〜Pricing の背景）。
// ラベルの左右は HeroScene の `APPROACH_ART` の並びと同じ順序。**片方だけ足すと
// 番号と壁がずれる**ので、増減するときは必ず両方を直す。
export const LP_APPROACH_SLOTS = 7
export const LP_APPROACH_SLOT_LABEL_KEYS = [
  'adminUi.lpApproach1',
  'adminUi.lpApproach2',
  'adminUi.lpApproach3',
  'adminUi.lpApproach4',
  'adminUi.lpApproach5',
  'adminUi.lpApproach6',
  'adminUi.lpApproach7',
] as const

// 最後の大部屋。正面の壁（到着地点。中央が一番大きい）と、左右の壁の4枚。
// 節は1つだが**行は2つ**に分けてある ── 正面は「着いた先の主役」、左右は「歩きながら
// 見る脇の作品」で、差し替える動機が別なので保存も分ける。
export const LP_HALL_FRONT_SLOTS = 3
export const LP_HALL_FRONT_SLOT_LABEL_KEYS = [
  'adminUi.lpHallFrontCenter',
  'adminUi.lpHallFrontLeft',
  'adminUi.lpHallFrontRight',
] as const
export const LP_HALL_SIDE_SLOTS = 4
export const LP_HALL_SIDE_SLOT_LABEL_KEYS = [
  'adminUi.lpHallSideLeftNear',
  'adminUi.lpHallSideLeftFar',
  'adminUi.lpHallSideRightNear',
  'adminUi.lpHallSideRightFar',
] as const

/**
 * `lp-image` のアップロードは口座ごとに `{uid}/lp/{slot}-{nonce}.jpg` へ書く
 * （app/api/upload-url の 'lp-image'。枠番号の上限はそこで決まる。nonceの理由は
 * リリース前監査 #20 — 固定パスへの上書きだと、保存前でもCDNキャッシュが切れた
 * 時点で本番LPの画像が差し替わっていた）。**面ごとに10の帯を使い、同じ枠番号を
 * 取り合わないようにする** ── 帯の中で枠数が増えても隣の面にぶつからない。
 */
export const LP_PANEL_SLOT_OFFSET = 10
export const LP_APPROACH_SLOT_OFFSET = 20
export const LP_HALL_FRONT_SLOT_OFFSET = 30
export const LP_HALL_SIDE_SLOT_OFFSET = 40

// 保存の形（`{ slots: [...] }`）も検算も、どの面でも同一。**同じ意味の
// 処理を2か所に書かない**（DECISIONS 2026-08-12 の絶対ルール）ため、キーと枠数
// だけを引数に取る1つの実装に通す。
function normalize(value: unknown, count: number): LpHeroSlot[] {
  const raw = value as { slots?: unknown } | unknown[] | null
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { slots?: unknown })?.slots) ? (raw as { slots: unknown[] }).slots : []
  const out: LpHeroSlot[] = []
  for (let i = 0; i < count; i++) {
    const s = arr[i] as Partial<LpHeroImage> | null | undefined
    out.push(
      s && typeof s.url === 'string' && Number.isFinite(s.w) && Number.isFinite(s.h)
        ? { url: s.url, w: s.w as number, h: s.h as number }
        : null
    )
  }
  return out
}

/** Distinguishes "this band has nothing set yet" from "the fetch itself failed" —
 *  the admin editor (リリース前監査 #19) must not let a save go through on the
 *  latter, or it upserts `normalize(null, count)` and wipes every slot in the
 *  band that a transient network error merely failed to READ. `LpFaces`/
 *  `fetchLpFaces` (the public LP side) does not need this distinction: silently
 *  falling back to demo art on a failed read is exactly the degrade a visitor
 *  should get. */
export interface SlotsFetch {
  slots: LpHeroSlot[]
  /** false only for a genuine fetch failure (network, RLS, missing migration) —
   *  never for "no row yet", which is a legitimate empty state. */
  ok: boolean
}

async function fetchSlots(key: string, count: number): Promise<SlotsFetch> {
  if (!supabase) return { slots: normalize(null, count), ok: true } // not configured — nothing to distinguish from
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    // `maybeSingle()` returns `{data: null, error: null}` for zero rows — that is
    // the legitimate "unset" case (0018 not applied yet, or never saved). `error`
    // set is a real failure and must NOT be folded into the same "empty" result.
    if (error) return { slots: normalize(null, count), ok: false }
    return { slots: normalize(data?.value ?? null, count), ok: true }
  } catch {
    return { slots: normalize(null, count), ok: false }
  }
}

async function saveSlots(key: string, slots: LpHeroSlot[]): Promise<void> {
  const { error } = await supabase!
    .from('site_config')
    .upsert({ key, value: { slots }, updated_at: new Date().toISOString() })
  if (error) throw error
}

export const fetchLpHero = (): Promise<SlotsFetch> => fetchSlots('lp_hero', LP_HERO_SLOTS)
export const saveLpHero = (slots: LpHeroSlot[]): Promise<void> => saveSlots('lp_hero', slots)
export const fetchLpPanels = (): Promise<SlotsFetch> => fetchSlots('lp_panels', LP_PANEL_SLOTS)
export const saveLpPanels = (slots: LpHeroSlot[]): Promise<void> => saveSlots('lp_panels', slots)
export const fetchLpApproach = (): Promise<SlotsFetch> => fetchSlots('lp_approach', LP_APPROACH_SLOTS)
export const saveLpApproach = (slots: LpHeroSlot[]): Promise<void> => saveSlots('lp_approach', slots)
export const fetchLpHallFront = (): Promise<SlotsFetch> => fetchSlots('lp_hall_front', LP_HALL_FRONT_SLOTS)
export const saveLpHallFront = (slots: LpHeroSlot[]): Promise<void> => saveSlots('lp_hall_front', slots)
export const fetchLpHallSides = (): Promise<SlotsFetch> => fetchSlots('lp_hall_sides', LP_HALL_SIDE_SLOTS)
export const saveLpHallSides = (slots: LpHeroSlot[]): Promise<void> => saveSlots('lp_hall_sides', slots)

/** LPの3Dが必要な5面ぶんをまとめたもの */
export interface LpFaces {
  hero: LpHeroSlot[]
  panels: LpHeroSlot[]
  approach: LpHeroSlot[]
  hallFront: LpHeroSlot[]
  hallSides: LpHeroSlot[]
}

const LP_FACE_SPECS = [
  ['hero', 'lp_hero', LP_HERO_SLOTS],
  ['panels', 'lp_panels', LP_PANEL_SLOTS],
  ['approach', 'lp_approach', LP_APPROACH_SLOTS],
  ['hallFront', 'lp_hall_front', LP_HALL_FRONT_SLOTS],
  ['hallSides', 'lp_hall_sides', LP_HALL_SIDE_SLOTS],
] as const satisfies readonly (readonly [keyof LpFaces, string, number])[]

/** 何も設定されていない状態（全枠 null）。LP側の初期値にも使う ── 「まだ読めていない」
 *  と「設定が無い」を同じ形にしておけば、最初の1フレームからデモ作品で描ける。 */
export const emptyLpFaces = (): LpFaces =>
  Object.fromEntries(LP_FACE_SPECS.map(([f, , n]) => [f, normalize(null, n)])) as unknown as LpFaces

/**
 * LPが読む側の入口。**5面を1リクエストで取る** ── 面ごとに `fetchLpHero()` を呼ぶと、
 * 来場者の最初の1画面で site_config への往復が5回になる（面を足すたびに増える）。
 * 管理画面は面ごとの fetch/save をそのまま使う（そこは1面ずつ編集して保存するので、
 * まとめて取る意味がない）。
 */
export async function fetchLpFaces(): Promise<LpFaces> {
  if (!supabase) return emptyLpFaces()
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('key, value')
      .in('key', LP_FACE_SPECS.map(([, k]) => k))
    if (error || !data) return emptyLpFaces() // 0018 not applied / unset — demo defaults
    const byKey = new Map(data.map((r) => [r.key as string, r.value]))
    return Object.fromEntries(
      LP_FACE_SPECS.map(([face, key, count]) => [face, normalize(byKey.get(key) ?? null, count)])
    ) as unknown as LpFaces
  } catch {
    return emptyLpFaces()
  }
}

// ---- Explore spotlight (企画展 / 特集) — a curated row on /explore, admin-managed ----

// NOTE: the LP art hook `useLpFaces` intentionally lives in HeroScene.tsx (its
// only caller) so this module stays hook-free and server-importable.

export interface SpotlightRef {
  username: string
  slug: string
}
export interface SpotlightConfig {
  /** Section heading, e.g. "Summer Show" / "#SummerShow" — empty hides the whole section */
  title: string
  /** One line under the heading */
  subtitle: string
  /** Curated galleries, in display order */
  items: SpotlightRef[]
}

export const EMPTY_SPOTLIGHT: SpotlightConfig = { title: '', subtitle: '', items: [] }
/** Keep the curation small and skimmable */
export const SPOTLIGHT_MAX = 6

function normalizeSpotlight(value: unknown): SpotlightConfig {
  const v = value as Partial<SpotlightConfig> | null
  const items: SpotlightRef[] = Array.isArray(v?.items)
    ? (v!.items as unknown[])
        .map((r) => {
          const o = r as Partial<SpotlightRef>
          return typeof o?.username === 'string' && typeof o?.slug === 'string'
            ? { username: o.username, slug: o.slug }
            : null
        })
        .filter((r): r is SpotlightRef => r !== null)
        .slice(0, SPOTLIGHT_MAX)
    : []
  return {
    title: typeof v?.title === 'string' ? v.title : '',
    subtitle: typeof v?.subtitle === 'string' ? v.subtitle : '',
    items,
  }
}

export async function fetchSpotlight(): Promise<SpotlightConfig> {
  if (!supabase) return EMPTY_SPOTLIGHT
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', 'explore_spotlight')
      .maybeSingle()
    if (error || !data) return EMPTY_SPOTLIGHT // 0018 not applied / unset
    return normalizeSpotlight(data.value)
  } catch {
    return EMPTY_SPOTLIGHT
  }
}

export async function saveSpotlight(cfg: SpotlightConfig): Promise<void> {
  const clean = normalizeSpotlight(cfg)
  const { error } = await supabase!
    .from('site_config')
    .upsert({ key: 'explore_spotlight', value: clean, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ---- Demo appearance (/demo showcase) — which theme the guest demo opens with ----

export interface DemoLook {
  /** Theme key the /demo showcase renders in (falls back to the built-in default) */
  theme: string
}

/** The admin-set demo theme, or null when unset (use the built-in default). */
export async function fetchDemoLook(): Promise<DemoLook | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', 'demo_look')
      .maybeSingle()
    if (error || !data) return null
    const v = data.value as Partial<DemoLook> | null
    return v && typeof v.theme === 'string' && v.theme ? { theme: v.theme } : null
  } catch {
    return null
  }
}

export async function saveDemoLook(look: DemoLook): Promise<void> {
  const { error } = await supabase!
    .from('site_config')
    .upsert({ key: 'demo_look', value: { theme: look.theme }, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ---- Ghost visitors (§11.19) — admin dial for how fast the past-visitor figures walk ----

export interface GhostConfig {
  /** Travel speed (m/s) per model. The walk clip's cadence locks to this (no foot-slide),
   *  so it also sets how brisk each figure's stepping looks. */
  walkSpeedMale: number
  walkSpeedFemale: number
}

// A calm gallery stroll by default (was 1.94 — felt hurried).
export const GHOST_WALK_DEFAULT = 1.3
export const GHOST_WALK_MIN = 0.6
export const GHOST_WALK_MAX = 2.6

function clampWalk(n: unknown, fallback = GHOST_WALK_DEFAULT): number {
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.min(GHOST_WALK_MAX, Math.max(GHOST_WALK_MIN, n))
    : fallback
}

export const DEFAULT_GHOST: GhostConfig = {
  walkSpeedMale: GHOST_WALK_DEFAULT,
  walkSpeedFemale: GHOST_WALK_DEFAULT,
}

export async function fetchGhostConfig(): Promise<GhostConfig> {
  if (!supabase) return DEFAULT_GHOST
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', 'ghost')
      .maybeSingle()
    if (error || !data) return DEFAULT_GHOST // 0018 not applied / unset — shipped default
    const v = data.value as { walkSpeed?: number; walkSpeedMale?: number; walkSpeedFemale?: number } | null
    // Fall back to the legacy single `walkSpeed` for both when the split keys are absent
    const legacy = typeof v?.walkSpeed === 'number' ? v.walkSpeed : undefined
    return {
      walkSpeedMale: clampWalk(v?.walkSpeedMale ?? legacy),
      walkSpeedFemale: clampWalk(v?.walkSpeedFemale ?? legacy),
    }
  } catch {
    return DEFAULT_GHOST
  }
}

export async function saveGhostConfig(cfg: GhostConfig): Promise<void> {
  const { error } = await supabase!
    .from('site_config')
    .upsert({
      key: 'ghost',
      value: { walkSpeedMale: clampWalk(cfg.walkSpeedMale), walkSpeedFemale: clampWalk(cfg.walkSpeedFemale) },
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}
