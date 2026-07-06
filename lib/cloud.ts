// クラウド出展(ログイン時): 画像は Storage、メタデータは artworks テーブルへ
import { supabase } from './supabase'
import type { ArtworkData } from './artworks'
import { loadImage } from './upload'

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
    tags: row.tags.length ? row.tags : [video ? '映像作品' : '出展作品'],
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

  // 表示用(長辺1600)とサムネイル(長辺400)の2サイズ(docs/ARCHITECTURE.md 5章)
  const display = await dataUrlToJpegBlob(params.dataUrl, 1600)
  const thumb = await dataUrlToJpegBlob(params.dataUrl, 400)

  const up1 = await sb.storage.from('artworks').upload(`${basePath}/display.jpg`, display, {
    contentType: 'image/jpeg',
  })
  if (up1.error) throw up1.error
  const up2 = await sb.storage.from('artworks').upload(`${basePath}/thumb.jpg`, thumb, {
    contentType: 'image/jpeg',
  })
  if (up2.error) throw up2.error

  const { error } = await sb.from('artworks').insert({
    id,
    owner_id: params.ownerId,
    storage_path: basePath,
    width: params.w,
    height: params.h,
    title: params.title,
  })
  if (error) {
    // メタデータ登録に失敗したら画像は残さない
    await sb.storage.from('artworks').remove([`${basePath}/display.jpg`, `${basePath}/thumb.jpg`])
    throw error
  }
}

/** 動画作品: 動画本体 + ポスター2サイズを保存(要 0002 マイグレーション) */
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

  const contentType = params.file.type || 'video/mp4'
  const upV = await sb.storage.from('artworks').upload(`${basePath}/video`, params.file, { contentType })
  if (upV.error) throw upV.error
  const thumb = await dataUrlToJpegBlob(params.posterDataUrl, 400)
  const upT = await sb.storage.from('artworks').upload(`${basePath}/thumb.jpg`, thumb, {
    contentType: 'image/jpeg',
  })
  if (upT.error) throw upT.error

  const { error } = await sb.from('artworks').insert({
    id,
    owner_id: params.ownerId,
    storage_path: basePath,
    width: params.w,
    height: params.h,
    title: params.title,
    kind: 'video',
  })
  if (error) {
    await sb.storage.from('artworks').remove([`${basePath}/video`, `${basePath}/thumb.jpg`])
    throw error
  }
}

/** 作品の並び順を保存する(idの配列で受け取り、その順に sort_order を振る) */
export async function reorderArtworks(orderedIds: string[]): Promise<void> {
  const sb = supabase!
  // 個別 update を並列実行(件数は最大でも数十なので十分軽い)
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
  // 画像/動画どちらのファイル構成でも掃除できるよう全候補を渡す(存在しないキーは無視される)
  await sb.storage
    .from('artworks')
    .remove([
      `${basePath}/display.jpg`,
      `${basePath}/thumb.jpg`,
      `${basePath}/video`,
    ])
}
