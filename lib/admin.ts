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
  /** The exhibition's `/expo/{slug}` name, or null (migration 0040). */
  expoSlug: string | null
}

export interface AdminPurchaseRow {
  userId: string
  kind: string
  itemKey: string
  sku: string | null
  /** Smallest unit of `currency` — NOT always cents (¥500 is 500). */
  amount: number | null
  currency: string
  createdAt: string
}

export interface AdminReportRow {
  id: string
  /** Free text from the reporter — a URL or @handle, not a resolved gallery id. */
  about: string
  reason: string
  contact: string
  status: 'open' | 'actioned' | 'dismissed'
  handledNote: string
  createdAt: string
  /** Resolved from `about` when it names a gallery we can find, so the queue can
   *  offer a one-click takedown instead of a copy-paste hunt. */
  match: { galleryId: string; username: string; slug: string; isPublic: boolean } | null
}

/** One currency's worth of money. Never collapse several of these into one
 *  number: `500` is $5.00 in usd and ¥500 in jpy, so a cross-currency sum is a
 *  value that was never charged to anyone (migration 0031). */
export interface CurrencyTotal {
  currency: string
  amount: number
  count: number
}

/**
 * Total a set of purchases, split by the currency each was actually billed in.
 *
 * Used for the house revenue figure AND for what a single artist has paid, so
 * the "don't add yen to dollars" rule lives in exactly one place. Rows with a
 * null amount contribute 0 on purpose: the Theme Collection writes its price on
 * the collection row and null on each granted theme, so counting those would
 * bill the same purchase twice (app/api/stripe/webhook).
 */
export function sumByCurrency(rows: { amount: number | null; currency: string }[]): CurrencyTotal[] {
  const by = new Map<string, CurrencyTotal>()
  for (const r of rows) {
    const currency = (r.currency || 'usd').toLowerCase()
    const c = by.get(currency) ?? { currency, amount: 0, count: 0 }
    c.count += 1
    c.amount += r.amount ?? 0
    by.set(currency, c)
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount)
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
    reports: number
    openReports: number
  }
  reports: AdminReportRow[]
  /** One total per currency actually charged. Summing across currencies would
   *  be meaningless, so the UI shows them side by side (migration 0031). */
  revenueByCurrency: CurrencyTotal[]
  revenueByKind: { key: string; currency: string; count: number; amount: number }[]
}

/** Admin: manually unlock a paid item for a user (writes the purchases ledger via
 *  the admin-gated RPC in 0022). kind is 'design_tools' | 'video_pass' | 'theme' |
 *  'layout' | …; itemKey is the theme/layout id (empty for design_tools/video_pass). */
export async function grantEntitlement(userId: string, kind: string, itemKey = ''): Promise<void> {
  const { error } = await supabase!.rpc('grant_entitlement', { p_user: userId, p_kind: kind, p_item_key: itemKey })
  if (error) throw error
}

/**
 * Admin: **部屋を1室ふやす**（migration 0043）。台帳への記録と `galleries` の作成を
 * 1回で行う。
 *
 * `grantEntitlement(kind: 'room')` との違い: あれは枠を開けるだけで**部屋はできない**
 * （作るのは本人が /me で「新しい部屋をつくる」を押したとき）。管理者から見ると
 * 「追加したのに増えない」ので、こちらを使う（ユーザー指示 2026-08-09）。
 *
 * 返り値は作られた部屋のid。**冪等ではない** — 押した回数だけ増える。
 */
export async function adminAddRoom(userId: string, title?: string): Promise<string> {
  const { data, error } = await supabase!.rpc('admin_add_room', {
    p_user: userId,
    p_title: title?.trim() || null,
  })
  if (error) throw error
  return typeof data === 'string' ? data : ''
}

/** Admin: remove a previously-granted (or purchased) entitlement from a user. */
/** Assign (or clear, with '') an exhibition's public name — its `/expo/{slug}` URL.
 *  Admin-only RPC (migration 0040): the slug decides the canonical URL, and a name
 *  handed out by mistake is printed on a flyer before it can be taken back. */
