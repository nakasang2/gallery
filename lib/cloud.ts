// Cloud exhibition (when signed in): files go to Cloudflare R2, metadata to the
// artworks table. Nothing here talks to a storage API directly any more — the
// browser asks /api/upload-url for a presigned URL and PUTs the bytes straight to
// R2, and deletions go through /api/storage/delete. That server hop is what
// enforces "you may only write into your own folder" and the plan's storage
// quota, which used to be a Supabase RLS policy plus an advisory client check.
// See docs/DECISIONS.md 2026-07-27.
import { supabase } from './supabase'
import type { ArtworkData } from './artworks'
import { loadImage, fileToDataUrl } from './upload'
import { publicUrl } from './publicUrl'
import { GALLERY_BGM_MAX_BYTES } from './limits'

interface ArtworkRow {
  id: string
  owner_id: string
  storage_path: string
  width: number
  height: number
  title: string
  description: string
  year: number | null
  tags: string[]
  created_at: string
  kind?: 'image' | 'video'
  purchase_url?: string | null
  price?: string | null
  audio_url?: string | null
  width_cm?: number | null
  height_cm?: number | null
  medium?: string | null
}

/** Upload purposes the server will sign for (app/api/upload-url/route.ts owns the
 *  matching key layout — a client cannot name its own path). */
type UploadPurpose =
  | 'artwork-display'
  | 'artwork-thumb'
  | 'artwork-video'
  | 'avatar'
  | 'gallery-bgm'
  | 'gallery-logo'
  | 'lp-image'

interface UploadSpec {
  purpose: UploadPurpose
  /** Artwork or gallery id, for the purposes keyed by one. */
  id?: string
  /** LP hero slot, for 'lp-image'. */
  slot?: number
  body: Blob
  contentType: string
}

/**
 * Presign, then PUT. Returns the object keys in the order requested.
 *
 * All files in one call are signed together, so a batch that would breach the
 * quota is rejected before any of it uploads. The uid comes from the session
 * token server-side, which is why no ownerId is passed here.
 */
async function putFiles(specs: UploadSpec[]): Promise<string[]> {
  const { data } = await supabase!.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      files: specs.map((s) => ({
        purpose: s.purpose,
        id: s.id,
        slot: s.slot,
        contentType: s.contentType,
        size: s.body.size,
      })),
    }),
  })
  if (!res.ok) {
    // The route sends a human-readable `error` for the cases a user can act on
    // (quota reached, file too large, wrong type).
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Upload could not start (${res.status}).`)
  }
  const { uploads } = (await res.json()) as { uploads: { key: string; url: string }[] }

  await Promise.all(
    uploads.map(async ({ url }, i) => {
      // Content-Length is set by the browser from the Blob and was signed into
      // the URL, so a mismatch here would be rejected by R2.
      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': specs[i].contentType },
        body: specs[i].body,
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`)
    })
  )

  return uploads.map((u) => u.key)
}

/** Remove one work's files. Best-effort: the DB row is already gone by the time
 *  this runs, so a failure only orphans files and must not surface as an error. */
async function deleteArtworkFiles(artworkId: string): Promise<void> {
  try {
    const { data } = await supabase!.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/storage/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ artworkId }),
    })
  } catch (e) {
    console.warn('storage cleanup failed (files orphaned):', e)
  }
}

export function rowToArtwork(row: ArtworkRow, artistName: string): ArtworkData {
  const video = row.kind === 'video'
  return {
    id: row.id,
    title: row.title,
    artist: artistName,
    year: row.year ?? new Date(row.created_at).getFullYear(),
    desc: row.description,
    tags: row.tags.length ? row.tags : [video ? 'Video' : 'Exhibited'],
    ratio: [row.width, row.height],
    kind: video ? 'video' : 'image',
    src: publicUrl(`${row.storage_path}/${video ? 'video' : 'display.jpg'}`),
    poster: video ? publicUrl(`${row.storage_path}/thumb.jpg`) : undefined,
    purchaseUrl: row.purchase_url ?? undefined,
    price: row.price ?? undefined,
    audioUrl: row.audio_url ?? undefined,
    widthCm: row.width_cm ?? undefined,
    heightCm: row.height_cm ?? undefined,
    medium: row.medium ?? undefined,
  }
}

