// canvas 生成テクスチャと共有キャッシュ(プロトタイプ gallery.js から移植)
import * as THREE from 'three'
import { renderArtworkCanvas, type ArtworkData } from '@/lib/artworks'

/* ---- 漆喰のざらつき(手続き生成のバンプマップ — 外部素材不要) ---- */

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

/* ---- 作品テクスチャ(再構築をまたいで使い回す) ---- */

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

/* ---- 銘板 ---- */

export function makePlaqueTexture(art: ArtworkData, index: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 300
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#efece4'
  ctx.fillRect(0, 0, 512, 300)
  ctx.fillStyle = '#b3402e'
  ctx.font = '500 26px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText(`No. ${String(index + 1).padStart(2, '0')}`, 42, 66)
  ctx.fillStyle = '#22201c'
  ctx.font = '600 44px "Shippori Mincho", serif'
  ctx.fillText(art.title, 42, 130)
  ctx.fillStyle = '#55524b'
  ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText(`${art.artist} / ${art.year}`, 42, 190)
  ctx.font = '300 24px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText((art.tags || []).join(' ・ '), 42, 244)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ---- タイトルウォール ---- */

export interface TitleWallText {
  main: string
  sub: string
  note1: string
  note2: string
}

export const DEFAULT_TITLE_TEXT: TitleWallText = {
  main: 'HAKONIWA',
  sub: '― 10人の作家による常設展 ―',
  note1: 'タイムラインで流れて消える一枚を、歩いて出会う一枚へ。',
  note2: 'ここは、あなたの箱庭になる予定の場所です。',
}

export function makeTitleTexture(dark: boolean, text: TitleWallText = DEFAULT_TITLE_TEXT): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const ctx = c.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.fillStyle = '#d4a24e'
  ctx.font = '500 40px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText('E X H I B I T I O N', 1024, 210)
  ctx.fillStyle = dark ? '#22201c' : '#ece7de'
  // タイトルが長い場合は幅に収まるよう縮める
  ctx.font = '500 190px "Shippori Mincho", serif'
  const mainWidth = ctx.measureText(text.main).width
  if (mainWidth > 1800) ctx.font = `500 ${Math.max(80, Math.floor(190 * (1800 / mainWidth)))}px "Shippori Mincho", serif`
  ctx.fillText(text.main, 1024, 450)
  ctx.font = '500 74px "Shippori Mincho", serif'
  ctx.fillText(text.sub, 1024, 600)
  ctx.fillStyle = dark ? '#6b665e' : '#9a938a'
  ctx.font = '300 44px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText(text.note1, 1024, 750)
  ctx.fillText(text.note2, 1024, 830)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ---- 床の木目(three.js 公式サンプル素材 / MIT) ---- */

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

/* ---- 額縁の仕上げ質感(手続き生成、種類ごとにキャッシュ) ---- */
// 「完全に均一なラフネス」がプラスチックに見える原因なので、微細なムラを与える

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
        // 木目のゆらぎ
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
    // ブラシ研磨の細い筋
    bumpMap = make((ctx) => streaks(ctx, true, 220, 0.07))
    roughnessMap = make((ctx) => streaks(ctx, true, 320, 0.2))
  } else {
    // 塗装のゆず肌
    bumpMap = make((ctx) => speckle(ctx, 2600, 0.1))
    roughnessMap = make((ctx) => speckle(ctx, 2000, 0.14))
  }
  const out = { bumpMap, roughnessMap }
  finishCache.set(kind, out)
  return out
}

/** useMemo + アンマウント時 dispose の小道具 */
export function disposeAll(objs: Array<{ dispose(): void } | null | undefined>) {
  for (const o of objs) o?.dispose()
}
