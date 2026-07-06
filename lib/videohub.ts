// 動画作品の再生管理と空間オーディオの共有部品
// - AudioListener はカメラに1つだけ付ける(全 PositionalAudio が共有)
// - 同時再生はカメラに近い数点だけ(負荷と音の洪水を防ぐ + 「近づくと聞こえる」演出)
// - 再生開始/停止はフェードで滑らかにする(境界でブツッと切れないように)
import * as THREE from 'three'
import { LOW_POWER } from './controller'
import { galleryAudio } from './audio'

/* ---- 音量・フェードの調整はここ(docs/ARCHITECTURE.md 補足参照) ---- */
/** 動画音声の最大音量(距離減衰前のゲイン) */
export const VIDEO_VOLUME = 0.9
/** 再生開始時のフェードイン(秒) */
const FADE_IN = 0.9
/** 停止時のフェードアウト(秒)— この後に pause する */
const FADE_OUT = 0.6
/** 同時に再生する本数(タッチ端末は1本) */
const MAX_PLAYING = LOW_POWER ? 1 : 2
/** これより遠い動画は再生しない */
const MAX_DIST = 13

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
  audio: THREE.PositionalAudio | null
  /** 内部状態: いま再生対象か(遷移時だけフェードを発火させる) */
  wantPlay?: boolean
  pauseTimer?: ReturnType<typeof setTimeout>
}

const registry = new Map<string, VideoEntry>()

export function registerVideo(entry: VideoEntry) {
  registry.set(entry.id, entry)
  if (typeof window !== 'undefined') {
    // プロトタイプ用デバッグ(コンソールから再生状態を確認できる)
    ;(window as unknown as Record<string, unknown>).__videoRegistry = registry
  }
  return () => {
    clearTimeout(entry.pauseTimer)
    registry.delete(entry.id)
  }
}

function rampGain(e: VideoEntry, to: number, dur: number) {
  const audio = e.audio
  if (!audio) return
  const g = audio.gain.gain
  const t = audio.context.currentTime
  g.cancelScheduledValues(t)
  g.setValueAtTime(Math.max(g.value, 0.0001), t)
  g.linearRampToValueAtTime(Math.max(to, 0.0001), t + dur)
}

function startVideo(e: VideoEntry) {
  clearTimeout(e.pauseTimer)
  rampGain(e, VIDEO_VOLUME, FADE_IN)
  if (e.video.paused) void e.video.play().catch(() => {})
}

function stopVideo(e: VideoEntry) {
  rampGain(e, 0, FADE_OUT)
  clearTimeout(e.pauseTimer)
  e.pauseTimer = setTimeout(() => {
    if (!e.wantPlay) e.video.pause()
  }, FADE_OUT * 1000 + 100)
}

let lastAudible = false

/** 毎フレームではなく0.4秒おきに呼ばれる(VideoPlaybackManager から) */
export function updateVideoPlayback(cameraPos: THREE.Vector3) {
  if (registry.size === 0) return
  const entries = [...registry.values()]
    .map((e) => ({ e, d: Math.hypot(e.position.x - cameraPos.x, e.position.z - cameraPos.z) }))
    .sort((a, b) => a.d - b.d)

  // 音声可否: ユーザー操作前は muted(自動再生制限)、操作後は解除して
  // PositionalAudio(距離減衰)+ フェードで聞かせる。環境音OFFで動画音声も止まる
  const audible = audioUnlocked && galleryAudio.enabled
  const audibleChanged = audible !== lastAudible
  lastAudible = audible

  entries.forEach(({ e, d }, i) => {
    const shouldPlay = i < MAX_PLAYING && d < MAX_DIST
    e.video.muted = !audible

    if (audibleChanged && audible && e.wantPlay) {
      // 音声解禁/環境音ONの瞬間もポップしないよう0から立ち上げる
      e.audio?.gain.gain.setValueAtTime(0.0001, e.audio.context.currentTime)
      rampGain(e, VIDEO_VOLUME, FADE_IN)
    }

    if (shouldPlay === !!e.wantPlay) return // 状態変化なし
    e.wantPlay = shouldPlay
    if (shouldPlay) startVideo(e)
    else stopVideo(e)
  })
}