export async function listMyArtworks(artistName: string): Promise<ArtworkData[]> {
  const { data, error } = await supabase!
    .from('artworks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as ArtworkRow[]).map((r) => rowToArtwork(r, artistName))
}

/** Total bytes this user has stored, measured in R2 by the server.
 *
 *  This used to sum `artworks.bytes` here in the browser, which undercounted
 *  everything that column never sees — audio guides, BGM, avatars, logos, and the
 *  files of any work whose row was never written. Since migration 0030 the upload
 *  gate measures the bucket instead, so the meter has to read the same number or
 *  it will cheerfully show "12MB of 300MB" while uploads are being refused.
 *
 *  Throws when storage is unconfigured (501) or unreadable; /me hides the meter. */
export async function getStorageUsage(_ownerId: string): Promise<number> {
  const { data } = await supabase!.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/storage/usage', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Could not read storage usage (${res.status}).`)
  const { used } = (await res.json()) as { used: number }
  return used
}

// The plan quota gate (REQUIREMENTS 10.10) now lives in /api/upload-url, which
// refuses to sign an upload that wouldn't fit and returns the same message this
// used to throw. Checking it in the browser was advisory only — a crafted request
// could skip it — so it moved rather than being duplicated here.

// Insert an artworks row; if the bytes column doesn't exist yet (0006 not applied), retry without it.
//
// `bytes` is INFORMATIONAL since migration 0030 — the quota is measured in R2, not
// summed from this column. It is still written because it is a cheap per-work size
// hint, but nothing enforces it and nothing should start trusting it again.
async function insertArtworkRow(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!.from('artworks').insert(row)
  if (!error) return
  if (/bytes/i.test(error.message)) {
    const { bytes: _bytes, ...rest } = row
    const retry = await supabase!.from('artworks').insert(rest)
    if (!retry.error) return
    throw retry.error
  }
  throw error
}

async function dataUrlToJpegBlob(dataUrl: string, maxSide: number): Promise<Blob> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85)
  )
}

export async function uploadArtwork(params: {
  ownerId: string
  dataUrl: string
  title: string
  w: number
  h: number
}): Promise<void> {
  const id = crypto.randomUUID()
  const basePath = `${params.ownerId}/${id}`

  // Two sizes: a display image (long edge 1600) and a thumbnail (long edge 400) (docs/ARCHITECTURE.md ch. 5)
  const display = await dataUrlToJpegBlob(params.dataUrl, 1600)
  const thumb = await dataUrlToJpegBlob(params.dataUrl, 400)

  await putFiles([
    { purpose: 'artwork-display', id, body: display, contentType: 'image/jpeg' },
    { purpose: 'artwork-thumb', id, body: thumb, contentType: 'image/jpeg' },
  ])

  try {
    await insertArtworkRow({
      id,
      owner_id: params.ownerId,
      storage_path: basePath,
      width: params.w,
      height: params.h,
      title: params.title,
      bytes: display.size + thumb.size,
    })
  } catch (error) {
    // If metadata insertion fails, don't leave the images behind
    await deleteArtworkFiles(id)
    throw error
  }
}

