// Logic for deriving the exhibition list (both the 3D scene and the UI panel read the same result)
import { useMemo } from 'react'
import { ARTWORKS, type ArtworkData } from './artworks'
import { isFrameKey, MATS, HANGINGS, CAPTIONS, resolveLayout, type LayoutDef } from './presets'
import { effectiveSlotCount } from './limits'
import { placeWorks, toPlacement, type Placement } from './arrangement'
import { useGallery, useSettings, type Settings } from './store'

/** Usable slots for the current layout (layout slots capped by the plan's works-per-gallery) */
export function slotCount(s: Settings): number {
  return effectiveSlotCount(resolveLayout(s.layout, s.layoutParams).slots.length, s.workCap)
}

/** The full placement: which work hangs on which physical slot (honouring the room's
 *  manual arrangement §11.13), plus the parallel list/slots arrays consumers read. */
export function buildPlacement(s: Settings, own: ArtworkData[]): Placement {
  const demo = s.showDemo ? ARTWORKS : []
  const perSlot = placeWorks(slotCount(s), s.arrangement, own, demo)
  return toPlacement(perSlot, own.length + demo.length)
}

export function buildExhibitionList(s: Settings, own: ArtworkData[]): ArtworkData[] {
  return buildPlacement(s, own).list
}

export function overflowCount(s: Settings, ownCount: number): number {
  const total = ownCount + (s.showDemo ? ARTWORKS.length : 0)
  // Surplus works auto-fill every slot, so anything past the slot count is hidden.
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

/** True when a signed-in owner is looking at their OWN room (the /demo editor),
 *  as opposed to a guest browsing the sample show or a visitor on a public page.
 *  The fictional demo collection is a guest concept, so it's never blended into a
 *  real room — that keeps the editor matching what publishing produces. This lives
 *  in derived state (not persisted settings), so signing out can't leak an owner's
 *  "no demo" preference into the guest experience.
 *  Requires an actual gallery row (matching HudTop's owner branch): a signed-in
 *  user who hasn't created a room yet is still just walking the sample show, so
 *  the demo must stay — otherwise they'd get an empty room under a "ten works" HUD. */
export function useIsOwnerEditing(): boolean {
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const visitor = useGallery((s) => s.visitor)
  return !!user && !!myGallery && !visitor
}

/** Effective settings for display: an owner's room drops the demo collection */
function effectiveForOwner(s: Settings, ownerEditing: boolean): Settings {
  return ownerEditing && s.showDemo ? { ...s, showDemo: false } : s
}

/** Full placement: works in slot order + the physical slot each one hangs on (§11.13).
 *  The scene, minimap and walk controls read `slots` so a work lands on its chosen
 *  wall (and empty slots stay empty); everything else just needs `list`. */
export function usePlacement(): Placement {
  const settings = useSettings()
  const own = useOwnArtworks()
  const ownerEditing = useIsOwnerEditing()
  return useMemo(
    () => buildPlacement(effectiveForOwner(settings, ownerEditing), own),
    [settings, own, ownerEditing]
  )
}

/** The list of currently exhibited works, in slot order (capped at the number of slots) */
export function useExhibitionList(): ArtworkData[] {
  return usePlacement().list
}

// Effective design per work: the override when set (and valid), else the gallery default
export function frameKeyFor(s: Settings, art: ArtworkData): string {
  const key = s.frameOverrides[art.id]
  return key && isFrameKey(key) ? key : s.frame
}

export function matKeyFor(s: Settings, art: ArtworkData): string {
  const key = s.matOverrides[art.id]
  return key && MATS[key] ? key : s.mat
}

export function hangingKeyFor(s: Settings, art: ArtworkData): string {
  const key = s.hangingOverrides[art.id]
  return key && HANGINGS[key] ? key : s.hanging
}

export function captionKeyFor(s: Settings, art: ArtworkData): string {
  const key = s.captionOverrides[art.id]
  return key && CAPTIONS[key] ? key : s.caption
}

/** Set a per-work override — picking the gallery-wide value clears it instead,
 *  so the work follows future theme/global changes again */
export function setOverride(
  map: Record<string, string>,
  artId: string,
  key: string,
  galleryDefault: string
): Record<string, string> {
  const next = { ...map }
  if (key === galleryDefault) delete next[artId]
  else next[artId] = key
  return next
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
