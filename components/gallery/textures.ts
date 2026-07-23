// Canvas-generated textures and shared cache (ported from the gallery.js prototype)
import * as THREE from 'three'
import { renderArtworkCanvas, type ArtworkData } from '@/lib/artworks'

/* ---- Plaster grain (procedural bump map — no external assets needed) ---- */

let plasterBump: THREE.CanvasTexture | null = null

export function getPlasterBump(size = 512): THREE.CanvasTexture {
  if (plasterBump) return plasterBump
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 30
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 30 + Math.random() * 90
    const v = Math.random() > 0.5 ? 255 : 0
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${v},${v},${v},0.05)`)
    g.addColorStop(1, 'rgba(128,128,128,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  plasterBump = new THREE.CanvasTexture(c)
  plasterBump.wrapS = plasterBump.wrapT = THREE.RepeatWrapping
  return plasterBump
}

/* ---- Plaster normal map (procedural) ----
   A normal map picks up grazing light more correctly than a bump map (a height
   approximation), which kills the "flat plastic wall" look. We build a height
   field from multi-octave noise and convert it to normals with a Sobel filter. */

let plasterNormal: THREE.CanvasTexture | null = null

export function getPlasterNormal(size = 512): THREE.CanvasTexture {
  if (plasterNormal) return plasterNormal

  // 1) Build a height field from multi-octave noise (fine grain + large swells)
  const height = new Float32Array(size * size)
  const rand = (n: number) => {
    // No need to be deterministic, so we stack layers with Math.random
    const cell = document.createElement('canvas')
    cell.width = cell.height = n
    const cx = cell.getContext('2d')!
    const img = cx.createImageData(n, n)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    cx.putImageData(img, 0, 0)
    // Stretch to size with bilinear interpolation (the browser's drawImage interpolates)
    const big = document.createElement('canvas')
    big.width = big.height = size
    const bx = big.getContext('2d')!
    bx.imageSmoothingEnabled = true
    bx.drawImage(cell, 0, 0, size, size)
    return bx.getImageData(0, 0, size, size).data
  }
  // Octaves: [cell resolution, amplitude]
  const octaves: [number, number][] = [
    [8, 0.5], // large swells (wall undulation)
    [32, 0.3],
    [128, 0.15],
    [size, 0.08], // fine grain
  ]
  for (const [cells, amp] of octaves) {
    const d = rand(cells)
    for (let i = 0; i < height.length; i++) height[i] += (d[i * 4] / 255) * amp
  }

  // 2) Derive normals with a Sobel filter and encode them into RGB
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const out = ctx.createImageData(size, size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  const strength = 2.2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      out.data[i] = ((dx / len) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  plasterNormal = new THREE.CanvasTexture(c)
  plasterNormal.wrapS = plasterNormal.wrapT = THREE.RepeatWrapping
  return plasterNormal
}

/* ---- Board-formed concrete / stone wall (procedural PBR set) ----
   The reference look for the premium themes: formwork panel seams, form-tie holes,
   aggregate pitting and faint water stains. One 1024px tile represents 3.2m x 3.2m
   (2x2 panels of 1.6m), so Room's existing repeat math puts a horizontal seam at
   1.6m height and vertical seams every 1.6m — real board-form proportions.
   The color map is kept near-neutral light gray so theme.wall still tints it. */

let concreteMaps: {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
} | null = null

// Bilinear-upscaled white noise (the same drawImage trick the plaster maps use)
function noiseLayer(size: number, cells: number): Uint8ClampedArray {
  const cell = document.createElement('canvas')
  cell.width = cell.height = cells
  const cx = cell.getContext('2d')!
  const img = cx.createImageData(cells, cells)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  cx.putImageData(img, 0, 0)
  const big = document.createElement('canvas')
  big.width = big.height = size
  const bx = big.getContext('2d')!
  bx.imageSmoothingEnabled = true
  bx.drawImage(cell, 0, 0, size, size)
  return bx.getImageData(0, 0, size, size).data
}

// Sobel-filter a height field into a tangent-space normal map
function heightToNormalCanvas(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const out = ctx.createImageData(size, size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      out.data[i] = ((dx / len) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return c
}

export function getConcreteMaps(size = 1024) {
  if (concreteMaps) return concreteMaps
  const S = size
  const M = S / 3.2 // pixels per metre

  // Shared feature geometry so height, color and roughness stay registered
  const seams = [0, S / 2] // groove centres (both axes): world 0m and 1.6m
  const holes: [number, number][] = []
  for (const px of [0.35 * M, S / 2 + 0.35 * M])
    for (const py of [0.35 * M, S / 2 + 0.35 * M]) holes.push([px, py])
  const pits: [number, number, number][] = []
  for (let i = 0; i < 2400; i++) pits.push([Math.random() * S, Math.random() * S, 0.8 + Math.random() * 2.4])

  /* height field: broad undulation + fine grain, then carve features */
  const height = new Float32Array(S * S)
  const octaves: [number, number][] = [
    [8, 0.26],
    [32, 0.2],
    [128, 0.13],
    [512, 0.07],
  ]
  for (const [cells, amp] of octaves) {
    const d = noiseLayer(S, cells)
    for (let i = 0; i < height.length; i++) height[i] += (d[i * 4] / 255) * amp
  }
  const stamp = (cx: number, cy: number, r: number, depth: number) => {
    const ri = Math.ceil(r)
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.hypot(dx, dy)
        if (d > r) continue
        const f = Math.min(1, (1 - d / r) * 2.2) // flat bottom, soft shoulder
        const x = (((cx + dx) | 0) + S) % S
        const y = (((cy + dy) | 0) + S) % S
        height[y * S + x] -= depth * f
      }
    }
  }
  for (const [x, y, r] of pits) stamp(x, y, r, 0.09)
  for (const [x, y] of holes) stamp(x, y, 0.024 * M, 0.5)
  // formwork seams: shallow grooves with a soft shoulder, both axes
  const HALF = 4
  for (const p of seams) {
    for (let w = -HALF; w <= HALF; w++) {
      const depth = 0.3 * (1 - Math.abs(w) / (HALF + 1))
      const line = (((p + w) | 0) + S) % S
      for (let t = 0; t < S; t++) {
        height[line * S + t] -= depth // horizontal groove
        height[t * S + line] -= depth // vertical groove
      }
    }
  }

  /* color map: near-neutral base + blotches, speckle, stains — theme.wall tints it */
  const cc = document.createElement('canvas')
  cc.width = cc.height = S
  const ctx = cc.getContext('2d')!
  ctx.fillStyle = '#cfcac2'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 90; i++) {
    // cloudy cement blotches, slightly warm or cool
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 40 + Math.random() * 200
    const warm = Math.random() > 0.5
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, warm ? 'rgba(146,132,116,0.07)' : 'rgba(108,112,118,0.07)')
    g.addColorStop(1, 'rgba(128,128,128,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // faint water stains bleeding down — soft stretched ellipses. Hard-edged rects
  // here read as weird dark bars/smears on the wall at room scale (user-reported).
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * S
    const w = 24 + Math.random() * 60
    const y0 = Math.random() * S * 0.5
    const len = S * (0.25 + Math.random() * 0.45)
    ctx.save()
    ctx.translate(x, y0)
    ctx.scale(w / 100, len / 100)
    const g = ctx.createRadialGradient(0, 50, 0, 0, 50, 62)
    g.addColorStop(0, 'rgba(96,90,80,0.055)')
    g.addColorStop(1, 'rgba(96,90,80,0)')
    ctx.fillStyle = g
    ctx.fillRect(-100, -20, 200, 160)
    ctx.restore()
  }
  // aggregate speckle registered with the height pits
  for (const [x, y, r] of pits) {
    const dark = Math.random() > 0.32
    ctx.fillStyle = dark ? 'rgba(70,66,60,0.16)' : 'rgba(236,233,228,0.14)'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }
  // seams: a darker shadow line inside the groove
  ctx.fillStyle = 'rgba(60,56,50,0.28)'
  for (const p of seams) {
    ctx.fillRect(0, p - 2, S, 4)
    ctx.fillRect(p - 2, 0, 4, S)
  }
  // form-tie holes: dark recessed disc with a faint rust halo below
  for (const [x, y] of holes) {
    const r = 0.024 * M
    const halo = ctx.createRadialGradient(x, y + r, r * 0.4, x, y + r, r * 3)
    halo.addColorStop(0, 'rgba(122,96,72,0.10)')
    halo.addColorStop(1, 'rgba(122,96,72,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(x, y + r, r * 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(40,37,33,0.75)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  /* roughness map: matte base, pits/seams rougher, cement patches slightly tighter */
  const rc = document.createElement('canvas')
  rc.width = rc.height = S
  const rx = rc.getContext('2d')!
  rx.fillStyle = '#dedede'
  rx.fillRect(0, 0, S, S)
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 50 + Math.random() * 180
    const v = Math.random() > 0.5 ? 255 : 190
    const g = rx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${v},${v},${v},0.10)`)
    g.addColorStop(1, 'rgba(222,222,222,0)')
    rx.fillStyle = g
    rx.beginPath()
    rx.arc(x, y, r, 0, Math.PI * 2)
    rx.fill()
  }
  rx.fillStyle = 'rgba(255,255,255,0.5)'
  for (const [x, y, r] of pits) {
    rx.beginPath()
    rx.arc(x, y, r, 0, Math.PI * 2)
    rx.fill()
  }

  const mk = (c: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(c)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 16
    return t
  }
  concreteMaps = {
    map: mk(cc, true),
    normalMap: mk(heightToNormalCanvas(height, S, 3.0)),
    roughnessMap: mk(rc),
  }
  return concreteMaps
}

