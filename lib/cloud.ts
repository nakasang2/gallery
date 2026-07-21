// Cloud exhibition (when signed in): images go to Storage, metadata to the artworks table
import { supabase } from './supabase'
import type { ArtworkData } from './artworks'
import { loadImage, fileToDataUrl } from './upload'
import { PLAN } from './limits'

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

function publicUrl(path: string): string {
  return supabase!.storage.from('artworks').getPublicUrl(path).data.publicUrl
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

/** Total bytes this user has stored (sum of artworks.bytes; rows predating 0006 count as 0) */
export async function getStorageUsage(ownerId: string): Promise<number> {
  const { data, error } = await supabase!.from('artworks').select('bytes').eq('owner_id', ownerId)
  if (error) throw error
  return (data ?? []).reduce((sum, r) => sum + ((r as { bytes?: number }).bytes ?? 0), 0)
}

// Plan quota gate (REQUIREMENTS 10.10). Throws a readable error when the upload wouldn't fit
async function assertQuota(ownerId: string, addedBytes: number): Promise<void> {
  let used = 0
  try {
    used = await getStorageUsage(ownerId)
  } catch {
    return // bytes column missing (0006 not applied) — don't block uploads
  }
  if (used + addedBytes > PLAN.storageBytes) {
    const mb = (n: number) => Math.round(n / 1024 / 1024)
    throw new Error(
      `Storage limit reached: ${mb(used)}MB of ${mb(PLAN.storageBytes)}MB used, this upload needs ${Math.max(1, mb(addedBytes))}MB. Remove some works first.`
    )
  }
}

// Insert an artworks row; if the bytes column doesn't exist yet (0006 not applied), retry without it
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
  const sb = supabase!
  const id = crypto.randomUUID()
  const basePath = `${params.ownerId}/${id}`

  // Two sizes: a display image (long edge 1600) and a thumbnail (long edge 400) (docs/ARCHITECTURE.md ch. 5)
  const display = await dataUrlToJpegBlob(params.dataUrl, 1600)
  const thumb = await dataUrlToJpegBlob(params.dataUrl, 400)
  await assertQuota(params.ownerId, display.size + thumb.size)

  const up1 = await sb.storage.from('artworks').upload(`${basePath}/display.jpg`, display, {
    contentType: 'image/jpeg',
  })
  if (up1.error) throw up1.error
  const up2 = await sb.storage.from('artworks').upload(`${basePath}/thumb.jpg`, thumb, {
    contentType: 'image/jpeg',
  })
  if (up2.error) throw up2.error

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
    await sb.storage.from('artworks').remove([`${basePath}/display.jpg`, `${basePath}/thumb.jpg`])
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
  const sb = supabase!
  const id = crypto.randomUUID()
  const basePath = `${params.ownerId}/${id}`

  const thumb = await dataUrlToJpegBlob(params.posterDataUrl, 400)
  await assertQuota(params.ownerId, params.file.size + thumb.size)

  const contentType = params.file.type || 'video/mp4'
  const upV = await sb.storage.from('artworks').upload(`${basePath}/video`, params.file, { contentType })
  if (upV.error) throw upV.error
  const upT = await sb.storage.from('artworks').upload(`${basePath}/thumb.jpg`, thumb, {
    contentType: 'image/jpeg',
  })
  if (upT.error) throw upT.error

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
    await sb.storage.from('artworks').remove([`${basePath}/video`, `${basePath}/thumb.jpg`])
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
    audioUrl?: string | null
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
  if (fields.audioUrl !== undefined) update.audio_url = fields.audioUrl || null
  if (fields.widthCm !== undefined) update.width_cm = fields.widthCm ?? null
  if (fields.heightCm !== undefined) update.height_cm = fields.heightCm ?? null
  if (fields.medium !== undefined) update.medium = (fields.medium ?? '').trim() || null

  // Columns from later migrations (0015/0021/0025/0026). If a target DB is behind, the write
  // fails naming a missing column — drop whichever it names (or all optionals on a generic
  // schema-cache miss) and retry, so title/caption always save.
  const OPTIONAL = ['purchase_url', 'price', 'audio_url', 'width_cm', 'height_cm', 'medium']
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
  const sb = supabase!
  const { dataUrl } = await fileToDataUrl(file, 512)
  const blob = await dataUrlToJpegBlob(dataUrl, 512)
  const path = `${ownerId}/avatar.jpg`
  const up = await sb.storage.from('artworks').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (up.error) throw up.error
  const url = `${publicUrl(path)}?v=${Date.now()}` // cache-bust so the new face shows immediately
  const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', ownerId)
  if (error) throw error
  return url
}

/** Cap on an audio-guide file. Guides are short narration, not music. */
export const AUDIO_GUIDE_MAX_BYTES = 15 * 1024 * 1024

/** Upload a per-work audio guide ({uid}/{artworkId}/guide) and return its URL.
 *  Like uploadLogo it only touches storage; the caller saves the URL onto the
 *  artwork via updateArtworkDetails. The raw file is stored as-is (no re-encode). */
