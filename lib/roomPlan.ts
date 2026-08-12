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
import { resolveLayout, type LayoutDef } from './presets'
import { effectiveSlotCount } from './limits'
import { placeWorks, toPlacement, balancedFillOrder, usableSlots, type Placement } from './arrangement'
import type { PublicArtist, PublicExhibition } from './publish'
import type { Settings } from './store'

/** Width of the title board mounted on the room's west wall (TitleWall.tsx). Shared
 *  with RoomPortals.tsx, which stands the connecting doorway clear of it on the same
 *  wall — duplicating this formula in both places would let them drift out of sync. */
export function titleWallWidth(layout: LayoutDef): number {
  return Math.min(9.6, layout.hd * 2 - 1.4)
}

/** True when this scene is the guest sample show (no own works, demo collection on):
 *  a marketing showcase, so the plan's works-per-gallery cap doesn't apply — the
 *  full demo collection fills the whole room. */
function isDemoShowcase(s: Settings, ownCount: number): boolean {
  return s.showDemo && ownCount === 0
}

/** Usable slots for the current layout. The room's capacity caps the AUTO-FILL only;
 *  a room the owner arranged by hand shows what they hung (`usableSlots` — this used to
 *  be a second, drifting copy of that rule, which is why 15 arranged works appeared as
 *  5 in the 3D room). */
export function slotCount(s: Settings, ownCount = 1): number {
  const layoutSlots = resolveLayout(s.layout, s.layoutParams).slots.length
  const cap = isDemoShowcase(s, ownCount) ? layoutSlots : effectiveSlotCount(layoutSlots, s.workCap)
  return usableSlots(layoutSlots, s.arrangement, cap)
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
  // Works past the usable slots can't be seen. For an arranged room that ceiling is the
  // layout's physical slot count, so this no longer claims "10 works are hidden" about a
  // room that is in fact showing all fifteen the owner hung.
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

/**
 * Whose name the room's title wall carries.
 *
 * Derived from the works actually hanging rather than configured, so it is right for
 * every shape a show can take without the owner declaring which shape it is
 * (ユーザー決定 2026-08-09):
 *   - one room per artist  → that artist (walk through a door, see whose room it is)
 *   - mixed hanging        → the account (the collective), with each plate crediting its own artist
 *   - themed rooms, mixed  → the account
 *   - an artist's own show  → themselves, exactly as before
 *   - an empty room        → the account
 *
 * "One artist" means one DISTINCT owner among the hanging works. A room with a single
 * guest work in it is mixed, which is the honest reading.
 */
export function roomExhibitor(ex: PublicExhibition): PublicArtist {
  const account: PublicArtist = {
    username: ex.username,
    name: ex.ownerName,
    bio: ex.ownerBio,
    avatarUrl: ex.ownerAvatar,
    sns: ex.ownerSns,
  }
  const owners = new Set<string>()
  for (const w of publicExhibitionWorks(ex)) if (w.ownerId) owners.add(w.ownerId)
  if (owners.size !== 1) return account
  // The map is empty when the profile embed could not be resolved; the account is then
  // the only name we have, and it is also the correct one for a solo room.
  return ex.artists[[...owners][0]] ?? account
}

/** The works actually on the walls of a published room, in slot order. What both the
 *  plain-HTML list and the structured data enumerate — never `ex.artworks` directly,
 *  which is every placement including any that the room's capacity has since cut. */
export function publicExhibitionWorks(ex: PublicExhibition): ArtworkData[] {
  return buildExhibitionList(visitorSettings(ex), ex.artworks)
}
