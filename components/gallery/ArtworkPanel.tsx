'use client'
// Artwork info panel (details for the focused work, plus per-work framing / visitor likes)
import { useEffect, useState } from 'react'
import { FRAMES } from '@/lib/presets'
import { useExhibitionList, frameKeyFor } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'
import { addLike, hasLiked, likeCount } from '@/lib/engagement'

// Visitor-only like button (anonymous; dedupe per browser)
function LikeButton({ galleryId, artworkId }: { galleryId: string; artworkId: string }) {
  const [count, setCount] = useState<number | null>(null)
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setLiked(hasLiked(artworkId))
    likeCount(artworkId)
      .then((n) => alive && setCount(n))
      .catch(() => {}) // migration 0008 not applied — keep the button usable-looking but countless
    return () => {
      alive = false
    }
  }, [artworkId])

  async function like() {
    if (liked || busy) return
    setBusy(true)
    try {
      await addLike(galleryId, artworkId)
      setLiked(true)
      setCount((c) => (c ?? 0) + 1)
    } catch {
      /* likes must never interrupt viewing */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className={`like-btn${liked ? ' liked' : ''}`} disabled={liked || busy} onClick={() => void like()}>
      {liked ? '♥' : '♡'} {count ?? ''}
    </button>
  )
}

export default function ArtworkPanel() {
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const setFocused = useGallery((s) => s.setFocused)
  const setTourActive = useGallery((s) => s.setTourActive)
  const updateSettings = useGallery((s) => s.updateSettings)
  const visitor = useGallery((s) => s.visitor)
  const settings = useSettings()

  const list = useExhibitionList()
  const art = focusedIndex >= 0 ? list[focusedIndex] : null
  const open = !!art

  return (
    <aside id="panel" className={`panel${open ? ' open' : ''}`} aria-hidden={!open} inert={!open}>
      <button
        className="panel-close"
        aria-label="Close"
        onClick={() => {
          setTourActive(false)
          setFocused(-1)
        }}
      >
        ×
      </button>
      {art && (
        <>
          <div className="panel-no">
            No. {String(focusedIndex + 1).padStart(2, '0')}
            {visitor && <LikeButton galleryId={visitor.galleryId} artworkId={art.id} />}
          </div>
          <h2 className="panel-title">{art.title}</h2>
          <div className="panel-artist">{art.artist} — {art.year}</div>
          <p className="panel-desc">{art.desc}</p>
          <div className="panel-tags">
            {(art.tags || []).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          {/* Framing cannot be changed in visitor mode */}
          {!visitor && (
            <div className="panel-frame">
              <div className="panel-frame-label">Framing — this work</div>
              <div className="chips">
                {Object.entries(FRAMES).map(([key, def]) => (
                  <button
                    key={key}
                    className={`chip${frameKeyFor(settings, art) === key ? ' active' : ''}`}
                    onClick={() => updateSettings({ frameOverrides: { ...settings.frameOverrides, [art.id]: key } })}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
