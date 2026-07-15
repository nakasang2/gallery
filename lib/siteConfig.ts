// Site-wide config (migration 0018). Currently: which images the landing-page hero
// shows, and the Explore spotlight. The admin console writes it; the public pages
// read it (anon key, world-readable row). Hook-free on purpose so server components
// (e.g. /explore) can import the fetchers — the one hook (useLpHero) lives in its
// only consumer, components/landing/HeroScene.
import { supabase } from './supabase'

export interface LpHeroImage {
  url: string
  /** Intrinsic width/height (after resize) — the hero frames key off the ratio */
  w: number
  h: number
}
export type LpHeroSlot = LpHeroImage | null

// center / left / right — the three works visible at the LP entrance
export const LP_HERO_SLOTS = 3
export const LP_HERO_SLOT_LABELS = ['Center', 'Left', 'Right'] as const

function normalize(value: unknown): LpHeroSlot[] {
  const raw = value as { slots?: unknown } | unknown[] | null
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { slots?: unknown })?.slots) ? (raw as { slots: unknown[] }).slots : []
  const out: LpHeroSlot[] = []
  for (let i = 0; i < LP_HERO_SLOTS; i++) {
    const s = arr[i] as Partial<LpHeroImage> | null | undefined
    out.push(
      s && typeof s.url === 'string' && Number.isFinite(s.w) && Number.isFinite(s.h)
        ? { url: s.url, w: s.w as number, h: s.h as number }
        : null
    )
  }
  return out
}

export async function fetchLpHero(): Promise<LpHeroSlot[]> {
  if (!supabase) return normalize(null)
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', 'lp_hero')
      .maybeSingle()
    if (error || !data) return normalize(null) // 0018 not applied / unset — demo defaults
    return normalize(data.value)
  } catch {
    return normalize(null)
  }
}

export async function saveLpHero(slots: LpHeroSlot[]): Promise<void> {
  const { error } = await supabase!
    .from('site_config')
    .upsert({ key: 'lp_hero', value: { slots }, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ---- Explore spotlight (企画展 / 特集) — a curated row on /explore, admin-managed ----

// NOTE: the LP hero hook `useLpHero` intentionally lives in HeroScene.tsx (its
// only caller) so this module stays hook-free and server-importable.

export interface SpotlightRef {
  username: string
  slug: string
}
export interface SpotlightConfig {
  /** Section heading, e.g. "Summer Show" / "#夏の箱庭展" — empty hides the whole section */
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
