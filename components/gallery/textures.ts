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
  title: 'HAKONIWA',
  subtitle: '— A Permanent Collection of Ten Artists —',
  statement: 'From a feed that scrolls past, to a room you walk through. This space is waiting to become yours.',
}

// Wrap free-form text into at most `maxLines` lines that actually FIT maxW.
// Prefers space boundaries, but breaks by character inside any token wider than
// a line — Japanese statements have no spaces and must never overflow the board.
function wrapNote(ctx: CanvasRenderingContext2D, s: string, maxW: number, maxLines: number): string[] {
  const fits = (t: string) => ctx.measureText(t).width <= maxW
  const out: string[] = []
  let line = ''
  let overflow = false
  const words = s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  outer: for (const word of words) {
    let w = word
    while (w) {
      const attempt = line ? `${line} ${w}` : w
      if (fits(attempt)) {
        line = attempt
        break
      }
      if (line) {
        out.push(line)
        line = ''
        if (out.length === maxLines) {
          overflow = true
          break outer
        }
        continue
      }
      // A single token wider than the line: take the widest fitting chunk
      let chunk = ''
      for (const ch of w) {
        if (!fits(chunk + ch)) break
        chunk += ch
      }
      if (!chunk) chunk = w[0] ?? ''
      out.push(chunk)
      w = w.slice(chunk.length)
      if (out.length === maxLines) {
        overflow = true
        break outer
      }
    }
  }
  if (!overflow && line) {
    if (out.length < maxLines) out.push(line)
    else overflow = true
  }
  if (overflow && out.length) {
    let last = out[out.length - 1]
    while (last && !fits(`${last}…`)) last = last.slice(0, -1)
    out[out.length - 1] = `${last}…`
  }
  return out
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
  avatar?: HTMLImageElement | null
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const ctx = c.getContext('2d')!
  const ink = dark ? '#22201c' : '#ece7de'
  const muted = dark ? '#6b665e' : '#9a938a'
  const gold = '#d4a24e'

  const hasArtist = !!text.artist || !!avatar
  // With an artist, the board splits into two GROUPED blocks: the exhibition
  // (eyebrow / title / statement) on the left, the artist (avatar / name /
  // handle / bio) on the right, separated by a hairline. The guest demo board
  // keeps the single centred column.
  const exCX = hasArtist ? 740 : 1024
  const exMaxW = hasArtist ? 1160 : 1660

  const exRows: BoardRow[] = []
  ctx.textAlign = 'center'
  exRows.push({
    h: 84,
    draw: (top) => {
      ctx.fillStyle = gold
      ctx.font = '500 38px "Geist", sans-serif'
      ctx.fillText('E X H I B I T I O N', exCX, top + 40)
    },
  })
  exRows.push({
    h: 186,
    draw: (top) => {
      ctx.fillStyle = ink
      // Shrink the title to fit the column when it's too long
      ctx.font = '400 170px "Instrument Serif", serif'
      const w = ctx.measureText(text.title).width
      if (w > exMaxW) ctx.font = `400 ${Math.max(76, Math.floor(170 * (exMaxW / w)))}px "Instrument Serif", serif`
      ctx.fillText(text.title, exCX, top + 148)
    },
  })
  if (text.subtitle) {
    exRows.push({
      h: 100,
      draw: (top) => {
        ctx.fillStyle = ink
        ctx.font = '400 68px "Instrument Serif", serif'
        ctx.fillText(text.subtitle!, exCX, top + 66)
      },
    })
  }
  const STMT_FONT = '300 42px "Geist", sans-serif'
  ctx.font = STMT_FONT
  const stmtLines = text.statement ? wrapNote(ctx, text.statement, exMaxW, 4) : []
  if (stmtLines.length) {
    exRows.push({
      h: 50,
      draw: (top) => {
        ctx.fillStyle = gold
        ctx.fillRect(exCX - 56, top + 24, 112, 3)
      },
    })
    for (const line of stmtLines) {
      exRows.push({
        h: 64,
        draw: (top) => {
          ctx.fillStyle = muted
          ctx.font = STMT_FONT
          ctx.fillText(line, exCX, top + 46)
        },
      })
    }
  }
  drawRows(exRows, 0, 1024)

  if (hasArtist) {
    // Hairline between the two blocks
    ctx.fillStyle = dark ? 'rgba(34,32,28,0.28)' : 'rgba(236,231,222,0.22)'
    ctx.fillRect(1398, 212, 2, 600)

    const aCX = 1712
    const artist = text.artist
    const BIO_FONT = '300 34px "Geist", sans-serif'
    ctx.font = BIO_FONT
    const bioLines = artist?.bio ? wrapNote(ctx, artist.bio, 560, 4) : []
    const aRows: BoardRow[] = []
    const R = 92
    if (avatar) {
      aRows.push({
        h: R * 2 + 44,
        draw: (top) => {
          const cy = top + R
          ctx.save()
          ctx.beginPath()
          ctx.arc(aCX, cy, R, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(avatar, aCX - R, cy - R, R * 2, R * 2)
          ctx.restore()
          ctx.beginPath()
          ctx.arc(aCX, cy, R + 4, 0, Math.PI * 2)
          ctx.strokeStyle = gold
          ctx.lineWidth = 4
          ctx.stroke()
        },
      })
    }
    // Skip the name line when the exhibition title already IS the artist's name
    if (artist?.name && artist.name !== text.title) {
      aRows.push({
        h: 84,
        draw: (top) => {
          ctx.fillStyle = ink
          ctx.font = '400 62px "Instrument Serif", serif'
          ctx.fillText(artist.name, aCX, top + 58)
        },
      })
    }
    if (artist?.handle) {
      aRows.push({
        h: 62,
        draw: (top) => {
          ctx.fillStyle = gold
          ctx.font = '400 34px "Geist", sans-serif'
          ctx.fillText(`@${artist.handle}`, aCX, top + 36)
        },
      })
    }
    if (bioLines.length) {
      aRows.push({ h: 18, draw: () => {} })
      for (const line of bioLines) {
        aRows.push({
          h: 52,
          draw: (top) => {
            ctx.fillStyle = muted
            ctx.font = BIO_FONT
            ctx.fillText(line, aCX, top + 38)
          },
        })
      }
    }
    drawRows(aRows, 0, 1024)
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
