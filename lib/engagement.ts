// Visitor engagement: visits, likes, guestbook, reports (migrations 0008 / 0010).
// All calls fail soft where noted — engagement must never break the viewing experience.
import { supabase } from './supabase'

/* ---- Visits ---- */

const VISIT_KEY = 'xibit360.visited.v1' // sessionStorage: one count per gallery per tab session

/** Record a page view of a public gallery (deduped per tab session; fire-and-forget) */
export function recordVisit(galleryId: string): void {
  if (!supabase) return
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(VISIT_KEY) ?? '[]')
    if (seen.includes(galleryId)) return
    sessionStorage.setItem(VISIT_KEY, JSON.stringify([...seen, galleryId]))
  } catch {
    /* private mode etc. — count anyway */
  }
  void supabase
    .from('visits')
    .insert({ gallery_id: galleryId })
    .then(({ error }) => {
      if (error) console.warn('visit not recorded:', error.message)
    })
}

/* ---- Likes ---- */

const LIKED_KEY = 'xibit360.liked.v1' // localStorage: artwork ids this browser already liked

export function hasLiked(artworkId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(LIKED_KEY) ?? '[]') as string[]).includes(artworkId)
  } catch {
    return false
  }
}

export async function addLike(galleryId: string, artworkId: string): Promise<void> {
  const { error } = await supabase!.from('likes').insert({ gallery_id: galleryId, artwork_id: artworkId })
  if (error) throw error
  try {
    const liked: string[] = JSON.parse(localStorage.getItem(LIKED_KEY) ?? '[]')
    localStorage.setItem(LIKED_KEY, JSON.stringify([...liked, artworkId]))
  } catch {
    /* best effort */
  }
}

export async function likeCount(artworkId: string): Promise<number> {
  const { count, error } = await supabase!
    .from('likes')
    .select('id', { count: 'exact', head: true })
    .eq('artwork_id', artworkId)
  if (error) throw error
  return count ?? 0
}

/** All like counts for a gallery, keyed by artwork id (client-side aggregation; MVP volumes) */
export async function likeCountsByArtwork(galleryId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase!.from('likes').select('artwork_id').eq('gallery_id', galleryId)
  if (error) throw error
  const out: Record<string, number> = {}
  for (const r of data ?? []) out[r.artwork_id] = (out[r.artwork_id] ?? 0) + 1
  return out
}

/* ---- Guestbook ---- */

export interface GuestbookEntry {
  id: string
  name: string
  message: string
  created_at: string
}

export async function listGuestbook(galleryId: string, limit = 50): Promise<GuestbookEntry[]> {
  const { data, error } = await supabase!
    .from('guestbook')
    .select('id, name, message, created_at')
    .eq('gallery_id', galleryId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GuestbookEntry[]
}

export async function addGuestbookEntry(galleryId: string, name: string, message: string): Promise<void> {
  const msg = message.trim()
  if (!msg) throw new Error('Write a message first.')
  const { error } = await supabase!
    .from('guestbook')
    .insert({ gallery_id: galleryId, name: name.trim().slice(0, 40), message: msg.slice(0, 500) })
  if (error) throw error
}

export async function deleteGuestbookEntry(id: string): Promise<void> {
  const { error } = await supabase!.from('guestbook').delete().eq('id', id)
  if (error) throw error
}

/* ---- Owner-side summary (dashboard) ---- */

export interface EngagementSummary {
  visits: number
  likes: number
  guestbook: number
}

export async function engagementSummary(galleryId: string): Promise<EngagementSummary> {
  const head = { count: 'exact' as const, head: true }
  const [v, l, g] = await Promise.all([
    supabase!.from('visits').select('id', head).eq('gallery_id', galleryId),
    supabase!.from('likes').select('id', head).eq('gallery_id', galleryId),
    supabase!.from('guestbook').select('id', head).eq('gallery_id', galleryId),
  ])
  const err = v.error ?? l.error ?? g.error
  if (err) throw err
  return { visits: v.count ?? 0, likes: l.count ?? 0, guestbook: g.count ?? 0 }
}

/* ---- Reports ---- */

export async function submitReport(about: string, reason: string, contact: string): Promise<void> {
  const { error } = await supabase!.from('reports').insert({
    about: about.trim().slice(0, 200),
    reason: reason.trim().slice(0, 1000),
    contact: contact.trim().slice(0, 200),
  })
  if (error) throw error
}
