'use client'
// Admin editor for the Explore spotlight (企画展 / 特集). Set a heading + subtitle
// and a short, ordered list of galleries by @username / slug. Stored in
// site_config (admin-writable, world-readable); /explore renders it above the feed.
// An empty title hides the whole section; refs that aren't public just drop out.
import { useEffect, useRef, useState } from 'react'
import {
  fetchSpotlight,
  saveSpotlight,
  SPOTLIGHT_MAX,
  type SpotlightConfig,
  type SpotlightRef,
} from '@/lib/siteConfig'

export default function SpotlightEditor() {
  const [cfg, setCfg] = useState<SpotlightConfig>({ title: '', subtitle: '', items: [] })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    fetchSpotlight()
      .then((c) => {
        if (!alive.current) return
        setCfg(c)
        setLoaded(true)
      })
      .catch(() => alive.current && setLoaded(true))
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  function setItem(i: number, patch: Partial<SpotlightRef>) {
    setCfg((c) => ({ ...c, items: c.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }))
  }
  function addItem() {
    setCfg((c) => (c.items.length >= SPOTLIGHT_MAX ? c : { ...c, items: [...c.items, { username: '', slug: 'main' }] }))
  }
  function removeItem(i: number) {
    setCfg((c) => ({ ...c, items: c.items.filter((_, j) => j !== i) }))
  }
  function move(i: number, dir: -1 | 1) {
    setCfg((c) => {
      const j = i + dir
      if (j < 0 || j >= c.items.length) return c
      const items = [...c.items]
      ;[items[i], items[j]] = [items[j], items[i]]
      return { ...c, items }
    })
  }

  async function save() {
    setBusy(true)
    setErr('')
    try {
      // Drop blank rows and normalise the handle (tolerate a pasted "@name")
      const items = cfg.items
        .map((it) => ({ username: it.username.trim().replace(/^@/, ''), slug: it.slug.trim() || 'main' }))
        .filter((it) => it.username)
      await saveSpotlight({ ...cfg, title: cfg.title.trim(), subtitle: cfg.subtitle.trim(), items })
      if (!alive.current) return
      setCfg((c) => ({ ...c, items }))
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

  return (
    <section className="me-section">
      <h2>Explore spotlight</h2>
      <p className="me-note" style={{ marginTop: 0 }}>
        A curated row shown above the Explore feed. Leave the heading blank to hide it. Up to {SPOTLIGHT_MAX} galleries.
      </p>

      <label className="me-field">
        <span>Heading</span>
        <input
          value={cfg.title}
          placeholder="e.g. Summer Show / #夏の箱庭展"
          onChange={(e) => setCfg((c) => ({ ...c, title: e.target.value }))}
        />
      </label>
      <label className="me-field">
        <span>Subtitle</span>
        <input
          value={cfg.subtitle}
          placeholder="One line under the heading (optional)"
          onChange={(e) => setCfg((c) => ({ ...c, subtitle: e.target.value }))}
        />
      </label>

      <div className="spotlight-rows">
        {cfg.items.map((it, i) => (
          <div className="spotlight-row" key={i}>
            <span className="spotlight-row-at">@</span>
            <input
              className="text-input"
              value={it.username}
              placeholder="username"
              aria-label={`Gallery ${i + 1} username`}
              onChange={(e) => setItem(i, { username: e.target.value })}
            />
            <span className="spotlight-row-sep">/</span>
            <input
              className="text-input spotlight-row-slug"
              value={it.slug}
              placeholder="main"
              aria-label={`Gallery ${i + 1} slug`}
              onChange={(e) => setItem(i, { slug: e.target.value })}
            />
            <button className="btn-line" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
            <button className="btn-line" onClick={() => move(i, 1)} disabled={i === cfg.items.length - 1} aria-label="Move down">↓</button>
            <button className="btn-line danger" onClick={() => removeItem(i)} aria-label="Remove">×</button>
          </div>
        ))}
      </div>

      <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
        <button className="btn-line" onClick={addItem} disabled={cfg.items.length >= SPOTLIGHT_MAX}>
          + Add gallery
        </button>
        <button className="btn-line btn-gold" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : saved ? 'Saved' : 'Save spotlight'}
        </button>
      </div>
      {err && <p className="me-error">{err}</p>}
    </section>
  )
}
