// Admin console data (migration 0017). Everything here relies on the admin-only
// RLS policies added in 0017: a non-admin session simply reads nothing back, so
// the client `useIsAdmin` gate is UX, and RLS is the actual security boundary.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AdminGalleryRow {
  id: string
  slug: string
  title: string
  isPublic: boolean
  theme: string
  layout: string
  workCap: number
  updatedAt: string | null
  ownerId: string
  username: string | null
  ownerName: string
  workCount: number
  visits: number
}

export interface AdminUserRow {
  id: string
  username: string | null
  displayName: string
  galleryCount: number
  publicCount: number
  workCount: number
  /** Owned entitlements, e.g. ['design_tools', 'theme:noir'] */
  packages: string[]
}

export interface AdminPurchaseRow {
  userId: string
  kind: string
  itemKey: string
  sku: string | null
  amountJpy: number | null
  createdAt: string
}

export interface AdminOverview {
  users: AdminUserRow[]
  galleries: AdminGalleryRow[]
  purchases: AdminPurchaseRow[]
  totals: {
    users: number
    galleries: number
    publicGalleries: number
    works: number
    revenueJpy: number
    reports: number
  }
  revenueByKind: { key: string; count: number; sumJpy: number }[]
}

/** Whether the signed-in user is an admin (rpc is_admin, added in 0017).
 *  Any failure — migration not applied, offline, signed out — resolves false. */
export function useIsAdmin(userId: string | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    if (!supabase || !userId) {
      setIsAdmin(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { data, error } = await supabase!.rpc('is_admin')
        if (alive) setIsAdmin(!error && data === true)
      } catch {
        if (alive) setIsAdmin(false) // network reject (vs {error}) — stay non-admin, no unhandled rejection
      }
    })()
    return () => {
      alive = false
    }
  }, [userId])
  return isAdmin
}

type ProfileRow = { id: string; username: string | null; display_name: string | null }
type GalleryRow = {
  id: string
  slug: string
  title: string
  is_public: boolean
  theme: string
  layout: string
  work_cap: number | null
  updated_at: string | null
  owner_id: string
}

/** Pull the whole platform picture for the admin console. Admin RLS (0017) is what
 *  lets these anon-key reads return every user's rows; a non-admin gets empty sets.
 *
 *  KNOWN LIMIT: these are unpaginated selects, so PostgREST's default 1000-row cap
 *  silently truncates each table. Fine while the platform is small; once any table
 *  (visits are the first to grow) passes 1000, totals/tallies undercount. The fix
 *  when it matters is count:'exact' head queries for the totals + a SQL aggregate
 *  for revenue — deferred until there's data to need it. */
