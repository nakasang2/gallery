// Exhibition flow: loading and resizing images (requirement 8-2)
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

// Cap the long edge and encode as JPEG so it fits in localStorage
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
    ctx.fillStyle = '#fff' // Guard against transparent PNGs
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const VIDEO_MAX_BYTES = 40 * 1024 * 1024 // Limit tuned to Supabase's free tier

/** Extract dimensions and a poster image (first frame) from a video file */
export function videoFileMeta(
  file: File
): Promise<{ w: number; h: number; duration: number; posterDataUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    const fail = (e: unknown) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    video.onerror = fail
    video.onloadeddata = () => {
      // Skip ahead slightly to avoid the black frame at the start
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
    }
    video.onseeked = () => {
      try {
        const c = document.createElement('canvas')
        c.width = video.videoWidth
        c.height = video.videoHeight
        c.getContext('2d')!.drawImage(video, 0, 0)
        const posterDataUrl = c.toDataURL('image/jpeg', 0.8)
        const out = { w: video.videoWidth, h: video.videoHeight, duration: video.duration, posterDataUrl }
        URL.revokeObjectURL(url)
        video.src = ''
        resolve(out)
      } catch (e) {
        fail(e)
      }
    }
  })
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
    artist: params.artist || 'You',
    year: new Date().getFullYear(),
    desc: '',
    tags: ['Exhibited'],
    ratio: [params.w, params.h],
    src: params.src,
  }
}
