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

// Virtual joystick input (Joystick UI → WalkControls)
export const joyState = { active: false, x: 0, y: 0 }

// On touch devices, disable post-processing and lower shadow resolution to hold 30fps
export const LOW_POWER =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