/* ---- Artwork textures (reused across scene rebuilds) ---- */

const texLoader = new THREE.TextureLoader()
const artTexCache = new Map<string, THREE.Texture>()

export function getArtTexture(art: ArtworkData): THREE.Texture {
  const key = art.src || art.id
  const cached = artTexCache.get(key)
  if (cached) return cached
  const tex = art.src ? texLoader.load(art.src) : new THREE.CanvasTexture(renderArtworkCanvas(art, 1024))
  tex.colorSpace = THREE.SRGBColorSpace
  // 16 keeps the paint crisp at grazing view angles (the renderer clamps to the GPU max)
  tex.anisotropy = 16
  artTexCache.set(key, tex)
  return tex
}

/* ---- Plaque ---- */

export function makePlaqueTexture(art: ArtworkData, index: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 300
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#efece4'
  ctx.fillRect(0, 0, 512, 300)
  ctx.fillStyle = '#b3402e'
  ctx.font = '500 26px "Geist", sans-serif'
  ctx.fillText(`NO. ${String(index + 1).padStart(2, '0')}`, 42, 66)
  ctx.fillStyle = '#22201c'
  ctx.font = '400 44px "Instrument Serif", serif'
  ctx.fillText(art.title, 42, 130)
  ctx.fillStyle = '#55524b'
  ctx.font = '400 30px "Geist", sans-serif'
  ctx.fillText(`${art.artist} / ${art.year}`, 42, 190)
  ctx.font = '300 24px "Geist", sans-serif'
  // The caption line(s): the artist's own text when present, tags otherwise
  const capText = (art.desc || '').trim() || (art.tags || []).join(' · ')
  const capLines = wrapLeft(ctx, capText, 428, 2)
  capLines.forEach((line, i) => ctx.fillText(line, 42, 240 + i * 32))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Wrap free-form caption text into at most `maxLines` left-aligned lines,
// ellipsising the remainder. Character-greedy so CJK (no spaces) wraps too —
// the plate is a small label, not a reading panel.
function wrapLeft(ctx: CanvasRenderingContext2D, s: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = []
  let cur = ''
  let truncated = false
  for (const ch of s.replace(/\s+/g, ' ')) {
    if (ctx.measureText(cur + ch).width > maxW) {
      if (lines.length === maxLines - 1) {
        truncated = true
        break
      }
      lines.push(cur.trimEnd())
      cur = ch === ' ' ? '' : ch
    } else {
      cur += ch
    }
  }
  if (cur.trim() && !truncated) lines.push(cur.trimEnd())
  if (truncated) lines.push(`${cur.trimEnd()}…`)
  return lines
}

/* ---- Title wall ---- */

export interface TitleWallText {
  /** Exhibition block: eyebrow + title + statement */
  title: string
  /** Strapline under the title (the guest demo board uses this) */
  subtitle?: string
  statement?: string
  /** Artist block: avatar + name + handle + bio, grouped together */
  artist?: { name: string; handle?: string; bio?: string }
}

export const DEFAULT_TITLE_TEXT: TitleWallText = {
  title: 'XIBIT360',
  subtitle: '— A Permanent Collection of Ten Works —',
  statement: 'From a feed that scrolls past, to a room you walk through. This space is waiting to become yours.',
}

type BoardRow = { h: number; draw: (top: number) => void }

// Draw a list of measured rows as one vertically-centred block
function drawRows(rows: BoardRow[], areaTop: number, areaH: number) {
  const total = rows.reduce((s, r) => s + r.h, 0)
  let y = areaTop + Math.max(20, (areaH - total) / 2)
  for (const row of rows) {
    row.draw(y)
    y += row.h
  }
}

export function makeTitleTexture(
  dark: boolean,
  text: TitleWallText = DEFAULT_TITLE_TEXT,
  avatar?: HTMLImageElement | null,
  /** Design Tools logo/branding mark (§11.5/§11.8) — composited into the corner,
   *  independent of the exhibition/artist column layout above */
  logo?: HTMLImageElement | null
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const ctx = c.getContext('2d')!
  const ink = dark ? '#22201c' : '#ece7de'
  const gold = '#d4a24e'

  // Simplified board: one centred vertical stack — exhibition name, then the
  // exhibitor (avatar → name → @handle). Statement/bio live in the info panel now.
  const CX = 1024
  const maxW = 1660
  const artist = text.artist
  const rows: BoardRow[] = []
  ctx.textAlign = 'center'

  // 1) Exhibition name
  rows.push({
    h: 210,
    draw: (top) => {
      ctx.fillStyle = ink
      ctx.font = '400 156px "Instrument Serif", serif'
      const w = ctx.measureText(text.title).width
      if (w > maxW) ctx.font = `400 ${Math.max(80, Math.floor(156 * (maxW / w)))}px "Instrument Serif", serif`
      ctx.fillText(text.title, CX, top + 150)
    },
  })

  // 2) Exhibitor avatar
  const R = 88
  if (avatar) {
    rows.push({
      h: R * 2 + 46,
      draw: (top) => {
        const cy = top + 30 + R
        ctx.save()
        ctx.beginPath()
        ctx.arc(CX, cy, R, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(avatar, CX - R, cy - R, R * 2, R * 2)
        ctx.restore()
        ctx.beginPath()
        ctx.arc(CX, cy, R + 4, 0, Math.PI * 2)
        ctx.strokeStyle = gold
        ctx.lineWidth = 4
        ctx.stroke()
      },
    })
  }

  // 3) Exhibitor name — skip only when it would duplicate the title verbatim
  if (artist?.name && artist.name !== text.title) {
    rows.push({
      h: 82,
      draw: (top) => {
        ctx.fillStyle = ink
        ctx.font = '400 60px "Instrument Serif", serif'
        ctx.fillText(artist.name, CX, top + 58)
      },
    })
  }

  // 4) @account
  if (artist?.handle) {
    rows.push({
      h: 56,
      draw: (top) => {
        ctx.fillStyle = gold
        ctx.font = '400 36px "Geist", sans-serif'
        ctx.fillText(`@${artist.handle}`, CX, top + 36)
      },
    })
  }

  drawRows(rows, 0, 1024)

  // Design Tools logo mark — a small, fixed corner badge independent of the
  // exhibition/artist columns above, so it never fights their layout math
  if (logo && logo.width && logo.height) {
    const maxSize = 150
    const scale = Math.min(maxSize / logo.width, maxSize / logo.height, 1)
    const lw = logo.width * scale
    const lh = logo.height * scale
    const margin = 64
    ctx.globalAlpha = 0.92
    ctx.drawImage(logo, c.width - margin - lw, margin, lw, lh)
    ctx.globalAlpha = 1
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ---- Floor wood grain (three.js official sample assets / MIT) ---- */

let floorBase: { map: THREE.Texture; bumpMap: THREE.Texture; roughnessMap: THREE.Texture } | null = null

export function getFloorTextures() {
  if (floorBase) return floorBase
  const load = (url: string, srgb = false) => {
    const t = texLoader.load(url)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 16
    return t
  }
  floorBase = {
    map: load('/textures/hardwood2_diffuse.jpg', true),
    bumpMap: load('/textures/hardwood2_bump.jpg'),
    roughnessMap: load('/textures/hardwood2_roughness.jpg'),
  }
  return floorBase
}

/* ---- Frame finish texture (procedural, cached per kind) ---- */
// Perfectly uniform roughness is what reads as plastic, so we add subtle unevenness

export type FrameFinish = 'wood' | 'metal' | 'paint'

const finishCache = new Map<FrameFinish, { bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture }>()

export function getFrameFinish(kind: FrameFinish) {
  const cached = finishCache.get(kind)
  if (cached) return cached

  const size = 256
  const make = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, size, size)
    draw(ctx)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
  }

  const streaks = (ctx: CanvasRenderingContext2D, horizontal: boolean, count: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
      const p = Math.random() * size
      const v = Math.random() > 0.5 ? 255 : 0
      ctx.strokeStyle = `rgba(${v},${v},${v},${alpha * (0.4 + Math.random())})`
      ctx.lineWidth = 0.5 + Math.random() * 1.6
      ctx.beginPath()
      if (horizontal) {
        ctx.moveTo(0, p)
        // Wood-grain wobble
        for (let x = 0; x <= size; x += 16) ctx.lineTo(x, p + Math.sin(x * 0.05 + i) * 2.5)
      } else {
        ctx.moveTo(p, 0)
        ctx.lineTo(p + (Math.random() - 0.5) * 4, size)
      }
      ctx.stroke()
    }
  }

  const speckle = (ctx: CanvasRenderingContext2D, count: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
      const v = Math.random() > 0.5 ? 255 : 0
      ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4)
    }
  }

  let bumpMap: THREE.CanvasTexture
  let roughnessMap: THREE.CanvasTexture
  if (kind === 'wood') {
    bumpMap = make((ctx) => streaks(ctx, true, 90, 0.16))
    roughnessMap = make((ctx) => {
      streaks(ctx, true, 60, 0.22)
      speckle(ctx, 900, 0.06)
    })
  } else if (kind === 'metal') {
    // Fine brushed-polish lines
    bumpMap = make((ctx) => streaks(ctx, true, 220, 0.07))
    roughnessMap = make((ctx) => streaks(ctx, true, 320, 0.2))
  } else {
    // Orange-peel texture of paint
    bumpMap = make((ctx) => speckle(ctx, 2600, 0.1))
    roughnessMap = make((ctx) => speckle(ctx, 2000, 0.14))
  }
  const out = { bumpMap, roughnessMap }
  finishCache.set(kind, out)
  return out
}

