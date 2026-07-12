'use client'
// Artwork info panel (details for the focused work, plus per-work framing / visitor likes)
import { useEffect, useRef, useState } from 'react'
import { walkRef } from '@/lib/controller'
import { useExhibitionList, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor, setOverride } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'
import { addLike, hasLiked, likeCount } from '@/lib/engagement'
import WorkDesign from '@/components/WorkDesign'

// The artist may type "myshop.com/item" without a protocol — assume https
function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

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

  // Swiping the sheet itself also pages between works (vertical scroll untouched)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  return (
    <aside
      id="panel"
      className={`panel${open ? ' open' : ''}`}
      aria-hidden={!open}
      inert={!open}
      onTouchStart={(e) => {
        const t = e.touches[0]
        touchStart.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const s = touchStart.current
        touchStart.current = null
        if (!s) return
        const t = e.changedTouches[0]
        const dx = t.clientX - s.x
        const dy = t.clientY - s.y
        if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          walkRef.current?.focusStep(dx < 0 ? 1 : -1)
        }
      }}
    >
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
          <div className="panel-no">No. {String(focusedIndex + 1).padStart(2, '0')}</div>
          <h2 className="panel-title">{art.title}</h2>
          <div className="panel-artist">{art.artist} — {art.year}</div>
          {/* The visitor's one reaction deserves a real touch target, not an afterthought */}
          {visitor && <LikeButton galleryId={visitor.galleryId} artworkId={art.id} />}
          <p className="panel-desc">{art.desc}</p>
          <div className="panel-tags">
            {(art.tags || []).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          {art.purchaseUrl && (
            <a className="panel-buy" href={toHref(art.purchaseUrl)} target="_blank" rel="noopener noreferrer">
              Available for purchase ↗
            </a>
          )}
          {/* Per-work design (frame / mat / hanging / caption) cannot be changed in visitor mode */}
          {!visitor && (
            <div className="panel-frame">
              <div className="panel-frame-label">Design — this work</div>
              <WorkDesign
                frameKey={frameKeyFor(settings, art)}
                matKey={matKeyFor(settings, art)}
                hangingKey={hangingKeyFor(settings, art)}
                captionKey={captionKeyFor(settings, art)}
                onFrame={(k) =>
                  updateSettings({ frameOverrides: setOverride(settings.frameOverrides, art.id, k, settings.frame) })
                }
                onMat={(k) =>
                  updateSettings({ matOverrides: setOverride(settings.matOverrides, art.id, k, settings.mat) })
                }
                onHanging={(k) =>
                  updateSettings({ hangingOverrides: setOverride(settings.hangingOverrides, art.id, k, settings.hanging) })
                }
                onCaption={(k) =>
                  updateSettings({ captionOverrides: setOverride(settings.captionOverrides, art.id, k, settings.caption) })
                }
              />
              <p className="settings-note" style={{ marginTop: '0.6rem' }}>
                These apply to this work only. Matching the gallery-wide setting clears the
                override, so the work follows the theme again.
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
