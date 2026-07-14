// Playback management for video works and shared spatial-audio parts
// - Attach a single AudioListener to the camera (shared by all PositionalAudio)
// - Only the few nearest videos play at once (avoids load and a flood of sound + the "audible as you approach" effect)
// - Fade playback in/out for smoothness (so it doesn't cut off abruptly at the boundary)
import * as THREE from 'three'
import { LOW_POWER } from './controller'
import { galleryAudio } from './audio'

/* ---- Tune volume and fades here (see the docs/ARCHITECTURE.md appendix) ---- */
/** Maximum video audio volume (gain before distance attenuation) */
export const VIDEO_VOLUME = 0.9
/** Fade-in when playback starts (seconds) */
const FADE_IN = 0.9
/** Fade-out when stopping (seconds) — pause happens after this */
const FADE_OUT = 0.6
/** Number of videos playing at once (one on touch devices) */
const MAX_PLAYING = LOW_POWER ? 1 : 2
/** Videos farther than this don't play */
const MAX_DIST = 13

let listener: THREE.AudioListener | null = null

export function getListener(): THREE.AudioListener {
  if (!listener) listener = new THREE.AudioListener()
  return listener
}

/** Call on the first user interaction (lifts the browser's autoplay restriction) */
export function unlockVideoAudio() {
  const ctx = listener?.context
  if (ctx && ctx.state === 'suspended') void ctx.resume()
  audioUnlocked = true
}

/** Mirror of unlockVideoAudio for leaving the gallery: the shared AudioListener
 *  context is a module singleton, so suspend it (and require a fresh gesture to
 *  re-arm) rather than leaving it running after the 3D tree unmounts. */
export function suspendVideoAudio() {
  const ctx = listener?.context
  if (ctx && ctx.state === 'running') void ctx.suspend()
  audioUnlocked = false
}
let audioUnlocked = false

export interface VideoEntry {
  id: string
  position: THREE.Vector3
  video: HTMLVideoElement
  audio: THREE.PositionalAudio | null
  /** Internal state: whether this is currently a playback target (fades fire only on transitions) */
  wantPlay?: boolean
  pauseTimer?: ReturnType<typeof setTimeout>
}

const registry = new Map<string, VideoEntry>()

export function registerVideo(entry: VideoEntry) {
  registry.set(entry.id, entry)
  if (typeof window !== 'undefined') {
    // Prototype debugging (lets you inspect playback state from the console)
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

/** Called every 0.4s rather than every frame (from VideoPlaybackManager) */
export function updateVideoPlayback(cameraPos: THREE.Vector3) {
  if (registry.size === 0) return
  const entries = [...registry.values()]
    .map((e) => ({ e, d: Math.hypot(e.position.x - cameraPos.x, e.position.z - cameraPos.z) }))
    .sort((a, b) => a.d - b.d)

  // Audibility: muted before user interaction (autoplay restriction); afterward it's lifted and
  // played via PositionalAudio (distance attenuation) + fades. Turning ambient sound off also stops video audio
  const audible = audioUnlocked && galleryAudio.enabled
  const audibleChanged = audible !== lastAudible
  lastAudible = audible

  entries.forEach(({ e, d }, i) => {
    const shouldPlay = i < MAX_PLAYING && d < MAX_DIST
    e.video.muted = !audible

    if (audibleChanged && audible && e.wantPlay) {
      // Ramp up from zero so there's no pop the moment audio is unlocked / ambient sound turns on
      e.audio?.gain.gain.setValueAtTime(0.0001, e.audio.context.currentTime)
      rampGain(e, VIDEO_VOLUME, FADE_IN)
    }

    if (shouldPlay === !!e.wantPlay) return // No state change
    e.wantPlay = shouldPlay
    if (shouldPlay) startVideo(e)
    else stopVideo(e)
  })
}