/* ---- Soft drop-shadow (a blurred dark rounded rectangle on transparent) ----
   Used behind each framed/canvas work as an art-directed contact shadow on the wall,
   so the piece reads as standing off the wall with a soft shadow regardless of the
   per-work light angle (the real shadow map alone is too faint at a near-flush mount).
   One shared texture, stretched to each work's proportions. */
let softShadowTex: THREE.CanvasTexture | null = null
export function getSoftShadowTexture(): THREE.CanvasTexture {
  if (softShadowTex) return softShadowTex
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, s, s)
  // A big blur radius gives the soft penumbra; padding leaves room for it to fade out.
  // The pad is deliberately wide (~23% a side): the frame covers the solid core, so
  // what shows on the wall is this gradient band — too narrow and the shadow reads
  // as a faint rim that vanishes on a brightly lit wall (user-reported).
  const pad = 58
  ctx.filter = `blur(${Math.round(pad * 0.75)}px)`
  // Vertical density gradient: real wall shadows are darkest at the contact area
  // just under the piece and thin out down the wall — a uniform plate reads flat
  // (user feedback: "every shadow is the same density").
  const grad = ctx.createLinearGradient(0, pad, 0, s - pad)
  grad.addColorStop(0, 'rgba(0,0,0,0.97)')
  grad.addColorStop(0.55, 'rgba(0,0,0,0.8)')
  grad.addColorStop(1, 'rgba(0,0,0,0.52)')
  ctx.fillStyle = grad
  const x = pad
  const y = pad
  const w = s - pad * 2
  const h = s - pad * 2
  const r = 24
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  softShadowTex = tex
  return tex
}

