'use client'
// What to bake for a room, and the fingerprint that says whether a saved bake still
// describes it.
//
// **This is the one place that decides it.** Two very different callers need the same
// answer: the visitor's scene (to compare against the saved manifest) and the artist's
// bake runner (to produce it). If they derived the specs or the key separately, the
// artist would save a bake that every visitor immediately throws away as stale — and
// nothing would look broken, it would just silently never help anyone
// (LESSONS「同じ判断を2か所以上に写して書く」×3).
import { frameDefFor, applyMat, type LayoutDef } from '@/lib/presets'
import { frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor, lightModeFor } from '@/lib/exhibition'
import type { Settings } from '@/lib/store'
import type { ArtworkData } from '@/lib/artworks'
import { exhibitExtents, exhibitLightRig, shadowPatch } from './Exhibit'
import type { BakeSpec } from './WallShadowBaker'

export interface BakePlan {
  specs: BakeSpec[]
  /** Fingerprint of everything that changes a baked silhouette. */
  key: string
  /** Artwork ids in bake order — the order tiles are written in. */
  ids: string[]
}

export function buildBakePlan(
  settings: Settings,
  list: ArtworkData[],
  slots: number[],
  layout: LayoutDef
): BakePlan {
  const specs = list.map((art, i) => {
    const slot = layout.slots[slots[i]]
    const lightMode = lightModeFor(settings, art)
    const frameDef = applyMat(frameDefFor(frameKeyFor(settings, art)), matKeyFor(settings, art))
    const { halfW, halfH } = exhibitExtents(art, frameDef)
    const rig = exhibitLightRig(slot, lightMode, halfH, halfW)
    const patch = shadowPatch(halfW, halfH)
    return {
      id: art.id,
      slotX: slot.x,
      slotZ: slot.z,
      rotY: slot.rotY,
      patchW: patch.w,
      patchH: patch.h,
      patchOffsetY: patch.offsetY,
      lightPos: rig.position,
      target: rig.target,
      angle: rig.angle,
      penumbra: rig.penumbra,
      // The picture light's virtual emitter sits ~1.2m from its casters
      // (rig pulls it back off the lamp head) — still closer than the track
      near: lightMode === 'overhead' ? 0.1 : 0.5,
      // A close light throws a broader penumbra than a distant track
      softPx: lightMode === 'overhead' ? 12 : 9,
      // …and its pool still falls off faster, so the ambient floor sits a
      // bit lower or the shadow below the frame washes out
      ambient: lightMode === 'overhead' ? 0.22 : 0.35,
    }
  })

  // Fingerprint of everything that changes a baked silhouette: geometry/slot via
  // the spec numbers, PLUS hanging (ledge shelf casts) and caption (plaque casts).
  const key = specs
    .map((s, i) => {
      const art = list[i]
      return `${s.id}:${s.slotX.toFixed(2)},${s.slotZ.toFixed(2)},${s.rotY.toFixed(3)},${s.patchW.toFixed(2)},${s.patchH.toFixed(2)},${s.angle},${hangingKeyFor(settings, art)},${captionKeyFor(settings, art)},${lightModeFor(settings, art)}`
    })
    .join('|')

  return { specs, key, ids: specs.map((s) => s.id) }
}
