// Browser half of the baked-shadow save: turn a finished atlas into a PNG and post it.
//
// Split from `lib/shadowBake.ts` (the shared shape) because this half needs the
// session token and `document`, and from the API route because that half needs R2
// credentials. Nothing here decides policy — the route re-checks ownership, size and
// quota, since a client can say anything.
import * as THREE from 'three'
import { supabase } from './supabase'

export interface SaveShadowBakeInput {
  galleryId: string
  bakeKey: string
  ids: string[]
  cols: number
  rows: number
  tile: number
  png: Blob
}

export type SaveShadowBakeResult =
  /** Stored. */
  | { ok: true; bytes: number }
  /** Not stored, and that is fine: the room stays published and visitors bake in
   *  their own browser exactly as they do today (storage full, 0067 not applied). */
  | { ok: false; skipped: true; reason: string }
  /** Not stored, and something is actually wrong. */
  | { ok: false; skipped: false; reason: string }

/**
 * Read the finished atlas out of the GPU and encode it as a PNG.
 *
 * **The row order is deliberate and easy to get backwards.** `readRenderTargetPixels`
 * returns GL's order — row 0 is the BOTTOM scanline, which is also uv `v = 0`. Those
 * rows are written into the canvas top-down, so the PNG's first row is the atlas's
 * `v = 0` row. The reader then loads it with `flipY = false` (see GalleryScene), which
 * maps image row 0 to `v = 0` and lands exactly where it started. Flip either half and
 * every shadow appears above its frame instead of below it.
 */
export async function encodeAtlasPng(
  gl: THREE.WebGLRenderer,
  atlas: THREE.WebGLRenderTarget
): Promise<Blob> {
  const w = atlas.width
  const h = atlas.height
  const buf = new Uint8Array(w * h * 4)
  gl.readRenderTargetPixels(atlas, 0, 0, w, h, buf)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not encode the bake (no 2D context).')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), w, h), 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the bake (toBlob returned nothing).')
  return blob
}

/** Post the atlas. Never throws for the "no room to store it" case — that is a
 *  degradation, not a failure, and it must not take the publish down with it. */
export async function saveShadowBake(input: SaveShadowBakeInput): Promise<SaveShadowBakeResult> {
  if (!supabase) return { ok: false, skipped: true, reason: 'not-configured' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, skipped: false, reason: 'signed-out' }

  // Base64 rather than multipart: the whole point of relaying through our own route is
  // that this is small (tens of KB), and a JSON body keeps the route's validation in
  // one place. `btoa` over a chunked binary string — spreading a 100KB array into
  // `String.fromCharCode(...)` in one call blows the argument limit on some browsers.
  const bytes = new Uint8Array(await input.png.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  try {
    const res = await fetch('/api/bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        galleryId: input.galleryId,
        bakeKey: input.bakeKey,
        ids: input.ids,
        cols: input.cols,
        rows: input.rows,
        tile: input.tile,
        png: btoa(binary),
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { skipped?: boolean; error?: string; bytes?: number }
    if (res.ok) return { ok: true, bytes: body.bytes ?? bytes.length }
    return { ok: false, skipped: body.skipped === true, reason: body.error ?? `http-${res.status}` }
  } catch (e) {
    return { ok: false, skipped: false, reason: e instanceof Error ? e.message : 'network' }
  }
}
