'use client'
// Top HUD (back/title), bottom-right actions (guided tour / edit space / ambience), and control hints
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useGallery } from '@/lib/store'
import { useExhibitionList } from '@/lib/exhibition'
import { walkRef } from '@/lib/controller'
import { galleryAudio } from '@/lib/audio'

export function HudTop() {
  const visitor = useGallery((s) => s.visitor)
  return (
    <header className="hud-top">
      <Link className="hud-back" href="/">← HAKONIWA</Link>
      <div className="hud-title">
        <span className="hud-title-main">{visitor ? visitor.title : 'HAKONIWA COLLECTION'}</span>
        <span className="hud-title-sub">
          {visitor ? (
            <>
              <Link className="hud-artist-link" href={`/@${visitor.username}`}>
                {visitor.ownerName} — @{visitor.username}
              </Link>
              {' · '}
              <Link
                className="hud-report"
                href={`/report?about=${encodeURIComponent(`@${visitor.username}/${visitor.slug}`)}`}
              >
                Report
              </Link>
            </>
          ) : (
            'A permanent collection — ten artists'
          )}
        </span>
      </div>
    </header>
  )
}

export function HudActions() {
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const setSettingsOpen = useGallery((s) => s.setSettingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const setGuestbookOpen = useGallery((s) => s.setGuestbookOpen)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const [audioOn, setAudioOn] = useState(galleryAudio.enabled)

  return (
    <div className="hud-actions">
      {/* Sound: icon-only mute toggle, video-player style */}
      <button
        id="btn-audio"
        className={`hud-icon${audioOn ? ' active' : ' muted'}`}
        aria-label={audioOn ? 'Mute ambience' : 'Unmute ambience'}
        title={audioOn ? 'Ambience on' : 'Ambience off'}
        onClick={() => {
          galleryAudio.unlock()
          setAudioOn(galleryAudio.toggle())
        }}
      >
        ♪
      </button>
      {/* Visitors sign the guestbook; the space editor is for signed-in owners only */}
      {visitor ? (
        <button
          id="btn-guestbook"
          className={`hud-btn${guestbookOpen ? ' active' : ''}`}
          onClick={() => setGuestbookOpen(!guestbookOpen)}
        >
          ✎ Guestbook
        </button>
      ) : (
        user && (
          <button id="btn-settings" className="hud-btn" onClick={() => setSettingsOpen(!settingsOpen)}>
            Edit space
          </button>
        )
      )}
    </div>
  )
}

// Self-paced viewer nav: one tap moves to the next/previous work AND faces it.
// The guided tour lives here too — it is just the automatic version of the stepper.
export function HudStepper() {
  const count = useExhibitionList().length
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const tourActive = useGallery((s) => s.tourActive)
  const setTourActive = useGallery((s) => s.setTourActive)
  if (count === 0) return null
  const current = focusedIndex >= 0 ? String(focusedIndex + 1).padStart(2, '0') : '–'
  return (
    // 'lifted' rides above the phone bottom sheet so browsing next/prev never needs closing it
    <div className={`hud-stepper${focusedIndex >= 0 ? ' lifted' : ''}`}>
      <button className="step-btn" aria-label="Previous work" onClick={() => walkRef.current?.focusStep(-1)}>
        ‹
      </button>
      <span className="step-count">
        {current} <span className="step-sep">/</span> {String(count).padStart(2, '0')}
      </span>
      <button className="step-btn" aria-label="Next work" onClick={() => walkRef.current?.focusStep(1)}>
        ›
      </button>
      <span className="step-divider" aria-hidden="true" />
      <button
        className={`step-btn step-tour${tourActive ? ' active' : ''}`}
        aria-label={tourActive ? 'End the guided tour' : 'Start the guided tour'}
        title={tourActive ? 'End tour' : 'Guided tour'}
        onClick={() => setTourActive(!tourActive)}
      >
        {tourActive ? '■' : '▶'}
      </button>
    </div>
  )
}

export function Hint() {
  const [faded, setFaded] = useState(false)

  // Fade after a while, but come back for lost users: 25s of idle re-shows the hint
  useEffect(() => {
    let hideT: ReturnType<typeof setTimeout>
    let showT: ReturnType<typeof setTimeout>
    const arm = (delay: number) => {
      clearTimeout(hideT)
      hideT = setTimeout(() => {
        setFaded(true)
        clearTimeout(showT)
        showT = setTimeout(() => {
          setFaded(false)
          arm(6000)
        }, 25000)
      }, delay)
    }
    const onActivity = () => {
      clearTimeout(showT)
      arm(4000)
    }
    arm(9000)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      clearTimeout(hideT)
      clearTimeout(showT)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  return (
    <div id="hint" className={`hint${faded ? ' faded' : ''}`}>
      <div className="hint-row"><b>Drag</b> walk & steer</div>
      <div className="hint-row"><b>Tap</b> floor to go · a work to view</div>
      <div className="hint-row"><b>‹ ›</b> next work</div>
    </div>
  )
}
