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

// On touch devices, disable post-processing and lower shadow resolution to hold 30fps
export const LOW_POWER =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
