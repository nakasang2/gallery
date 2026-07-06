// 動画作品の再生管理と空間オーディオの共有部品
// - AudioListener はカメラに1つだけ付ける(全 PositionalAudio が共有)
// - 同時再生はカメラに近い数点だけ(負荷と音の洪水を防ぐ + 「近づくと聞こえる」演出)
import * as THREE from 'three'
import { LOW_POWER } from './controller'
import { galleryAudio } from './audio'

let listener: THREE.AudioListener | null = null

export function getListener(): THREE.AudioListener {
  if (!listener) listener = new THREE.AudioListener()
  return listener
}

/** 最初のユーザー操作で呼ぶ(ブラウザの自動再生制限の解除) */
export function unlockVideoAudio() {
  const ctx = listener?.context
  if (ctx && ctx.state === 'suspended') void ctx.resume()
  audioUnlocked = true
}
let audioUnlocked = false

export interface VideoEntry {
  id: string
  position: THREE.Vector3
  video: HTMLVideoElement
}

const registry = new Map<string, VideoEntry>()

export function registerVideo(entry: VideoEntry) {
  registry.set(entry.id, entry)
  if (typeof window !== 'undefined') {
    // プロトタイプ用デバッグ(コンソールから再生状態を確認できる)
    ;(window as unknown as Record<string, unknown>).__videoRegistry = registry
  }
  return () => {
    registry.delete(entry.id)
  }
}

/** 同時に再生する本数(タッチ端末は1本) */
const MAX_PLAYING = LOW_POWER ? 1 : 2
/** これより遠い動画は再生しない */
const MAX_DIST = 13

/** 毎フレームではなく0.4秒おきに呼ばれる(VideoPlaybackManager から) */
export function updateVideoPlayback(cameraPos: THREE.Vector3) {
  if (registry.size === 0) return
  const entries = [...registry.values()]
    .map((e) => ({ e, d: Math.hypot(e.position.x - cameraPos.x, e.position.z - cameraPos.z) }))
    .sort((a, b) => a.d - b.d)

  // 音声はミュート属性で制御する: ユーザー操作前は muted(自動再生制限を満たす)、
  // 操作後は解除して PositionalAudio(距離減衰)経由で聞こえるようにする
  const audible = audioUnlocked && galleryAudio.enabled
  entries.forEach(({ e, d }, i) => {
    const shouldPlay = i < MAX_PLAYING && d < MAX_DIST
    e.video.muted = !audible
    if (shouldPlay && e.video.paused) {
      void e.video.play().catch(() => {})
    } else if (!shouldPlay && !e.video.paused) {
      e.video.pause()
    }
  })
}