export async function fetchAdminOverview(): Promise<AdminOverview> {
  const empty: AdminOverview = {
    users: [],
    galleries: [],
    purchases: [],
    totals: { users: 0, galleries: 0, publicGalleries: 0, works: 0, revenueJpy: 0, reports: 0 },
    revenueByKind: [],
  }
  if (!supabase) return empty

  const [profilesRes, galleriesRes, placementsRes, artworksRes, purchasesRes, visitsRes, reportsRes] =
    await Promise.all([
      supabase.from('profiles').select('id, username, display_name'),
      supabase.from('galleries').select('id, slug, title, is_public, theme, layout, work_cap, updated_at, owner_id'),
      supabase.from('placements').select('gallery_id'),
      supabase.from('artworks').select('id, owner_id'),
      supabase.from('purchases').select('user_id, kind, item_key, sku, amount_jpy, created_at'),
      supabase.from('visits').select('gallery_id'),
      supabase.from('reports').select('id'),
    ])

  const profiles = (profilesRes.data ?? []) as ProfileRow[]
  const galleries = (galleriesRes.data ?? []) as GalleryRow[]
  const placements = (placementsRes.data ?? []) as { gallery_id: string }[]
  const artworks = (artworksRes.data ?? []) as { id: string; owner_id: string }[]
  const purchases = (purchasesRes.data ?? []) as {
    user_id: string
    kind: string
    item_key: string
    sku: string | null
    amount_jpy: number | null
    created_at: string
  }[]
  const visits = (visitsRes.data ?? []) as { gallery_id: string }[]

  // Tallies keyed by id
  const placementsByGallery = new Map<string, number>()
  for (const p of placements) placementsByGallery.set(p.gallery_id, (placementsByGallery.get(p.gallery_id) ?? 0) + 1)
  const visitsByGallery = new Map<string, number>()
  for (const v of visits) visitsByGallery.set(v.gallery_id, (visitsByGallery.get(v.gallery_id) ?? 0) + 1)
  const worksByOwner = new Map<string, number>()
  for (const a of artworks) worksByOwner.set(a.owner_id, (worksByOwner.get(a.owner_id) ?? 0) + 1)
  const nameById = new Map<string, ProfileRow>()
  for (const pr of profiles) nameById.set(pr.id, pr)

  const packagesByUser = new Map<string, string[]>()
  for (const pu of purchases) {
    const label = pu.kind === 'theme' || pu.kind === 'layout' ? `${pu.kind}:${pu.item_key}` : pu.kind
    const list = packagesByUser.get(pu.user_id) ?? []
    list.push(label)
    packagesByUser.set(pu.user_id, list)
  }

  const galleryRows: AdminGalleryRow[] = galleries
    .map((g) => {
      const owner = nameById.get(g.owner_id)
      return {
        id: g.id,
        slug: g.slug,
        title: g.title,
        isPublic: g.is_public,
        theme: g.theme,
        layout: g.layout,
        workCap: g.work_cap ?? 0,
        updatedAt: g.updated_at,
        ownerId: g.owner_id,
        username: owner?.username ?? null,
        ownerName: owner?.display_name || owner?.username || '(unknown)',
        workCount: placementsByGallery.get(g.id) ?? 0,
        visits: visitsByGallery.get(g.id) ?? 0,
      }
    })
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

  const galleriesByOwner = new Map<string, GalleryRow[]>()
  for (const g of galleries) {
    const list = galleriesByOwner.get(g.owner_id) ?? []
    list.push(g)
    galleriesByOwner.set(g.owner_id, list)
  }

  const userRows: AdminUserRow[] = profiles
    .map((pr) => {
      const gs = galleriesByOwner.get(pr.id) ?? []
      return {
        id: pr.id,
        username: pr.username,
        displayName: pr.display_name || pr.username || '(no name)',
        galleryCount: gs.length,
        publicCount: gs.filter((g) => g.is_public).length,
        workCount: worksByOwner.get(pr.id) ?? 0,
        packages: packagesByUser.get(pr.id) ?? [],
      }
    })
    .sort((a, b) => b.workCount - a.workCount)

  const purchaseRows: AdminPurchaseRow[] = purchases
    .map((p) => ({
      userId: p.user_id,
      kind: p.kind,
      itemKey: p.item_key,
      sku: p.sku,
      amountJpy: p.amount_jpy,
      createdAt: p.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const revenueMap = new Map<string, { count: number; sumJpy: number }>()
  let revenueJpy = 0
  for (const p of purchaseRows) {
    const key = p.sku || p.kind
    const amt = p.amountJpy ?? 0
    revenueJpy += amt
    const cur = revenueMap.get(key) ?? { count: 0, sumJpy: 0 }
    cur.count += 1
    cur.sumJpy += amt
    revenueMap.set(key, cur)
  }
  const revenueByKind = [...revenueMap.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.sumJpy - a.sumJpy)

  return {
    users: userRows,
    galleries: galleryRows,
    purchases: purchaseRows,
    totals: {
      users: profiles.length,
      galleries: galleries.length,
      publicGalleries: galleries.filter((g) => g.is_public).length,
      works: artworks.length,
      revenueJpy,
      reports: (reportsRes.data ?? []).length,
    },
    revenueByKind,
  }
}