/** Video work: store the video itself plus a poster in two sizes (requires the 0002 migration) */
export async function uploadVideoArtwork(params: {
  ownerId: string
  file: File
  posterDataUrl: string
  title: string
  w: number
  h: number
}): Promise<void> {
  const id = crypto.randomUUID()
  const basePath = `${params.ownerId}/${id}`

  const thumb = await dataUrlToJpegBlob(params.posterDataUrl, 400)
  const contentType = params.file.type || 'video/mp4'

  await putFiles([
    { purpose: 'artwork-video', id, body: params.file, contentType },
    { purpose: 'artwork-thumb', id, body: thumb, contentType: 'image/jpeg' },
  ])

  try {
    await insertArtworkRow({
      id,
      owner_id: params.ownerId,
      storage_path: basePath,
      width: params.w,
      height: params.h,
      title: params.title,
      kind: 'video',
      bytes: params.file.size + thumb.size,
    })
  } catch (error) {
    await deleteArtworkFiles(id)
    throw error
  }
}

/** Rename a work / edit its caption (the plate text) and/or its purchase link.
 *  Shown on the name plate, the artwork panel and the public page —
 *  placements join artworks live */
export async function updateArtworkDetails(
  artworkId: string,
  fields: {
    title: string
    description: string
    purchaseUrl?: string
    price?: string | null
    widthCm?: number | null
    heightCm?: number | null
    medium?: string | null
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    title: fields.title.trim() || 'Untitled',
    description: fields.description.trim(),
  }
  if (fields.purchaseUrl !== undefined) update.purchase_url = fields.purchaseUrl.trim() || null
  if (fields.price !== undefined) update.price = (fields.price ?? '').trim() || null
  if (fields.widthCm !== undefined) update.width_cm = fields.widthCm ?? null
  if (fields.heightCm !== undefined) update.height_cm = fields.heightCm ?? null
  if (fields.medium !== undefined) update.medium = (fields.medium ?? '').trim() || null

  // Columns from later migrations (0015/0025/0026). If a target DB is behind, the write
  // fails naming a missing column — drop whichever it names (or all optionals on a generic
  // schema-cache miss) and retry, so title/caption always save.
  const OPTIONAL = ['purchase_url', 'price', 'width_cm', 'height_cm', 'medium']
  let { error } = await supabase!.from('artworks').update(update).eq('id', artworkId)
  while (
    error &&
    (error.code === 'PGRST204' || error.code === '42703' || OPTIONAL.some((c) => new RegExp(c).test(error!.message ?? '')))
  ) {
    const named = OPTIONAL.find((c) => new RegExp(c).test(error!.message ?? '') && c in update)
    if (named) delete update[named]
    else OPTIONAL.forEach((c) => delete update[c]) // generic miss — drop all optionals
    if (!OPTIONAL.some((c) => c in update)) {
      ;({ error } = await supabase!.from('artworks').update(update).eq('id', artworkId))
      break
    }
    ;({ error } = await supabase!.from('artworks').update(update).eq('id', artworkId))
  }
  if (error) throw error
}

