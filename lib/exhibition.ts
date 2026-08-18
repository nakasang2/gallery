// Logic for deriving the exhibition list (both the 3D scene and the UI panel read the same result)
//
// The pure placement functions moved to lib/roomPlan.ts so server code can call them
// (this file's hooks make it a client-only module) and are re-exported below, so the
// client's import site is unchanged.
import { useMemo } from 'react'
import type { ArtworkData } from './artworks'
import { isFrameKey, MATS, HANGINGS, CAPTIONS, type LayoutDef } from './presets'
import type { Placement } from './arrangement'
import { buildPlacement } from './roomPlan'
import { useGallery, useSettings, type Settings } from './store'

export {
  slotCount,
  buildPlacement,
  buildExhibitionList,
  overflowCount,
  visitorSettings,
  publicExhibitionWorks,
} from './roomPlan'

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
  return ownerEditingOf({ user, myGallery, visitor })
}

/** The same test over a plain store snapshot, so the hook and the imperative
 *  (`useGallery.getState()`) call sites can never disagree. */
function ownerEditingOf(st: { user: unknown; myGallery: unknown; visitor: unknown }): boolean {
  return !!st.user && !!st.myGallery && !st.visitor
}

/**
 * Effective settings for display: an owner's room drops the demo collection.
 *
 * **A room the visitor is walking is never allowed to come out EMPTY.** The sample
 * show has two ways to end up with nothing on the walls, and both of them lock the
 * visitor out rather than just looking wrong (ユーザー報告 2026-08-18・iPhone
 * 「照明、額、アート、キャプション全てない。2DUIもBGMしかボタン表示されない」):
 *
 *   1. a guest whose stored settings say `showDemo: false` — the checkbox in the
 *      settings panel writes that, and it persists per device. `/demo` then has no
 *      works forever, and because the works are gone so are the per-work lights, the
 *      plaques, the tour button and the stepper. **A signed-out guest has no settings
 *      button at all** (that one needs `user`), so there is no way back.
 *   2. a signed-in owner who HAS a room but has not uploaded anything yet — this
 *      function used to drop the demo for them unconditionally. The comment on
 *      `useIsOwnerEditing` already argued this case ("otherwise they'd get an empty
 *      room under a 'ten works' HUD") but only guarded the no-room-row half of it.
 *
 * So when nothing of the viewer's own would hang, the demo collection stays — whatever
 * the stored flag says. That also HEALS a device already stuck in state 1.
 *
 * **Visitor mode is left strictly alone.** A published room with no works must render
 * empty; forcing the demo there would hang ten fictional works in a real artist's
 * gallery.
 */
function effectiveDemo(
  s: Settings,
  ownerEditing: boolean,
  isVisitor: boolean,
  ownCount: number
): Settings {
  if (isVisitor) return s
  if (ownCount === 0) return s.showDemo ? s : { ...s, showDemo: true }
  return ownerEditing && s.showDemo ? { ...s, showDemo: false } : s
}

/**
 * The settings the room is actually drawn under (`effectiveDemo` applied).
 *
 * **Everything that asks "which works hang here" has to read THIS**, not
 * `useSettings()`. The rule above used to be copied inline in `SettingsPanel` twice,
 * and a copy that drifts makes the panel count works the 3D room does not show
 * (LESSONS「同じ判断を2か所以上に写して書く」×3).
 */
export function useEffectiveSettings(): Settings {
  const settings = useSettings()
  const own = useOwnArtworks()
  const ownerEditing = useIsOwnerEditing()
  const isVisitor = useGallery((s) => !!s.visitor)
  return useMemo(
    () => effectiveDemo(settings, ownerEditing, isVisitor, own.length),
    [settings, ownerEditing, isVisitor, own.length]
  )
}

/** Non-hook form for imperative call sites (`useGallery.getState()` paths). */
export function effectiveSettingsOf(
  st: { visitor: unknown; user: unknown; myGallery: unknown },
  settings: Settings,
  own: ArtworkData[]
): Settings {
  return effectiveDemo(settings, ownerEditingOf(st), !!st.visitor, own.length)
}

/** Full placement: works in slot order + the physical slot each one hangs on (§11.13).
 *  The scene, minimap and walk controls read `slots` so a work lands on its chosen
 *  wall (and empty slots stay empty); everything else just needs `list`. */
export function usePlacement(): Placement {
  const eff = useEffectiveSettings()
  const own = useOwnArtworks()
  return useMemo(() => buildPlacement(eff, own), [eff, own])
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

/** Effective lighting per work: the override when set, else the room's default.
 *  Unlike the other four axes this one is picked with an explicit "follow the
 *  room" chip, so an override never collapses into the default (DECISIONS
 *  2026-07-30 — a work set to 'ceiling' stays 'ceiling' when the room changes). */
export function lightModeFor(s: Settings, art: ArtworkData): 'ceiling' | 'overhead' {
  const key = s.lightOverrides[art.id]
  return key === 'ceiling' || key === 'overhead' ? key : (s.designOverrides.lightMode ?? 'ceiling')
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

// Display size (metres) for a work. When the artist gave real cm dimensions, honour them
// so the piece hangs at its true proportions AND relative scale — a big canvas reads big,
// a small one small — clamped to [0.4, 2.4] m tall (and ≤ 2.6 m wide) so a postage stamp or
// a mural still hangs cleanly on the wall grid. Otherwise fall back to the image's pixel
// ratio, normalised to a common height (landscape keys off width, portrait off height).
export function artSize(
  ratio: [number, number],
  dims?: { widthCm?: number; heightCm?: number }
): { width: number; height: number } {
  const wCm = dims?.widthCm
  const hCm = dims?.heightCm
  if (wCm && hCm && wCm > 0 && hCm > 0) {
    const aspect = wCm / hCm
    let height = Math.min(2.4, Math.max(0.4, hCm / 100))
    let width = height * aspect
    if (width > 2.6) {
      width = 2.6
      height = width / aspect
    }
    return { width, height }
  }
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