/* ---- Neutral environment map (rotationally symmetric) ----
   three's RoomEnvironment has a hot rectangular "window" on ONE side: any wall or
   floor area whose normal faces that direction picks up a broad white sheen — the
   long-hunted "white reflection on one wall only, art or not". This equirect
   gradient is uniform around the Y axis: light from above, dark below, no window.
   Frames/metals still get their vertical sheen; nothing in the room has a side. */
let neutralEnv: THREE.CanvasTexture | null = null
export function getNeutralEnvTexture(): THREE.CanvasTexture {
  if (neutralEnv) return neutralEnv
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  // Bright enough that metals (gold/silver frames live on env light) still shine
  const g = ctx.createLinearGradient(0, 0, 0, 64)
  g.addColorStop(0, '#e8d9bd') // ceiling glow — warm gallery light from above
  g.addColorStop(0.42, '#9a9184')
  g.addColorStop(0.58, '#736a5e') // horizon band
  g.addColorStop(1, '#25211c') // floor: dark
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  neutralEnv = new THREE.CanvasTexture(c)
  neutralEnv.mapping = THREE.EquirectangularReflectionMapping
  neutralEnv.colorSpace = THREE.SRGBColorSpace
  return neutralEnv
}

/* ---- Uniform contact blob (for shadows lying ON the floor) ----
   The wall drop-shadow texture above carries a vertical density gradient, which
   is wrong for a plane rotated flat onto the floor (the gradient would point
   along +Z for no physical reason) — floor contact shadows use this radially
   symmetric blob instead. */