/** Save the display order of works (takes an array of ids and assigns sort_order in that order) */
export async function reorderArtworks(orderedIds: string[]): Promise<void> {
  const sb = supabase!
  // Run the individual updates in parallel (at most a few dozen, so plenty light)
  const results = await Promise.all(
    orderedIds.map((id, i) => sb.from('artworks').update({ sort_order: i }).eq('id', id))
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

/** Upload/replace the profile avatar (512px JPEG at {uid}/avatar.jpg) and save its URL */
export async function uploadAvatar(ownerId: string, file: File): Promise<string> {
  const { dataUrl } = await fileToDataUrl(file, 512)
  const blob = await dataUrlToJpegBlob(dataUrl, 512)
  const [key] = await putFiles([{ purpose: 'avatar', body: blob, contentType: 'image/jpeg' }])
  const url = `${publicUrl(key)}?v=${Date.now()}` // cache-bust so the new face shows immediately
  const { error } = await supabase!.from('profiles').update({ avatar_url: url }).eq('id', ownerId)
  if (error) throw error
  return url
}

/** Upload a gallery's looping ambient BGM ({uid}/{galleryId}/bgm) and return its URL.
 *  Like uploadLogo it only touches storage; the caller saves the URL onto the
 *  gallery row via saveGalleryBgm. The raw file is stored as-is (no re-encode). */
export async function uploadGalleryBgm(ownerId: string, galleryId: string, file: File): Promise<string> {
  if (file.size > GALLERY_BGM_MAX_BYTES) {
    throw new Error(`BGM tracks are limited to ${Math.floor(GALLERY_BGM_MAX_BYTES / 1024 / 1024)}MB.`)
  }
  const [key] = await putFiles([
    { purpose: 'gallery-bgm', id: galleryId, body: file, contentType: file.type || 'audio/mpeg' },
  ])
  return `${publicUrl(key)}?v=${Date.now()}` // cache-bust so a replaced track plays immediately
}

/** Upload a Design Tools logo/branding mark ({uid}/{galleryId}-logo.jpg) and
 *  return its URL — the caller saves it into that gallery's design_overrides
 *  (this does not write to any table itself, unlike uploadAvatar) */
export async function uploadLogo(ownerId: string, galleryId: string, file: File): Promise<string> {
  const { dataUrl } = await fileToDataUrl(file, 400)
  const blob = await dataUrlToJpegBlob(dataUrl, 400)
  const [key] = await putFiles([
    { purpose: 'gallery-logo', id: galleryId, body: blob, contentType: 'image/jpeg' },
  ])
  return `${publicUrl(key)}?v=${Date.now()}` // cache-bust so a replaced logo shows immediately
}

/** Upload a landing-page hero image and return its URL + resized dimensions. Like
 *  uploadLogo it only touches storage; the admin LP editor saves the URL into
 *  site_config. Only admins reach this UI, and the signed key is the caller's own
 *  folder, so a non-admin gains nothing from reaching the route — writing the URL
 *  into site_config is what needs admin rights, and RLS still guards that.
 *  The path is FIXED per slot ({uid}/lp/{slot}.jpg) so replacing a slot overwrites
 *  the old file instead of orphaning it; the URL is cache-busted so the new image
 *  shows immediately despite the stable path. */
export async function uploadLpImage(ownerId: string, slot: number, file: File): Promise<{ url: string; w: number; h: number }> {
  const { dataUrl, w, h } = await fileToDataUrl(file, 1280)
  const blob = await dataUrlToJpegBlob(dataUrl, 1280)
  const [key] = await putFiles([{ purpose: 'lp-image', slot, body: blob, contentType: 'image/jpeg' }])
  return { url: `${publicUrl(key)}?v=${Date.now()}`, w, h }
}

/** How many placements (public walls) an artwork hangs on — used for delete warnings */
export async function artworkPlacementCount(artworkId: string): Promise<number> {
  const { count, error } = await supabase!
    .from('placements')
    .select('id', { count: 'exact', head: true })
    .eq('artwork_id', artworkId)
  if (error) throw error
  return count ?? 0
}

/**
 * Delete the account and everything in it (REQUIREMENTS 10.1).
 *
 * Both halves now happen inside /api/account/delete: deleting the row invalidates
 * the user, so a follow-up request from here could no longer be authenticated to
 * clean up R2. The route keeps the original ordering — the delete_my_account RPC
 * (0007) first, so a failure leaves the account intact and retryable — and wipes
 * the whole `{uid}/` prefix afterwards, which also catches the logos, LP images,
 * guides and BGM that the old per-path list here never removed.
 */
export async function deleteMyAccount(_ownerId: string): Promise<void> {
  const sb = supabase!
  const { data } = await sb.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Could not delete the account (${res.status}).`)
  }

  await sb.auth.signOut().catch(() => {}) // session is already invalid — best effort
}

export async function deleteArtwork(_ownerId: string, artworkId: string): Promise<void> {
  const { error } = await supabase!.from('artworks').delete().eq('id', artworkId)
  if (error) throw error
  // Removes the work's whole folder, so image and video layouts both get cleaned
  // up (as does an audio guide) without listing candidate paths.
  await deleteArtworkFiles(artworkId)
}
