// Which works hang in a room, and in what order — the pure half of lib/exhibition.
//
// This file exists because SERVER code needs these answers. `lib/exhibition.ts` and
// `lib/store.ts` both reach the browser-only world (React hooks, zustand, and
// lib/toast's useState), so importing either from a server component fails the build
// with "This React Hook only works in a Client Component". Everything here is a
// plain function over plain data, and `Settings` is imported as a TYPE so the
// reference to the store is erased at compile time and no cycle exists at runtime.
//
// lib/exhibition.ts re-exports all of it, so the client keeps its single import site.
import { ARTWORKS, type ArtworkData } from './artworks'
import { resolveLayout } from './presets'
import { effectiveSlotCount } from './limits'
import { placeWorks, toPlacement, balancedFillOrder, type Placement } from './arrangement'
import type { PublicExhibition } from './publish'
import type { Settings } from './store'

/** True when this scene is the guest sample show (no own works, demo collection on):
 *  a marketing showcase, so the plan's works-per-gallery cap doesn't apply — the
 *  full demo collection fills the whole room. */
function isDemoShowcase(s: Settings, ownCount: number): boolean {
  return s.showDemo && ownCount === 0
}

/** Usable slots for the current layout (layout slots capped by the plan's works-per-gallery) */
export function slotCount(s: Settings, ownCount = 1): number {
  const layoutSlots = resolveLayout(s.layout, s.layoutParams).slots.length
  return isDemoShowcase(s, ownCount) ? layoutSlots : effectiveSlotCount(layoutSlots, s.workCap)
}

/** The full placement: which work hangs on which physical slot (honouring the room's
 *  manual arrangement §11.13), plus the parallel list/slots arrays consumers read.
 *  Auto-filled works spread across the walls (balancedFillOrder) instead of packing
 *  the first wall solid. */
export function buildPlacement(s: Settings, own: ArtworkData[]): Placement {
  const demo = s.showDemo ? ARTWORKS : []
  const layout = resolveLayout(s.layout, s.layoutParams)
  const perSlot = placeWorks(
    layout.slots.length,
    s.arrangement,
    own,
    demo,
    balancedFillOrder(layout),
    slotCount(s, own.length)
  )
  return toPlacement(perSlot, own.length + demo.length)
}

export function buildExhibitionList(s: Settings, own: ArtworkData[]): ArtworkData[] {
  return buildPlacement(s, own).list
}

export function overflowCount(s: Settings, ownCount: number): number {
  const total = ownCount + (s.showDemo ? ARTWORKS.length : 0)
  // Surplus works auto-fill every slot, so anything past the slot count is hidden.
  return Math.max(0, total - slotCount(s, ownCount))
}

// useShallow compares values by reference, so returning a freshly created array each
// time would cause infinite re-renders in the store selector below.
const EMPTY_ARTWORKS: ArtworkData[] = []

/** The settings a published gallery renders under — the visitor branch of
 *  `useSettings()`, lifted out so SERVER code can derive the same result. The
 *  crawlable work list and the structured data are both built from this, and they
 *  have to land in the same slot order the 3D room uses (docs/DECISIONS 2026-07-30
 *  SEO).
 *
 *  Every value is read straight off `ex`, so `useShallow` still sees stable
 *  references and the freshly created wrapper object costs nothing. */
export function visitorSettings(ex: PublicExhibition): Settings {
  return {
    theme: ex.theme,
    layout: ex.layout,
    layoutParams: ex.layoutParams,
    frame: ex.frame,
    mat: ex.mat,
    hanging: ex.hanging,
    caption: ex.caption,
    showDemo: false,
    artworks: EMPTY_ARTWORKS,
    frameOverrides: ex.frameOverrides,
    matOverrides: ex.matOverrides,
    hangingOverrides: ex.hangingOverrides,
    captionOverrides: ex.captionOverrides,
    lightOverrides: ex.lightOverrides,
    workCap: ex.workCap,
    designOverrides: ex.designOverrides,
    arrangement: ex.arrangement,
  }
}

/** The works actually on the walls of a published room, in slot order. What both the
 *  plain-HTML list and the structured data enumerate — never `ex.artworks` directly,
 *  which is every placement including any that the room's capacity has since cut. */
export function publicExhibitionWorks(ex: PublicExhibition): ArtworkData[] {
  return buildExhibitionList(visitorSettings(ex), ex.artworks)
}