let blobShadowTex: THREE.CanvasTexture | null = null
export function getBlobShadowTexture(): THREE.CanvasTexture {
  if (blobShadowTex) return blobShadowTex
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.9)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  blobShadowTex = new THREE.CanvasTexture(c)
  blobShadowTex.colorSpace = THREE.SRGBColorSpace
  return blobShadowTex
}

/* ---- Canvas weave (procedural bump map for the paint surface) ----
   A perfectly flat plane under a spotlight is the biggest "screenshot on a wall"
   tell. A fine linen weave catches the raking spot light and reads as a physical
   canvas. One shared tile; Exhibit clones it with a repeat matched to the work's
   real-world size so the thread pitch stays ~1.5mm on every canvas. */
let weaveTex: THREE.CanvasTexture | null = null
export function getCanvasWeave(size = 256): THREE.CanvasTexture {
  if (weaveTex) return weaveTex
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)
  // Interleaved warp/weft threads: alternating light/dark bands both ways, with
  // per-thread jitter so it doesn't read as a printed grid
  const pitch = 4
  for (let y = 0; y < size; y += pitch) {
    const v = 128 + (Math.random() - 0.5) * 26 + ((y / pitch) % 2 === 0 ? 14 : -14)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(0, y, size, pitch / 2)
  }
  for (let x = 0; x < size; x += pitch) {
    const v = 128 + (Math.random() - 0.5) * 26 + ((x / pitch) % 2 === 0 ? 12 : -12)
    ctx.fillStyle = `rgba(${v},${v},${v},0.55)`
    ctx.fillRect(x, 0, pitch / 2, size)
  }
  weaveTex = new THREE.CanvasTexture(c)
  weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping
  return weaveTex
}

/** Helper for useMemo + dispose on unmount */
export function disposeAll(objs: Array<{ dispose(): void } | null | undefined>) {
  for (const o of objs) o?.dispose()
}
