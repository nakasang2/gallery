// ギャラリーの環境音と足音(全てWebAudioで生成 — 音源ファイル不要)
// ブラウザの自動再生制限のため、最初のユーザー操作で unlock() を呼ぶ

const STORAGE_KEY = 'hakoniwa.audio.v1'

class GalleryAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private stepBus: GainNode | null = null
  private unlocked = false
  enabled = true

  constructor() {
    if (typeof window !== 'undefined') {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== '0'
    }
  }

  /** 最初のポインタ/キー操作で呼ぶ(以後は何度呼んでも無害) */
  unlock() {
    if (this.unlocked || typeof window === 'undefined') return
    this.unlocked = true
    try {
      this.build()
    } catch {
      // WebAudio非対応環境では無音のまま
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled
    localStorage.setItem(STORAGE_KEY, this.enabled ? '1' : '0')
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setTargetAtTime(this.enabled ? 1 : 0, t, 0.25)
    }
    return this.enabled
  }

  private build() {
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? 1 : 0
    this.master.connect(ctx.destination)

    /* ---- 残響(生成したインパルス応答による静かなホールの響き) ---- */
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
    wet.gain.value = 0.45
    this.convolver.connect(wet)
    wet.connect(this.master)

    /* ---- ルームトーン(空調のような低いノイズ) ---- */
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
    // ふわっと立ち上げる
    roomGain.gain.setTargetAtTime(0.035, ctx.currentTime, 1.2)

    /* ---- 足音バス(ドライ + 残響) ---- */
    this.stepBus = ctx.createGain()
    this.stepBus.gain.value = 1
    this.stepBus.connect(this.master)
    this.stepBus.connect(this.convolver)
  }

  /** 一歩ぶんの足音(intensity: 0〜1 歩く速さ) */
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
    g.gain.value = 0.05 + 0.09 * Math.min(1, intensity) * (0.85 + Math.random() * 0.3)
    src.connect(band)
    band.connect(g)
    g.connect(this.stepBus)
    src.start()
  }
}

export const galleryAudio = new GalleryAudio()
