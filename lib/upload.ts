// 出展フロー: 画像の読み込みとリサイズ(要件 8-2)
import type { ArtworkData } from './artworks'

export function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// localStorage に収まるよう長辺を抑えて JPEG 化する
export async function fileToDataUrl(
  file: File,
  maxSide = 1280
): Promise<{ dataUrl: string; w: number; h: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff' // 透過PNG対策
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function newArtworkEntry(params: {
  title: string
  artist: string
  src: string
  w: number
  h: number
}): ArtworkData {
  return {
    id: 'u' + Date.now() + Math.random().toString(36).slice(2, 6),
    title: params.title,
    artist: params.artist || 'あなた',
    year: new Date().getFullYear(),
    desc: '',
    tags: ['出展作品'],
    ratio: [params.w, params.h],
    src: params.src,
  }
}
