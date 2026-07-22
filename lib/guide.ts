// Per-work audio-guide playback (REQUIREMENTS §6-3 / STRATEGY P3-12). Two sources
// behind ONE control:
//   • an uploaded narration file  → HTMLAudioElement
//   • the work's caption          → the browser's speech synthesis (free, no file,
//                                    no recording — the artist just writes a caption)
// During the guided tour each work's guide auto-plays as it comes into focus,
// turning the tour into an audio tour. Neither source is routed through lib/audio's
// WebAudio synth graph, so cross-origin/uploaded files and TTS just play — but both
// respect the one mute control (galleryAudio.enabled) and are silenced on exit.
import { useSyncExternalStore } from 'react'
import { galleryAudio } from './audio'

/** What a work's guide plays: an uploaded file, or its caption read aloud.
 *  The 'tts' source carries the work id (server synthesizes the DB caption via
 *  OpenAI) plus the caption text (browser-speech fallback when OpenAI is off). */
export type GuideSource =
  | { key: string; kind: 'url'; url: string }
  | { key: string; kind: 'tts'; id: string; text: string }

/** Voice for OpenAI TTS — one place to swap it. */
export const TTS_VOICE = 'shimmer'

/** Can this browser synthesize speech? (false during SSR / unsupported engines) */
export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** Set false once /api/tts answers 501 (OpenAI not configured) so we stop trying
 *  and go straight to browser speech; true once a generation succeeds. */
let openaiTtsAvailable: boolean | null = null

/** The guide source for a work: uploaded audio wins; otherwise read the caption.
 *  Offered whenever there's a caption — playback resolves OpenAI first, then falls
 *  back to browser speech, so it works even where speechSynthesis is unavailable. */
export function guideSourceFor(
  art: { id: string; audioUrl?: string; desc?: string },
  allowTts = true
): GuideSource | null {
  if (art.audioUrl) return { key: art.audioUrl, kind: 'url', url: art.audioUrl }
  const text = art.desc?.trim()
  if (allowTts && text && (ttsSupported() || openaiTtsAvailable !== false)) {
    return { key: `tts:${art.id}`, kind: 'tts', id: art.id, text }
  }
  return null
}

type Listener = () => void

class AudioGuide {
  private el: HTMLAudioElement | null = null
  /** Key of the source currently playing/loaded, or null */
  current: string | null = null
  playing = false
  private listeners = new Set<Listener>()

  private ensureEl(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null
    if (!this.el) {
      this.el = new Audio()
      this.el.preload = 'none'
      // Needed so the narration can be routed through the WebAudio hall reverb
      // (createMediaElementSource taints without CORS; Supabase sends ACAO *).
      this.el.crossOrigin = 'anonymous'
      this.el.addEventListener('ended', () => this.setPlaying(false))
      this.el.addEventListener('pause', () => {
        if (this.el && !this.el.ended && this.playing && this.el.paused) this.setPlaying(false)
      })
      this.el.addEventListener('play', () => this.setPlaying(true))
    }
    return this.el
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

  /** Resolved OpenAI mp3 URLs, keyed by guide source key, so re-playing a work
   *  within a session skips the /api/tts round trip. */
  private ttsUrlCache = new Map<string, string>()

  /** Play a guide source. No-op when muted. Requires a prior user gesture
   *  (the tour/panel is opened by a tap, which satisfies autoplay). */
  play(src: GuideSource) {
    if (!galleryAudio.enabled) return
    // Stop whatever else was going first (audio element AND any speech)
    this.stopMedia()
    this.current = src.key
    if (src.kind === 'url') {
      this.playUrl(src.url)
    } else {
      // Reflect playing immediately; resolution (network) happens in the background.
      this.setPlaying(true)
      void this.resolveTts(src)
    }
  }

  private playUrl(url: string) {
    const el = this.ensureEl()
    if (!el) return
    // Route through the hall reverb when the audio graph is up (subtle "in the room"
    // ambience); if not (no gesture yet), it just plays dry.
    galleryAudio.connectGuide(el)
    if (el.src !== url) el.src = url
    el.currentTime = 0
    void el.play().catch(() => this.setPlaying(false))
  }

  /** Prefer OpenAI (a cached mp3 the server returns); fall back to browser speech. */
  private async resolveTts(src: { key: string; kind: 'tts'; id: string; text: string }) {
    const cached = this.ttsUrlCache.get(src.key)
    if (cached) {
      if (this.current === src.key) this.playUrl(cached)
      return
    }
    if (openaiTtsAvailable !== false && src.id) {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workId: src.id, voice: TTS_VOICE }),
        })
        if (res.ok) {
          const { url } = (await res.json()) as { url?: string }
          openaiTtsAvailable = true
          if (url) {
            this.ttsUrlCache.set(src.key, url)
            if (this.current === src.key) this.playUrl(url)
            return
          }
        } else if (res.status === 501) {
          openaiTtsAvailable = false // not configured — stop trying this session
        }
        // Other errors (404 no caption, 502 generation) fall through to browser speech.
      } catch {
        // Network error — fall through to browser speech.
      }
    }
    if (this.current === src.key) this.speakBrowser(src)
  }

  private speakBrowser(src: { key: string; text: string }) {
    if (!ttsSupported()) {
      this.setPlaying(false)
      return
    }
    const u = new SpeechSynthesisUtterance(src.text)
    u.rate = 0.98
    u.onend = () => {
      if (this.current === src.key) this.setPlaying(false)
    }
    u.onerror = () => {
      if (this.current === src.key) this.setPlaying(false)
    }
    // cancel() then speak() — some engines queue instead of replacing
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    this.setPlaying(true) // reflect immediately; onend/onerror will clear it
  }

  /** Toggle a source: stop if it's the one playing, else play it. */
  toggle(src: GuideSource) {
    if (this.playing && this.current === src.key) this.stop()
    else this.play(src)
  }

  private stopMedia() {
    if (this.el) {
      this.el.pause()
      this.el.currentTime = 0
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  /** Stop playback (keeps nothing queued). */
  stop() {
    this.stopMedia()
    this.setPlaying(false)
  }

  /** Leaving the gallery: silence like the ambient singleton (module-scoped, outlives React). */
  suspend() {
    this.stop()
    this.current = null
  }
}

export const audioGuide = new AudioGuide()

/** Reactive view: is the guide with THIS key currently playing? */
export function useGuidePlaying(key: string | undefined): boolean {
  return useSyncExternalStore(
    (cb) => audioGuide.subscribe(cb),
    () => !!key && audioGuide.playing && audioGuide.current === key,
    () => false
  )
}
