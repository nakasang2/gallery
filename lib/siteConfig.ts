// Site-wide config (migration 0018). Currently: which images the landing-page hero
// shows. The admin console writes it; the public LP reads it (anon key, world-readable
// row). One setting → PC and mobile both, since both just read this.
import { useEffect, useState } from 'react'
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

/** LP hook: the configured hero images (null per slot = fall back to the demo art). */
export function useLpHero(): LpHeroSlot[] {
  const [slots, setSlots] = useState<LpHeroSlot[]>(() => normalize(null))
  useEffect(() => {
    let alive = true
    fetchLpHero()
      .then((s) => alive && setSlots(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return slots
}
