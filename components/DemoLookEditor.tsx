'use client'
// Admin editor for the /demo showcase's theme. Stored in site_config (admin-
// writable, world-readable); the demo page reads it and opens in that theme.
// Themes only — layout/works of the demo stay as the built-in showcase.
import { useEffect, useRef, useState } from 'react'
import { fetchDemoLook, saveDemoLook } from '@/lib/siteConfig'
import { THEMES } from '@/lib/presets'
import { ThemeSwatch } from '@/components/SpacePreviews'

export default function DemoLookEditor() {
  const [theme, setTheme] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    fetchDemoLook()
      .then((l) => {
        if (!alive.current) return
        setTheme(l?.theme ?? null)
        setLoaded(true)
      })
      .catch(() => alive.current && setLoaded(true))
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  async function save(next: string) {
    setBusy(true)
    setErr('')
    try {
      await saveDemoLook({ theme: next })
      if (!alive.current) return
      setTheme(next)
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
      <h2>Demo look</h2>
      <p className="me-note" style={{ marginTop: 0 }}>
        The theme the public <code>/demo</code> showcase opens in. {saved && <b style={{ color: 'var(--gold)' }}>Saved</b>}
      </p>
      <div className="chips">
        {Object.entries(THEMES).map(([key, def]) => (
          <button
            key={key}
            className={`chip chip-visual${theme === key ? ' active' : ''}`}
            disabled={busy}
            onClick={() => void save(key)}
          >
            <ThemeSwatch themeKey={key} />
            {def.label}
          </button>
        ))}
      </div>
      {err && <p className="me-error">{err}</p>}
    </section>
  )
}
