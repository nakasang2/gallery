// Sample artwork data and the generative-art renderer.
// A seeded PRNG means the same work always renders to the same image.

export type Rnd = () => number
type StyleFn = (ctx: CanvasRenderingContext2D, w: number, h: number, pal: string[], rnd: Rnd) => void

// Shared type for demo works (generative art) and user-submitted works (with src).
export interface ArtworkData {
  id: string
  title: string
  artist: string
  year: number
  desc: string
  tags: string[]
  ratio: [number, number]
  /** Media for user-submitted works (dataURL or URL). Unset for demo works. */
  src?: string
  /** Media type (image when unset). */
  kind?: 'image' | 'video'
  /** Poster image URL for video (used for list thumbnails, OGP, and the pre-play frame). */
  poster?: string
  /** Where to buy this specific work (the artist's shop, Etsy, a DM link…). Shown
   *  to visitors on the artwork panel; unset means "not for sale here". */
  purchaseUrl?: string
  /** Audio-guide narration URL for this work; played on the artwork panel and,
   *  during the guided tour, automatically as each work comes into focus. */
  audioUrl?: string
  /** The following are for demo generative art. */
  style?: string
  palette?: keyof typeof PALETTES
  seed?: number
}

export function mulberry32(seed: number): Rnd {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PALETTES = {
  yoake: ['#2b2d42', '#5b4a68', '#d4726a', '#e8a87c', '#f5e6c8'],
  shinkai: ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#d8f3f1'],
  hihou: ['#0d0b08', '#2a1f14', '#8a6d3b', '#d4a24e', '#f0e6d2'],
  matsuri: ['#241023', '#6b0f1a', '#b91372', '#f2542d', '#f5dfbb'],
  mori: ['#16241a', '#3e5622', '#7ca982', '#c5e0b4', '#f1f7ed'],
  sora: ['#46527d', '#7286d3', '#8ea7e9', '#a3c4f3', '#e7efff'],
  sumi: ['#f4f1ea', '#dcd6c9', '#55524b', '#22201c', '#b3402e'],
}

export const ARTWORKS: ArtworkData[] = [
  {
    id: 'a01', title: 'Breathing at Dawn', artist: 'Minato Aoi', year: 2025,
    ratio: [4, 3], style: 'waves', palette: 'yoake', seed: 11,
    desc: 'From a series that renders the few minutes between sleep and waking as layer upon layer of folded ridgelines.',
    tags: ['Painting', 'Abstract'],
  },
  {
    id: 'a02', title: 'Letters from the Deep', artist: 'Haru Hikino', year: 2024,
    ratio: [3, 4], style: 'orbs', palette: 'shinkai', seed: 27,
    desc: 'Air bubbles rising from where no light reaches, read as letters that were never meant to arrive.',
    tags: ['Digital', 'Abstract'],
  },
  {
    id: 'a03', title: 'Golden Reverb', artist: 'KAEDE', year: 2025,
    ratio: [1, 1], style: 'thread', palette: 'hihou', seed: 42,
    desc: 'A drawing built on one hypothesis: a sound that has ended does not vanish — it stays in the room as thread.',
    tags: ['Generative'],
  },
  {
    id: 'a04', title: 'After the Festival', artist: 'Rui Tsukishima', year: 2023,
    ratio: [3, 4], style: 'bauhaus', palette: 'matsuri', seed: 8,
    desc: 'The colours left in a shrine courtyard after the stalls have been folded away, reassembled as geometric fragments.',
    tags: ['Graphic', 'Geometry'],
  },
  {
    id: 'a05', title: 'Outline of a Forest', artist: 'Konomi Shiraishi', year: 2025,
    ratio: [4, 3], style: 'mosaic', palette: 'mori', seed: 63,
    desc: 'Not a single leaf, but the moment a “forest” emerges as a whole — traced through an accumulation of colour fields.',
    tags: ['Painting', 'Landscape'],
  },
  {
    id: 'a06', title: 'The Weight of Sky', artist: 'Minato Aoi', year: 2024,
    ratio: [3, 2], style: 'horizon', palette: 'sora', seed: 5,
    desc: 'Even a clear sky has mass. A field study of blue gradients settling onto the horizon.',
    tags: ['Landscape', 'Abstract'],
  },
  {
    id: 'a07', title: 'Quiet Heat', artist: 'Aki Tono', year: 2025,
    ratio: [3, 4], style: 'fields', palette: 'hihou', seed: 91,
    desc: 'The shapeless temperature of a feeling before it finds words. The edges of each colour field are left to bleed.',
    tags: ['Painting', 'Color Field'],
  },
  {
    id: 'a08', title: 'Ink Garden', artist: 'Tamaki Suzuri', year: 2024,
    ratio: [3, 4], style: 'ink', palette: 'sumi', seed: 19,
    desc: 'From a series of single-stroke works that treat the accident between brush and drying paper as a garden.',
    tags: ['Ink', 'Drawing'],
  },
  {
    id: 'a09', title: 'Transience', artist: 'KAEDE', year: 2025,
    ratio: [1, 1], style: 'arcs', palette: 'sora', seed: 74,
    desc: 'Concentric circles in place of a clock. The further from the centre, the faster time runs.',
    tags: ['Generative', 'Minimal'],
  },
  {
    // The only video work in the demo (with sound). As you approach, rain and distant thunder become audible.
    // style/palette are kept for generating the landing-page thumbnail.
    id: 'a10', title: 'Distant Thunder', artist: 'Rui Tsukishima', year: 2025,
    ratio: [9, 16], style: 'rain', palette: 'shinkai', seed: 33,
    kind: 'video', src: '/demo-works/enrai.webm', poster: '/demo-works/enrai-poster.jpg',
    desc: 'Just before a downpour, the air begins to move vertically. I wanted to isolate only those few seconds of tension. As you come closer, you hear the rain.',
    tags: ['Video', 'Sound'],
  },
]

/* ---- Draw functions for each style ---- */

const styles: Record<string, StyleFn> = {
  waves(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[0]
    ctx.fillRect(0, 0, w, h)
    const layers = 26
    for (let i = 0; i < layers; i++) {
      const t = i / layers
      const baseY = h * (0.15 + t * 0.95)
      const amp = h * (0.04 + rnd() * 0.09)
      const freq = 1.2 + rnd() * 2.4
      const phase = rnd() * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 6) {
        const y = baseY + Math.sin((x / w) * Math.PI * freq + phase) * amp
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const c = pal[1 + Math.floor(t * (pal.length - 1.01))]
      ctx.globalAlpha = 0.55 + rnd() * 0.3
      ctx.fillStyle = c
      ctx.fill()
    }
    ctx.globalAlpha = 1
  },

  orbs(ctx, w, h, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, pal[1])
    g.addColorStop(1, pal[0])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 38; i++) {
      const x = rnd() * w
      const y = rnd() * h
      const r = (0.02 + rnd() * rnd() * 0.16) * w
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      const c = pal[2 + Math.floor(rnd() * 3)]
      grad.addColorStop(0, c)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.25 + rnd() * 0.5
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  },

  thread(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[0]
    ctx.fillRect(0, 0, w, h)
    const pts = []
    const n = 26
    for (let i = 0; i < n; i++) {
      const edge = Math.floor(rnd() * 4)
      const t = rnd()
      if (edge === 0) pts.push([t * w, 0])
      else if (edge === 1) pts.push([w, t * h])
      else if (edge === 2) pts.push([t * w, h])
      else pts.push([0, t * h])
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rnd() > 0.42) continue
        const c = pal[2 + Math.floor(rnd() * 3)]
        ctx.strokeStyle = c
        ctx.globalAlpha = 0.14 + rnd() * 0.4
        ctx.lineWidth = rnd() < 0.12 ? 2.2 : 0.9
        ctx.beginPath()
        ctx.moveTo(pts[i][0], pts[i][1])
        const mx = (pts[i][0] + pts[j][0]) / 2 + (rnd() - 0.5) * w * 0.3
        const my = (pts[i][1] + pts[j][1]) / 2 + (rnd() - 0.5) * h * 0.3
        ctx.quadraticCurveTo(mx, my, pts[j][0], pts[j][1])
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  },

  bauhaus(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[4]
    ctx.fillRect(0, 0, w, h)
    const cols = 4
    const rows = Math.round((cols * h) / w)
    const cw = w / cols
    const ch = h / rows
    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        const x = gx * cw
        const y = gy * ch
        const c1 = pal[Math.floor(rnd() * 4)]
        const c2 = pal[Math.floor(rnd() * 4)]
        const kind = Math.floor(rnd() * 5)
        ctx.fillStyle = c1
        ctx.fillRect(x, y, cw + 1, ch + 1)
        ctx.fillStyle = c2
        ctx.beginPath()
        if (kind === 0) {
          ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) / 2, 0, Math.PI * 2)
        } else if (kind === 1) {
          const start = Math.floor(rnd() * 4) * (Math.PI / 2)
          ctx.moveTo(x + cw / 2, y + ch / 2)
          ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) / 2, start, start + Math.PI)
        } else if (kind === 2) {
          ctx.moveTo(x, y + ch)
          ctx.lineTo(x + cw / 2, y)
          ctx.lineTo(x + cw, y + ch)
        } else if (kind === 3) {
          const r = Math.min(cw, ch) / 2
          const corner = Math.floor(rnd() * 4)
          const cx = x + (corner % 2) * cw
          const cy = y + Math.floor(corner / 2) * ch
          ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2)
        } else {
          ctx.rect(x + cw * 0.2, y + ch * 0.2, cw * 0.6, ch * 0.6)
        }
        ctx.fill()
      }
    }
  },

  mosaic(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[4]
    ctx.fillRect(0, 0, w, h)
    const n = 15
    const cw = w / n
    const rows = Math.ceil(h / cw)
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < n; gx++) {
        // A loose island shape, darker colours tending to appear toward the centre.
        const dx = (gx / n - 0.5) * 2
        const dy = (gy / rows - 0.5) * 2
        const d = Math.sqrt(dx * dx + dy * dy)
        const level = Math.max(0, Math.min(3.99, (1 - d) * 4 + (rnd() - 0.5) * 2.2))
        ctx.fillStyle = pal[3 - Math.floor(level)] ?? pal[0]
        const pad = cw * 0.06
        ctx.fillRect(gx * cw + pad, gy * cw + pad, cw - pad * 2, cw - pad * 2)
      }
    }
  },

  horizon(ctx, w, h, pal, rnd) {
    const bands = 5
    for (let i = 0; i < bands; i++) {
      const y0 = (h / bands) * i
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h / bands)
      g.addColorStop(0, pal[Math.min(4, i + 1)])
      g.addColorStop(1, pal[Math.min(4, i)])
      ctx.fillStyle = g
      ctx.fillRect(0, y0 - 1, w, h / bands + 2)
    }
    // Sun
    const sx = w * (0.3 + rnd() * 0.4)
    const sy = h * (0.28 + rnd() * 0.2)
    const sr = w * 0.09
    ctx.fillStyle = pal[4]
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(sx, sy, sr, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // Faint undulation along the horizon.
    ctx.fillStyle = pal[0]
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, h * 0.72 + Math.sin(x * 0.012 + rnd() * 0.2) * h * 0.012)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  },

  fields(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[0]
    ctx.fillRect(0, 0, w, h)
    const zones: [number, number, number, number, string][] = [
      [0.08, 0.08, 0.84, 0.42, pal[3]],
      [0.08, 0.52, 0.84, 0.28, pal[2]],
      [0.08, 0.82, 0.84, 0.1, pal[4]],
    ]
    for (const [zx, zy, zw, zh, color] of zones) {
      // Bleeding edges: overlay translucent rectangles, each nudged slightly.
      for (let i = 0; i < 14; i++) {
        const jx = (rnd() - 0.5) * w * 0.02
        const jy = (rnd() - 0.5) * h * 0.015
        ctx.globalAlpha = 0.12
        ctx.fillStyle = color
        ctx.fillRect(zx * w + jx, zy * h + jy, zw * w, zh * h)
      }
    }
    ctx.globalAlpha = 1
  },

  ink(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[0]
    ctx.fillRect(0, 0, w, h)
    // Paper texture.
    for (let i = 0; i < 900; i++) {
      ctx.globalAlpha = 0.04
      ctx.fillStyle = pal[1]
      ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5)
    }
    ctx.globalAlpha = 1
    // Brushstrokes (random walk).
    const strokes = 7
    for (let s = 0; s < strokes; s++) {
      let x = w * (0.2 + rnd() * 0.6)
      let y = h * (0.12 + rnd() * 0.3)
      let angle = Math.PI / 2 + (rnd() - 0.5) * 0.8
      const len = 30 + rnd() * 60
      const dark = rnd() < 0.6
      for (let i = 0; i < len; i++) {
        const step = 4 + rnd() * 6
        const nx = x + Math.cos(angle) * step
        const ny = y + Math.sin(angle) * step
        ctx.strokeStyle = dark ? pal[3] : pal[2]
        ctx.globalAlpha = (dark ? 0.75 : 0.4) * (1 - i / len) + 0.08
        ctx.lineWidth = Math.max(0.6, (1 - i / len) * (dark ? 9 : 5) * (0.6 + rnd() * 0.7))
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        x = nx
        y = ny
        angle += (rnd() - 0.5) * 0.55
        if (y > h * 0.94) break
      }
    }
    ctx.globalAlpha = 1
    // Artist's seal.
    const seal = w * 0.06
    ctx.fillStyle = pal[4]
    ctx.fillRect(w * 0.84, h * 0.82, seal, seal * 1.4)
    ctx.fillStyle = pal[0]
    ctx.fillRect(w * 0.84 + seal * 0.22, h * 0.82 + seal * 0.25, seal * 0.24, seal * 0.4)
    ctx.fillRect(w * 0.84 + seal * 0.56, h * 0.82 + seal * 0.5, seal * 0.22, seal * 0.55)
  },

  arcs(ctx, w, h, pal, rnd) {
    ctx.fillStyle = pal[4]
    ctx.fillRect(0, 0, w, h)
    const cx = w * (0.35 + rnd() * 0.3)
    const cy = h * (0.35 + rnd() * 0.3)
    const rings = 30
    for (let i = rings; i > 0; i--) {
      const r = (i / rings) * Math.max(w, h) * 0.75
      ctx.strokeStyle = pal[i % 4]
      ctx.lineWidth = 2 + rnd() * (w * 0.02)
      ctx.globalAlpha = 0.5 + rnd() * 0.5
      const start = rnd() * Math.PI * 2
      const span = Math.PI * (0.6 + rnd() * 1.4)
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, start + span)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = pal[1]
    ctx.beginPath()
    ctx.arc(cx, cy, w * 0.025, 0, Math.PI * 2)
    ctx.fill()
  },

  rain(ctx, w, h, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, pal[0])
    g.addColorStop(0.7, pal[1])
    g.addColorStop(1, pal[2])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    // Bloom of distant thunder.
    for (let i = 0; i < 4; i++) {
      const x = rnd() * w
      const y = rnd() * h * 0.4
      const r = w * (0.1 + rnd() * 0.2)
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, pal[4])
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.18
      ctx.fillStyle = grad
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // Vertical streaks of rain.
    for (let i = 0; i < 240; i++) {
      const x = rnd() * w
      const y = rnd() * h
      const len = h * (0.03 + rnd() * 0.14)
      ctx.strokeStyle = pal[3 + Math.floor(rnd() * 2)]
      ctx.globalAlpha = 0.08 + rnd() * 0.3
      ctx.lineWidth = 0.8 + rnd() * 1.4
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (rnd() - 0.5) * 6, y + len)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  },
}

/** Render a work to a canvas and return it (longSide = pixel length of the longer edge). */
export function renderArtworkCanvas(art: ArtworkData, longSide = 768): HTMLCanvasElement {
  const [rw, rh] = art.ratio
  const w = rw >= rh ? longSide : Math.round((longSide * rw) / rh)
  const h = rw >= rh ? Math.round((longSide * rh) / rw) : longSide
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rnd = mulberry32((art.seed ?? 1) * 7919 + 17)
  styles[art.style ?? 'waves'](ctx, w, h, PALETTES[art.palette ?? 'yoake'], rnd)
  return canvas
}
