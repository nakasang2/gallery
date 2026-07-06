// 3Dシーン(WalkControls)と UI の橋渡し。
// 毎フレーム更新される値は React の再レンダリングに載せず、共有 ref で受け渡す
import type * as THREE from 'three'

export interface WalkAPI {
  focusExhibit(i: number): void
  walkTo(point: THREE.Vector3): void
  /** 進行中の移動トゥイーンを止める */
  cancel(): void
  /** レイアウト変更時に入場位置へ戻す */
  resetToEntry(): void
}

export const walkRef: { current: WalkAPI | null } = { current: null }

// バーチャルジョイスティックの入力(Joystick UI → WalkControls)
export const joyState = { active: false, x: 0, y: 0 }

// タッチ端末はポストプロセスを切り、影の解像度を落として30fpsを守る
export const LOW_POWER =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
