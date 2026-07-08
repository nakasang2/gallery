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

/* ---- Artwork textures (reused across scene rebuilds) ---- */

const texLoader = new THREE.TextureLoader()
const artTexCache = new Map<string, THREE.Texture>()

export function getArtTexture(art: ArtworkData): THREE.Texture {
  const key = art.src || art.id
  const cached = artTexCache.get(key)
  if (cached) return cached
  const tex = art.src ? texLoader.load(art.src) : new THREE.CanvasTexture(renderArtworkCanvas(art, 1024))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
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
  ctx.fillText((art.tags || []).join(' · '), 42, 244)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ---- Title wall ---- */

export interface TitleWallText {
  main: string
  sub: string
  note1: string
  note2: string
}

export const DEFAULT_TITLE_TEXT: TitleWallText = {
  main: 'HAKONIWA',
  sub: '— A Permanent Collection of Ten Artists —',
  note1: 'From a feed that scrolls past, to a room you walk through.',
  note2: 'This space is waiting to become yours.',
}

export function makeTitleTexture(dark: boolean, text: TitleWallText = DEFAULT_TITLE_TEXT): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const ctx = c.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.fillStyle = '#d4a24e'
  ctx.font = '500 40px "Geist", sans-serif'
  ctx.fillText('E X H I B I T I O N', 1024, 210)
  ctx.fillStyle = dark ? '#22201c' : '#ece7de'
  // Shrink the title to fit the width when it's too long
  ctx.font = '400 190px "Instrument Serif", serif'
  const mainWidth = ctx.measureText(text.main).width
  if (mainWidth > 1800) ctx.font = `400 ${Math.max(80, Math.floor(190 * (1800 / mainWidth)))}px "Instrument Serif", serif`
  ctx.fillText(text.main, 1024, 450)
  ctx.font = '400 74px "Instrument Serif", serif'
  ctx.fillText(text.sub, 1024, 600)
  ctx.fillStyle = dark ? '#6b665e' : '#9a938a'
  ctx.font = '300 44px "Geist", sans-serif'
  ctx.fillText(text.note1, 1024, 750)
  ctx.fillText(text.note2, 1024, 830)
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
    t.anisotropy = 8
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

/** Helper for useMemo + dispose on unmount */
export function disposeAll(objs: Array<{ dispose(): void } | null | undefined>) {
  for (const o of objs) o?.dispose()
}
