// Gallery ambient sound and footsteps (all generated with WebAudio — no audio files needed)
// Because of the browser's autoplay restriction, call unlock() on the first user interaction

const STORAGE_KEY = 'hakoniwa.audio.v1'

/* ---- Tune volume and fades here ---- */
/** Room-tone (HVAC) volume. Kept low so it doesn't interfere with the works' audio */
const ROOM_TONE_LEVEL = 0.028
/** Room-tone ramp-up (seconds) */
const ROOM_TONE_FADE_IN = 1.6
/** Base footstep volume and the extra added by walking speed */
const STEP_BASE = 0.04
const STEP_SPEED_GAIN = 0.08
/** Footstep reverb (wet) amount */
const STEP_REVERB_WET = 0.4
/** Fade for toggling ambient sound on/off (seconds) */
const TOGGLE_FADE = 0.35
/** Distant-crowd murmur: peak volume (at a full room) and how fast it eases in/out */
const CROWD_LEVEL = 0.05
const CROWD_FADE = 2.2
/** Ambient BGM pad: peak volume and how slowly it swells in on unlock */
const BGM_LEVEL = 0.055
const BGM_FADE_IN = 4

class GalleryAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private stepBus: GainNode | null = null
  private crowdGain: GainNode | null = null
  /** Desired crowd murmur (0–1 of CROWD_LEVEL); remembered so it survives (re)build */
  private crowdTarget = 0
  private unlocked = false
  enabled = true

  constructor() {
    if (typeof window !== 'undefined') {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== '0'
    }
  }

  /** Call on the first pointer/key interaction (harmless to call repeatedly afterward) */
  unlock() {
    if (typeof window === 'undefined') return
    if (this.unlocked) {
      // Re-entering the gallery after suspend() on the way out — wake the context
      // back up and fade the volume back to the user's on/off preference (the
      // instance is a singleton that persists across client-side navigation).
      if (this.ctx) {
        if (this.ctx.state === 'suspended') void this.ctx.resume()
        if (this.master) {
          const t = this.ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setTargetAtTime(this.enabled ? 1 : 0, t, TOGGLE_FADE)
        }
      }
      return
    }
    this.unlocked = true
    try {
      this.build()
    } catch {
      // Stays silent in environments without WebAudio support
    }
  }

  /** Silence the ambient sound when leaving the gallery. The instance is a module
   *  singleton that outlives the React tree, so without this the looping room tone
   *  keeps playing after you navigate away from /demo or a public gallery. Mute the
   *  master gain instantly (ctx.suspend() alone can take ~1s to pause the graph),
   *  then suspend the context so it isn't burning cycles in the background. */
  suspend() {
    if (!this.ctx) return
    if (this.master) this.master.gain.setValueAtTime(0, this.ctx.currentTime)
    if (this.ctx.state === 'running') void this.ctx.suspend()
  }

  toggle(): boolean {
    this.enabled = !this.enabled
    localStorage.setItem(STORAGE_KEY, this.enabled ? '1' : '0')
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setTargetAtTime(this.enabled ? 1 : 0, t, TOGGLE_FADE)
    }
    return this.enabled
  }

  private build() {
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? 1 : 0
    this.master.connect(ctx.destination)

    /* ---- Reverb (a quiet hall resonance from a generated impulse response) ---- */
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.4, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp((-5.5 * i) / d.length)
      }
    }
    this.convolver = ctx.createConvolver()
    this.convolver.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = STEP_REVERB_WET
    this.convolver.connect(wet)
    wet.connect(this.master)

    /* ---- Room tone (a low, HVAC-like noise) ---- */
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
    const nd = noiseBuf.getChannelData(0)
    let brown = 0
    for (let i = 0; i < nd.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995
      nd[i] = brown * 3
    }
    const room = ctx.createBufferSource()
    room.buffer = noiseBuf
    room.loop = true
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 340
    const roomGain = ctx.createGain()
    roomGain.gain.value = 0
    room.connect(lowpass)
    lowpass.connect(roomGain)
    roomGain.connect(this.master)
    room.start()
    // Ease it in gently
    roomGain.gain.setTargetAtTime(ROOM_TONE_LEVEL, ctx.currentTime, ROOM_TONE_FADE_IN)

    /* ---- Ambient BGM (STRATEGY §7 P3-12): a generative pad loop — a handful of
       sparse, slow notes over a pentatonic scale, each windowed (fade in/out) so
       overlapping notes never click. Notes are kept away from the buffer's edges,
       so the buffer itself starts and ends silent and the loop point is seamless.
       Built once from raw math like the room tone above — one track, no files. */
    const bgmDur = 30
    const bgmBuf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * bgmDur), ctx.sampleRate)
    const scale = [130.81, 146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 329.63] // two octaves, C major pentatonic-ish
    const bgmNotes: { start: number; dur: number; freq: number; pan: number }[] = []
    for (let t = 2; t < bgmDur - 4; ) {
      const dur = 8 + Math.random() * 8
      if (t + dur > bgmDur - 1) break
      bgmNotes.push({ start: t, dur, freq: scale[Math.floor(Math.random() * scale.length)], pan: Math.random() * 2 - 1 })
      t += dur * (0.4 + Math.random() * 0.4) // let the next note's swell-in overlap this one's tail
    }
    for (let ch = 0; ch < 2; ch++) {
      const d = bgmBuf.getChannelData(ch)
      for (const n of bgmNotes) {
        const g = 0.4 * (ch === 0 ? 1 - Math.max(0, n.pan) : 1 + Math.min(0, n.pan))
        const i0 = Math.floor(n.start * ctx.sampleRate)
        const i1 = Math.min(d.length, Math.floor((n.start + n.dur) * ctx.sampleRate))
        for (let i = i0; i < i1; i++) {
          const localT = (i - i0) / ctx.sampleRate
          const time = i / ctx.sampleRate
          const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * localT) / n.dur) // Hann: zero at both ends
          d[i] += g * win * (Math.sin(2 * Math.PI * n.freq * time) + 0.15 * Math.sin(4 * Math.PI * n.freq * time))
        }
      }
    }
    const bgm = ctx.createBufferSource()
    bgm.buffer = bgmBuf
    bgm.loop = true
    const bgmFilter = ctx.createBiquadFilter()
    bgmFilter.type = 'lowpass'
    bgmFilter.frequency.value = 1400
    const bgmGain = ctx.createGain()
    bgmGain.gain.value = 0
    bgm.connect(bgmFilter)
    bgmFilter.connect(bgmGain)
    bgmGain.connect(this.master)
    bgmGain.connect(this.convolver)
    bgm.start()
    bgmGain.gain.setTargetAtTime(BGM_LEVEL, ctx.currentTime, BGM_FADE_IN)

    /* ---- Footstep bus (dry + reverb) ---- */
    this.stepBus = ctx.createGain()
    this.stepBus.gain.value = 1
    this.stepBus.connect(this.master)
    this.stepBus.connect(this.convolver)

    /* ---- Distant-crowd murmur (§11.19): bandpassed noise in the vocal range with a
       slow LFO so it ebbs like real chatter. Fed through the reverb for room depth.
       Silent until setCrowdLevel() raises it (i.e. only where past visitors are shown). */
    const crowdBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
    const cd = crowdBuf.getChannelData(0)
    let pink = 0
    for (let i = 0; i < cd.length; i++) {
      pink = (pink + (Math.random() * 2 - 1) * 0.05) * 0.98
      cd[i] = pink * 2
    }
    const crowd = ctx.createBufferSource()
    crowd.buffer = crowdBuf
    crowd.loop = true
    const voiceBand = ctx.createBiquadFilter()
    voiceBand.type = 'bandpass'
    voiceBand.frequency.value = 520
    voiceBand.Q.value = 0.7
    this.crowdGain = ctx.createGain()
    this.crowdGain.gain.value = 0
    crowd.connect(voiceBand)
    voiceBand.connect(this.crowdGain)
    this.crowdGain.connect(this.master)
    this.crowdGain.connect(this.convolver)
    crowd.start()
    // Restore any level requested before the graph existed
    this.crowdGain.gain.setTargetAtTime(this.crowdTarget * CROWD_LEVEL, ctx.currentTime, CROWD_FADE)
  }

  /** Set the distant-crowd murmur from the number of ambient visitors present (0 = silence).
   *  Scaled by MAX so a busy room is fuller but never loud; mute/leave still gate it via master. */
  setCrowdLevel(count: number, max = 4) {
    this.crowdTarget = Math.max(0, Math.min(1, count / max))
    if (this.ctx && this.crowdGain) {
      this.crowdGain.gain.setTargetAtTime(this.crowdTarget * CROWD_LEVEL, this.ctx.currentTime, CROWD_FADE)
    }
  }

  /** A single footstep (intensity: 0–1 walking speed) */
  step(intensity = 1) {
    const ctx = this.ctx
    if (!ctx || !this.stepBus || !this.enabled) return
    const dur = 0.09
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp((-9 * i) / d.length)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = 0.85 + Math.random() * 0.3
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 170 + Math.random() * 60
    band.Q.value = 0.9
    const g = ctx.createGain()
    g.gain.value = STEP_BASE + STEP_SPEED_GAIN * Math.min(1, intensity) * (0.85 + Math.random() * 0.3)
    src.connect(band)
    band.connect(g)
    g.connect(this.stepBus)
    src.start()
  }
}

export const galleryAudio = new GalleryAudio()
