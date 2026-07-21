'use client'
// Admin dials for how fast the ambient ghost visitors walk (§11.19), per model.
// Stored in site_config (admin-writable, world-readable); the 3D scene reads it and each
// figure's stride locks to its model's speed, so changing it never causes foot-slide.
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
  const [male, setMale] = useState(GHOST_WALK_DEFAULT)
  const [female, setFemale] = useState(GHOST_WALK_DEFAULT)
  const [savedMale, setSavedMale] = useState(GHOST_WALK_DEFAULT)
  const [savedFemale, setSavedFemale] = useState(GHOST_WALK_DEFAULT)
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
        setMale(c.walkSpeedMale)
        setFemale(c.walkSpeedFemale)
        setSavedMale(c.walkSpeedMale)
        setSavedFemale(c.walkSpeedFemale)
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
      await saveGhostConfig({ walkSpeedMale: male, walkSpeedFemale: female })
      if (!alive.current) return
      setSavedMale(male)
      setSavedFemale(female)
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

  const dirty = Math.abs(male - savedMale) > 0.001 || Math.abs(female - savedFemale) > 0.001

  const row = (name: string, v: number, set: (n: number) => void) => (
    <div className="wd-row">
      <span className="wd-label">{name}</span>
      <div className="design-controls" style={{ gap: '0.9rem' }}>
        <input
          type="range"
          min={GHOST_WALK_MIN}
          max={GHOST_WALK_MAX}
          step={0.05}
          value={v}
          disabled={busy}
          onChange={(e) => set(Number(e.target.value))}
        />
        <span className="design-value" style={{ minWidth: '11.5em' }}>
          {v.toFixed(2)} m/s · {label(v)}
          {Math.abs(v - GHOST_WALK_DEFAULT) < 0.03 && ' (default)'}
        </span>
      </div>
    </div>
  )

  return (
    <section className="me-section">
      <h2>Ghost walk speed</h2>
      <p className="me-note" style={{ marginTop: 0 }}>
        How fast the ambient past-visitor figures walk (m/s), per model. Their step animation
        locks to this, so any speed still looks natural. {saved && <b style={{ color: 'var(--gold)' }}>Saved</b>}
      </p>
      {row('Male', male, setMale)}
      {row('Female', female, setFemale)}
      <div className="design-controls" style={{ gap: '0.9rem', marginTop: '0.6rem' }}>
        <button className="btn-line" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {(Math.abs(male - GHOST_WALK_DEFAULT) > 0.001 || Math.abs(female - GHOST_WALK_DEFAULT) > 0.001) && (
          <button
            className="btn-line"
            disabled={busy}
            onClick={() => {
              setMale(GHOST_WALK_DEFAULT)
              setFemale(GHOST_WALK_DEFAULT)
            }}
          >
            Reset to default
          </button>
        )}
      </div>
      {err && <p className="me-error">{err}</p>}
    </section>
  )
}