export async function uploadArtworkAudio(ownerId: string, artworkId: string, file: File): Promise<string> {
  if (file.size > AUDIO_GUIDE_MAX_BYTES) {
    throw new Error(`Audio guides are limited to ${Math.floor(AUDIO_GUIDE_MAX_BYTES / 1024 / 1024)}MB.`)
  }
  await assertQuota(ownerId, file.size)
  const sb = supabase!
  const path = `${ownerId}/${artworkId}/guide`
  const up = await sb.storage.from('artworks').upload(path, file, {
    contentType: file.type || 'audio/mpeg',
    upsert: true,
  })
  if (up.error) throw up.error
  return `${publicUrl(path)}?v=${Date.now()}` // cache-bust so a replaced guide plays immediately
}

/** Cap on a gallery BGM track. A looping ambient track, so a little larger than a guide. */
export const GALLERY_BGM_MAX_BYTES = 15 * 1024 * 1024

/** Upload a gallery's looping ambient BGM ({uid}/{galleryId}/bgm) and return its URL.
 *  Like uploadArtworkAudio it only touches storage; the caller saves the URL onto the
 *  gallery row via saveGalleryBgm. The raw file is stored as-is (no re-encode). */
export async function uploadGalleryBgm(ownerId: string, galleryId: string, file: File): Promise<string> {
  if (file.size > GALLERY_BGM_MAX_BYTES) {
    throw new Error(`BGM tracks are limited to ${Math.floor(GALLERY_BGM_MAX_BYTES / 1024 / 1024)}MB.`)
  }
  await assertQuota(ownerId, file.size)
  const sb = supabase!
  const path = `${ownerId}/${galleryId}/bgm`
  const up = await sb.storage.from('artworks').upload(path, file, {
    contentType: file.type || 'audio/mpeg',
    upsert: true,
  })
  if (up.error) throw up.error
  return `${publicUrl(path)}?v=${Date.now()}` // cache-bust so a replaced track plays immediately
}

/** Upload a Design Tools logo/branding mark ({uid}/{galleryId}-logo.jpg) and
 *  return its URL — the caller saves it into that gallery's design_overrides
 *  (this does not write to any table itself, unlike uploadAvatar) */
export async function uploadLogo(ownerId: string, galleryId: string, file: File): Promise<string> {
  const sb = supabase!
  const { dataUrl } = await fileToDataUrl(file, 400)
  const blob = await dataUrlToJpegBlob(dataUrl, 400)
  const path = `${ownerId}/${galleryId}-logo.jpg`
  const up = await sb.storage.from('artworks').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (up.error) throw up.error
  return `${publicUrl(path)}?v=${Date.now()}` // cache-bust so a replaced logo shows immediately
}

/** Upload a landing-page hero image and return its URL + resized dimensions. Like
 *  uploadLogo it only touches storage; the admin LP editor saves the URL into
 *  site_config. Only admins reach this UI, and the folder is the admin's own uid, so
 *  the existing "insert into your own folder" storage policy already allows it.
 *  The path is FIXED per slot ({uid}/lp/{slot}.jpg, upsert) so replacing a slot
 *  overwrites the old file instead of orphaning it; the URL is cache-busted so the
 *  new image shows immediately despite the stable path. */
export async function uploadLpImage(ownerId: string, slot: number, file: File): Promise<{ url: string; w: number; h: number }> {
  const sb = supabase!
  const { dataUrl, w, h } = await fileToDataUrl(file, 1280)
  const blob = await dataUrlToJpegBlob(dataUrl, 1280)
  const path = `${ownerId}/lp/${slot}.jpg`
  const up = await sb.storage.from('artworks').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (up.error) throw up.error
  return { url: `${publicUrl(path)}?v=${Date.now()}`, w, h }
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
 * Order matters: the delete_my_account RPC (0007) goes FIRST so that a failure
 * (unapplied migration, network) leaves the account fully intact and retryable.
 * Storage cleanup runs after, best-effort with the still-valid JWT — a failure
 * there only orphans files (a cost concern), never harms the user.
 */
export async function deleteMyAccount(ownerId: string): Promise<void> {
  const sb = supabase!
  // Collect the file paths up front — the DB rows are gone after the RPC cascades
  const { data } = await sb.from('artworks').select('storage_path').eq('owner_id', ownerId)
  const paths = (data ?? []).flatMap((r) => [
    `${r.storage_path}/display.jpg`,
    `${r.storage_path}/thumb.jpg`,
    `${r.storage_path}/video`,
  ])
  paths.push(`${ownerId}/avatar.jpg`)

  const { error } = await sb.rpc('delete_my_account')
  if (error) throw error

  // Point of no return passed — clean the bucket, but never surface a failure as one
  try {
    for (let i = 0; i < paths.length; i += 100) {
      await sb.storage.from('artworks').remove(paths.slice(i, i + 100))
    }
  } catch (e) {
    console.warn('storage cleanup after account deletion failed (files orphaned):', e)
  }
  await sb.auth.signOut().catch(() => {}) // session is already invalid — best effort
}

export async function deleteArtwork(ownerId: string, artworkId: string): Promise<void> {
  const sb = supabase!
  const basePath = `${ownerId}/${artworkId}`
  const { error } = await sb.from('artworks').delete().eq('id', artworkId)
  if (error) throw error
  // Pass every candidate path so we clean up both image and video layouts (nonexistent keys are ignored)
  await sb.storage
    .from('artworks')
    .remove([
      `${basePath}/display.jpg`,
      `${basePath}/thumb.jpg`,
      `${basePath}/video`,
    ])
}
