'use client'
// Admin editor for the landing-page hero works (migration 0018). Upload up to three
// images (center / left / right); an empty slot falls back to the built-in demo art.
// One setting drives both PC and mobile, since the LP just reads site_config.
import { useEffect, useRef, useState } from 'react'
import { useGallery } from '@/lib/store'
import { uploadLpImage } from '@/lib/cloud'
import { fetchLpHero, saveLpHero, LP_HERO_SLOTS, LP_HERO_SLOT_LABELS, type LpHeroSlot } from '@/lib/siteConfig'

export default function LpHeroEditor() {
  const user = useGallery((s) => s.user)
  const [slots, setSlots] = useState<LpHeroSlot[]>(Array(LP_HERO_SLOTS).fill(null))
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Guards against setState after unmount (navigating away mid-save/upload)
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    fetchLpHero()
      .then((s) => {
        if (!alive.current) return
        setSlots(s)
        setLoaded(true)
      })
      .catch(() => alive.current && setLoaded(true))
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  async function onFile(i: number, file: File | undefined) {
    if (!file || !user) return
    setBusy(i)
    try {
      const img = await uploadLpImage(user.id, i, file)
      if (!alive.current) return
      setSlots((prev) => prev.map((s, k) => (k === i ? img : s)))
      setDirty(true)
    } catch (e) {
      if (alive.current) alert(`Upload failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  function clearSlot(i: number) {
    setSlots((prev) => prev.map((s, k) => (k === i ? null : s)))
    setDirty(true)
  }

  async function save() {
    setBusy(-1)
    try {
      await saveLpHero(slots)
      if (!alive.current) return
      setSaved(true)
      setDirty(false)
      savedTimer.current = setTimeout(() => setSaved(false), 1800)
    } catch (e) {
      if (alive.current) alert(`Could not save: ${e instanceof Error ? e.message : e}`)
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  return (
    <section className="me-section">
      <h2>Landing page hero</h2>
      <div className="me-card">
        <p className="me-note" style={{ marginTop: 0 }}>
          The three works visible at the top of the landing page (PC &amp; mobile). Upload an image
          for a slot, or leave it empty to keep the built-in demo art. Wide (landscape) images sit
          best in these frames.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginTop: '0.8rem' }}>
          {Array.from({ length: LP_HERO_SLOTS }).map((_, i) => {
            const s = slots[i]
            return (
              <div key={i} style={{ border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.8rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.6rem' }}>
                  {LP_HERO_SLOT_LABELS[i] ?? `Slot ${i + 1}`}
                </div>
                <div style={{ aspectRatio: '4 / 3', background: '#0d0c0b', border: '1px solid var(--hairline)', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {s ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Demo default</span>
                  )}
                </div>
                <div className="hako-actions" style={{ marginTop: '0.6rem' }}>
                  <label className="btn-line file-btn" aria-disabled={busy === i} style={{ marginTop: 0 }}>
                    {busy === i ? 'Uploading…' : s ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={busy !== null}
                      onChange={(e) => {
                        void onFile(i, e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {s && (
                    <button className="btn-line" disabled={busy !== null} onClick={() => clearSlot(i)}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="hako-actions" style={{ marginTop: '1rem' }}>
          <button className="btn-line btn-gold" disabled={!loaded || busy !== null || !dirty} onClick={() => void save()}>
            {saved ? 'Saved' : busy === -1 ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="me-note">
          Changes apply to everyone on the next landing-page load. Images are served from public
          storage, so they may take a moment to appear the first time.
        </p>
      </div>
    </section>
  )
}
