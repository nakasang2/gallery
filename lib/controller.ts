// Bridge between the 3D scene (WalkControls) and the UI.
// Values updated every frame are passed via a shared ref instead of through React re-renders
import type * as THREE from 'three'

export interface WalkAPI {
  focusExhibit(i: number): void
  /**
   * Move to and face the next (dir = +1) or previous (dir = -1) work in
   * exhibition order, in one action. When free-walking (nothing focused) the
   * first step goes to the nearest work.
   */
  focusStep(dir: number): void
  /** Glide to face the title wall (its board opens the exhibition-info panel) */
  focusWall(): void
  walkTo(point: THREE.Vector3): void
  /** Stop the in-progress movement tween */
  cancel(): void
  /** Return to the entry position on layout change */
  resetToEntry(): void
}

export const walkRef: { current: WalkAPI | null } = { current: null }

// The WebGL canvas element, published in the Canvas onCreated. Used by the
// walkthrough recorder (lib/recorder) to captureStream() the live render.
// A shared ref (not React state) since the recorder is imperative.
export const canvasRef: { current: HTMLCanvasElement | null } = { current: null }

// Camera pose for the minimap — written every frame by WalkControls, read via rAF
// (a shared ref keeps this off React's re-render path)
export const camPose = { x: 0, z: 0, yaw: 0 }

// Three render-quality tiers:
//   high   = fine pointer (desktop). Full pipeline: post effects, reflective floor,
//            2K shadows, high DPR (with FPS-based fallback in GalleryApp).
//   medium = touch device with decent hardware. Real shadows at reduced resolution,
//            clearcoat floor instead of planar reflection, no post effects.
//   low    = weak touch device (little memory / few cores). Real-time shadows and
//            reflections fully off; depth is carried by the baked/fake shadow planes.
// deviceMemory is Chrome/Android only (undefined on iOS → tier decided by cores).
export type RenderQuality = 'high' | 'medium' | 'low'

function detectQuality(): RenderQuality {
  if (typeof window === 'undefined') return 'high'
  if (!window.matchMedia('(pointer: coarse)').matches) return 'high'
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = navigator.hardwareConcurrency ?? 4
  if ((nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || cores <= 4) return 'low'
  return 'medium'
}

export const QUALITY: RenderQuality = detectQuality()

// Back-compat flag: "not the full desktop pipeline" (post effects, ghosts,
// reflective floor are all desktop-only). Same value as the old touch check.
export const LOW_POWER = QUALITY !== 'high'
