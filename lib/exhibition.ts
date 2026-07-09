// Logic for deriving the exhibition list (both the 3D scene and the UI panel read the same result)
import { useMemo } from 'react'
import { ARTWORKS, type ArtworkData } from './artworks'
import { LAYOUTS, FRAMES, type LayoutDef } from './presets'
import { effectiveSlotCount } from './limits'
import { useGallery, useSettings, type Settings } from './store'

/** Usable slots for the current layout (layout slots capped by the plan's works-per-gallery) */
export function slotCount(s: Settings): number {
  return effectiveSlotCount(LAYOUTS[s.layout].slots.length)
}

export function buildExhibitionList(s: Settings, own: ArtworkData[]): ArtworkData[] {
  const list = [...own, ...(s.showDemo ? ARTWORKS : [])]
  return list.slice(0, slotCount(s))
}

export function overflowCount(s: Settings, ownCount: number): number {
  const total = ownCount + (s.showDemo ? ARTWORKS.length : 0)
  return Math.max(0, total - slotCount(s))
}

/** Your own exhibited works (visitor mode = public data, signed in = cloud, guest = localStorage) */
export function useOwnArtworks(): ArtworkData[] {
  const visitorArts = useGallery((s) => s.visitor?.artworks)
  const user = useGallery((s) => s.user)
  const cloud = useGallery((s) => s.cloudArtworks)
  const local = useGallery((s) => s.artworks)
  return visitorArts ?? (user ? cloud : local)
}

/** The list of currently exhibited works (capped at the number of slots) */
export function useExhibitionList(): ArtworkData[] {
  const settings = useSettings()
  const own = useOwnArtworks()
  return useMemo(() => buildExhibitionList(settings, own), [settings, own])
}

export function frameKeyFor(s: Settings, art: ArtworkData): string {
  const key = s.frameOverrides[art.id]
  return key && FRAMES[key] ? key : s.frame
}

// Determine display size from aspect ratio (landscape keys off width, portrait off height)
export function artSize(ratio: [number, number]): { width: number; height: number } {
  const [rw, rh] = ratio
  let height = rw >= rh ? 1.3 : 1.6
  let width = (height * rw) / rh
  if (width > 2.6) {
    // Cap extreme panoramas by width
    width = 2.6
    height = (width * rh) / rw
  }
  return { width, height }
}

export interface Solid {
  x: number
  z: number
  hw: number
  hd: number
}

// Collision volumes for walking (benches, central partitions)
export function getSolids(layout: LayoutDef): Solid[] {
  return [
    ...layout.benches.map((b) => ({ x: b.x, z: b.z, hw: 1.25, hd: 0.5 })),
    ...layout.partitions.map((p) => ({ x: p.x, z: p.z, hw: p.w / 2 + 0.35, hd: p.t / 2 + 0.35 })),
  ]
}