export async function setExpoSlug(userId: string, slug: string): Promise<void> {
  const { error } = await supabase!.rpc('set_expo_slug', {
    p_user: userId,
    p_slug: slug.trim().toLowerCase() || null,
  })
  if (error) {
    if (error.code === '23505') throw new Error('That name is already taken.')
    if (error.code === 'PGRST202') throw new Error('Exhibition URLs need migration 0040 applied first.')
    throw error
  }
}

export async function revokeEntitlement(userId: string, kind: string, itemKey = ''): Promise<void> {
  const { error } = await supabase!.rpc('revoke_entitlement', { p_user: userId, p_kind: kind, p_item_key: itemKey })
  if (error) throw error
}

/** Admin: close out a report. The row is never deleted — a handled report is the
 *  record that a decision was made, which is what a takedown dispute needs. */
export async function setReportStatus(
  id: string,
  status: 'open' | 'actioned' | 'dismissed',
  note = '',
): Promise<void> {
  const { error } = await supabase!
    .from('reports')
    .update({
      status,
      handled_note: note,
      handled_at: status === 'open' ? null : new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/** Admin: take a gallery down (or put it back). Goes through the 0033 RPC rather
 *  than a cross-user UPDATE policy, so this is the only thing an admin can change
 *  about someone else's room. */
export async function setGalleryPublic(galleryId: string, isPublic: boolean): Promise<void> {
  const { error } = await supabase!.rpc('admin_set_gallery_public', {
    p_gallery: galleryId,
    p_public: isPublic,
  })
  if (error) throw error
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

type ProfileRow = { id: string; username: string | null; display_name: string | null; expo_slug?: string | null }
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

/** Read every row of a table, paging past PostgREST's 1000-row response cap so the
 *  admin totals stay accurate as the platform grows. Returns whatever it got on error
 *  (missing migration / RLS deny → empty), matching the console's graceful degradation. */
/**
 * Every row of a table, paged.
 *
 * @param fallbackColumns a narrower column list to retry with when the first select
 *   errors — for a column a migration may not have applied yet. Without it this
 *   function's error handling (break out and return what it has) turns one unknown
 *   column into an EMPTY TABLE, so adding a column to a caller here would silently
 *   blank that section of the dashboard rather than degrade it.
 */
async function fetchAll<T>(table: string, columns: string, fallbackColumns?: string): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase!.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) {
      // Only worth retrying before anything was read; a mid-pagination failure is not a
      // schema problem and the narrower select would not fix it.
      if (fallbackColumns && out.length === 0 && from === 0) {
        return fetchAll<T>(table, fallbackColumns)
      }
      break
    }
    if (!data) break
    out.push(...(data as unknown as T[]))
    if (data.length < PAGE) break // last page
  }
  return out
}

type ReportRaw = {
  id: string
  about: string
  reason: string
  contact: string
  status?: string | null
  handled_note?: string | null
  created_at: string
}

type PurchaseRaw = {
  user_id: string
  kind: string
  item_key: string
  sku: string | null
  amount_jpy: number | null
  currency: string | null
  created_at: string
}

/** Pull the whole platform picture for the admin console. Admin RLS (0017) is what
 *  lets these anon-key reads return every user's rows; a non-admin gets empty sets.
 *  Each table is fully paged (fetchAll), so totals/tallies don't silently cap at 1000. */
export async function fetchAdminOverview(): Promise<AdminOverview> {
  const empty: AdminOverview = {
    users: [],
    galleries: [],
    purchases: [],
    totals: { users: 0, galleries: 0, publicGalleries: 0, works: 0, reports: 0, openReports: 0 },
    reports: [],
    revenueByCurrency: [],
    revenueByKind: [],
  }
  if (!supabase) return empty

  const [profiles, galleries, placements, artworks, purchases, visits, reports] = await Promise.all([
    // `expo_slug` is newest (0040) — the fallback list keeps an unapplied migration from
    // emptying the whole table (see fetchAll).
    fetchAll<ProfileRow>('profiles', 'id, username, display_name, expo_slug', 'id, username, display_name'),
    fetchAll<GalleryRow>('galleries', 'id, slug, title, is_public, theme, layout, work_cap, updated_at, owner_id'),
    fetchAll<{ gallery_id: string }>('placements', 'gallery_id'),
    fetchAll<{ id: string; owner_id: string }>('artworks', 'id, owner_id'),
    fetchAll<PurchaseRaw>('purchases', 'user_id, kind, item_key, sku, amount_jpy, currency, created_at'),
    fetchAll<{ gallery_id: string }>('visits', 'gallery_id'),
    // 0017 has granted admins SELECT on reports all along; the console just never
    // asked for anything but a row count.
    fetchAll<ReportRaw>('reports', 'id, about, reason, contact, status, handled_note, created_at'),
  ])

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
        expoSlug: pr.expo_slug ?? null,
      }
    })
    .sort((a, b) => b.workCount - a.workCount)

  const purchaseRows: AdminPurchaseRow[] = purchases
    .map((p) => ({
      userId: p.user_id,
      kind: p.kind,
      itemKey: p.item_key,
      sku: p.sku,
      amount: p.amount_jpy,
      currency: (p.currency ?? 'usd').toLowerCase(),
      createdAt: p.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  // Group by SKU *and* currency: 500 means $5.00 in usd and ¥500 in jpy, so a
  // single sum across currencies would be a made-up number (migration 0031).
  const byKind = new Map<string, { key: string; currency: string; count: number; amount: number }>()
  for (const p of purchaseRows) {
    const kindKey = `${p.sku || p.kind}|${p.currency}`
    const k = byKind.get(kindKey) ?? { key: p.sku || p.kind, currency: p.currency, count: 0, amount: 0 }
    k.count += 1
    k.amount += p.amount ?? 0
    byKind.set(kindKey, k)
  }
  const revenueByKind = [...byKind.values()].sort((a, b) => b.amount - a.amount)
  const revenueByCurrency = sumByCurrency(purchaseRows)

  // Reports name their target in free text ("@me/room", a full URL, sometimes just
  // a title). Resolve what we can to a real gallery so the queue can act on it.
  const galleryByPath = new Map<string, GalleryRow>()
  for (const g of galleries) {
    const owner = nameById.get(g.owner_id)
    if (owner?.username) galleryByPath.set(`${owner.username}/${g.slug}`.toLowerCase(), g)
  }
  const reportRows: AdminReportRow[] = reports
    .map((r) => {
      const path = (r.about.match(/@([a-z0-9_]{3,20})\/([a-z0-9-]{1,40})/i) ?? [])
        .slice(1)
        .join('/')
        .toLowerCase()
      const g = path ? galleryByPath.get(path) : undefined
      const owner = g ? nameById.get(g.owner_id) : undefined
      return {
        id: r.id,
        about: r.about,
        reason: r.reason,
        contact: r.contact,
        status: (r.status === 'actioned' || r.status === 'dismissed' ? r.status : 'open') as
          | 'open'
          | 'actioned'
          | 'dismissed',
        handledNote: r.handled_note ?? '',
        createdAt: r.created_at,
        match:
          g && owner?.username
            ? { galleryId: g.id, username: owner.username, slug: g.slug, isPublic: g.is_public }
            : null,
      }
    })
    // Unhandled first, then newest
    .sort((a, b) =>
      a.status === b.status
        ? b.createdAt.localeCompare(a.createdAt)
        : a.status === 'open'
          ? -1
          : 1,
    )

  return {
    users: userRows,
    galleries: galleryRows,
    purchases: purchaseRows,
    totals: {
      users: profiles.length,
      galleries: galleries.length,
      publicGalleries: galleries.filter((g) => g.is_public).length,
      works: artworks.length,
      reports: reports.length,
      openReports: reportRows.filter((r) => r.status === 'open').length,
    },
    reports: reportRows,
    revenueByCurrency,
    revenueByKind,
  }
}
