'use client'
// Admin dial for how fast the ambient ghost visitors walk (§11.19). Stored in
// site_config (admin-writable, world-readable); the 3D scene reads it and every
// figure's stride locks to this speed, so raising/lowering it never causes foot-slide.
import { useEffect, useRef, useState } from 'react'
import {
  fetchGhostConfig,
  saveGhostConfig,
  GHOST_WALK_DEFAULT,
  GHOST_WALK_MIN,
  GHOST_WALK_MAX,
} from '@/lib/siteConfig'

function label(v: number): string {
  if (v < 1.0) return 'a gentle drift'
  if (v < 1.5) return 'stroll'
  if (v < 2.1) return 'brisk'
  return 'hurried'
}

export default function GhostSpeedEditor() {
  const [speed, setSpeed] = useState(GHOST_WALK_DEFAULT)
  const [savedSpeed, setSavedSpeed] = useState(GHOST_WALK_DEFAULT)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    fetchGhostConfig()
      .then((c) => {
        if (!alive.current) return
        setSpeed(c.walkSpeed)
        setSavedSpeed(c.walkSpeed)
        setLoaded(true)
      })
      .catch(() => alive.current && setLoaded(true))
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  async function save() {
    setBusy(true)
    setErr('')
    try {
      await saveGhostConfig({ walkSpeed: speed })
      if (!alive.current) return
      setSavedSpeed(speed)
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => alive.current && setSaved(false), 1800)
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (!loaded) return null

  const dirty = Math.abs(speed - savedSpeed) > 0.001

  return (
    <section className="me-section">
      <h2>Ghost walk speed</h2>
      <p className="me-note" style={{ marginTop: 0 }}>
        How fast the ambient past-visitor figures walk, in m/s. Their step animation locks to
        this, so any speed still looks natural. {saved && <b style={{ color: 'var(--gold)' }}>Saved</b>}
      </p>
      <div className="design-controls" style={{ gap: '0.9rem' }}>
        <input
          type="range"
          min={GHOST_WALK_MIN}
          max={GHOST_WALK_MAX}
          step={0.05}
          value={speed}
          disabled={busy}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
        <span className="design-value" style={{ minWidth: '11.5em' }}>
          {speed.toFixed(2)} m/s · {label(speed)}
          {Math.abs(speed - GHOST_WALK_DEFAULT) < 0.03 && ' (default)'}
        </span>
        <button className="btn-line" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {Math.abs(speed - GHOST_WALK_DEFAULT) > 0.001 && (
          <button className="btn-line" disabled={busy} onClick={() => setSpeed(GHOST_WALK_DEFAULT)}>
            Reset to default
          </button>
        )}
      </div>
      {err && <p className="me-error">{err}</p>}
    </section>
  )
}
