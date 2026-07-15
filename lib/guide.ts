// Per-work audio-guide playback (REQUIREMENTS §6-3 / STRATEGY P3-12). A single
// HTMLAudioElement plays the focused work's narration; during the guided tour
// each work's guide auto-plays as it comes into focus, turning the tour into an
// audio tour. Deliberately NOT routed through WebAudio (lib/audio's synth graph)
// so cross-origin / uploaded files just play — and so this stays independent of
// the ambient sound. It still respects the one mute control (galleryAudio.enabled)
// and, like the ambient singleton, is silenced when leaving the gallery.
import { useSyncExternalStore } from 'react'
import { galleryAudio } from './audio'

type Listener = () => void

class AudioGuide {
  private el: HTMLAudioElement | null = null
  /** URL currently loaded (playing or paused), or null */
  current: string | null = null
  playing = false
  private listeners = new Set<Listener>()

  private ensure(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null
    if (!this.el) {
      this.el = new Audio()
      this.el.preload = 'none'
      this.el.addEventListener('ended', () => this.onStop())
      this.el.addEventListener('pause', () => {
        // Only reflect a real pause (not the pause that precedes loading a new src)
        if (this.el && !this.el.ended && this.playing && this.el.paused) this.setPlaying(false)
      })
      this.el.addEventListener('play', () => this.setPlaying(true))
    }
    return this.el
  }

  private onStop() {
    this.setPlaying(false)
  }
  private setPlaying(v: boolean) {
    if (this.playing === v) return
    this.playing = v
    this.emit()
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /** Play (or restart) the given guide. No-op when muted. Requires a prior user
   *  gesture (the tour/panel is opened by a tap, which satisfies autoplay). */
  play(url: string) {
    if (!galleryAudio.enabled) return
    const el = this.ensure()
    if (!el) return
    if (this.current !== url) {
      el.src = url
      this.current = url
    }
    el.currentTime = 0
    void el.play().catch(() => {
      // Autoplay blocked or bad URL — reflect stopped, never throw into the UI
      this.setPlaying(false)
    })
  }

  /** Pause and forget the current position (the panel/tour drives what plays). */
  stop() {
    if (this.el) {
      this.el.pause()
      this.el.currentTime = 0
    }
    this.setPlaying(false)
  }

  /** Toggle the given guide: play it, or stop if it's the one already playing. */
  toggle(url: string) {
    if (this.playing && this.current === url) this.stop()
    else this.play(url)
  }

  /** Leaving the gallery: silence like the ambient singleton (module-scoped, outlives React). */
  suspend() {
    this.stop()
    this.current = null
  }
}

export const audioGuide = new AudioGuide()

/** Reactive view of the guide for a specific url: is THIS guide currently playing? */
export function useGuidePlaying(url: string | undefined): boolean {
  return useSyncExternalStore(
    (cb) => audioGuide.subscribe(cb),
    () => !!url && audioGuide.playing && audioGuide.current === url,
    () => false
  )
}
