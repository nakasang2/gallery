// Walkthrough recorder: capture the live WebGL canvas to a WebM clip the artist
// can share on X/Instagram (REQUIREMENTS growth loop / STRATEGY §4.1-1). No
// encoding library — the browser's MediaRecorder does it from canvas.captureStream.
// Everything here is guarded so an unsupported browser degrades to "not available"
// rather than throwing.

/** Best WebM mime this browser can record, or null if none / MediaRecorder absent. */
export function pickWebmMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* isTypeSupported can throw on some engines — treat as unsupported */
    }
  }
  return null
}

/** Can this browser record the canvas at all? */
export function canRecord(canvas: HTMLCanvasElement | null): boolean {
  return !!canvas && typeof canvas.captureStream === 'function' && pickWebmMime() !== null
}

export interface WalkRecorder {
  /** Stop early; the onComplete passed to start() still fires with the clip. */
  stop(): void
}

/**
 * Start recording `canvas`. Returns a handle whose stop() ends it, or null if
 * recording isn't supported. `onComplete` receives the finished WebM blob
 * (empty-guarded by the caller). `fps` defaults to 30.
 */
export function startRecording(
  canvas: HTMLCanvasElement,
  onComplete: (blob: Blob) => void,
  fps = 30
): WalkRecorder | null {
  const mime = pickWebmMime()
  if (!mime || typeof canvas.captureStream !== 'function') return null

  let stream: MediaStream
  try {
    stream = canvas.captureStream(fps)
  } catch {
    return null
  }

  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
  } catch {
    return null
  }

  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  rec.onstop = () => {
    onComplete(new Blob(chunks, { type: mime }))
  }

  try {
    rec.start(250) // small timeslice so chunks flush periodically, not all at the end
  } catch {
    return null
  }

  return {
    stop() {
      if (rec.state !== 'inactive') rec.stop()
    },
  }
}

/** Save a recorded blob as a .webm download. */
export function downloadClip(blob: Blob, filename = 'xibit360-walkthrough.webm'): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click's navigation has grabbed the URL first
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
