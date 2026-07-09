// Cloud exhibition (when signed in): images go to Storage, metadata to the artworks table
import { supabase } from './supabase'
import type { ArtworkData } from './artworks'
import { loadImage } from './upload'
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
