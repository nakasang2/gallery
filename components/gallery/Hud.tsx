'use client'
// Top HUD (back/title), bottom-right actions (guided tour / edit space / ambience), and control hints
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { useExhibitionList } from '@/lib/exhibition'
import { walkRef } from '@/lib/controller'
import { galleryAudio } from '@/lib/audio'
import SnsLinks from '@/components/SnsLinks'

export function HudTop() {
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const ownerName = useGallery((s) => s.profileDisplayName)
  const embed = useGallery((s) => s.embed)

  // Embedded on a third-party site: the surrounding page already gives context,
  // so trim to the room title + one back-link to the full show (a new tab —
  // navigating the iframe would trap the visitor). This link doubles as the
  // growth-loop backlink every embed carries.
  if (visitor && embed) {
    const untitled = isPlaceholderTitle(visitor.title)
    return (
      <header className="hud-top">
        <div className="hud-identity">
          <span className="hud-identity-main">{untitled ? visitor.ownerName : visitor.title}</span>
          <span className="hud-identity-sub">{!untitled && `${visitor.ownerName} · `}HAKONIWA</span>
        </div>
        <a
          className="hud-signup-cta"
          href={`/@${visitor.username}/${visitor.slug}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open ↗
        </a>
      </header>
    )
  }

  // Visiting someone's actual gallery: lead with THEIR name/room, not the house
  // brand, and dedicate the opposite corner to a sign-up funnel — every visitor
  // here is a prospective artist, not just a browser of the demo collection.
  if (visitor) {
    const untitled = isPlaceholderTitle(visitor.title)
    return (
      <header className="hud-top">
        <div className="hud-identity">
          <Link className="hud-identity-home" href="/">HAKONIWA</Link>
          <Link className="hud-identity-main" href={`/@${visitor.username}`}>
            {untitled ? visitor.ownerName : visitor.title}
          </Link>
          <span className="hud-identity-sub">
            {!untitled && `${visitor.ownerName} · `}@{visitor.username}
            <SnsLinks sns={visitor.ownerSns} className="hud-sns" />
            {' · '}
            <Link className="hud-report" href="/explore">Explore</Link>
            {' · '}
            <Link
              className="hud-report"
              href={`/report?about=${encodeURIComponent(`@${visitor.username}/${visitor.slug}`)}`}
            >
              Report
            </Link>
          </span>
        </div>
        <Link className="hud-signup-cta" href="/signup">Start free</Link>
      </header>
    )
  }

  // Signed-in owner previewing/editing their OWN room (not the public visitor view,
  // not the anonymous demo): lead with THEIR exhibition and a way back to the
  // dashboard — never the house "permanent collection" chrome.
  if (user && myGallery) {
    const untitled = isPlaceholderTitle(myGallery.title)
    return (
      <header className="hud-top">
        <div className="hud-identity">
          <Link className="hud-identity-home" href="/me">← Dashboard</Link>
          <span className="hud-identity-main">
            {untitled ? ownerName || 'Your exhibition' : myGallery.title}
          </span>
          <span className="hud-identity-sub">
            Your space · {myGallery.is_public ? 'live — saved edits publish instantly' : 'private draft'}
          </span>
        </div>
      </header>
    )
  }

  return (
    <header className="hud-top">
      <Link className="hud-back" href="/">← HAKONIWA</Link>
      <div className="hud-title">
        <span className="hud-title-main">HAKONIWA COLLECTION</span>
        <span className="hud-title-sub">A permanent collection — ten works</span>
      </div>
    </header>
  )
}

export function HudActions() {
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const setSettingsOpen = useGallery((s) => s.setSettingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const setGuestbookOpen = useGallery((s) => s.setGuestbookOpen)
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const [audioOn, setAudioOn] = useState(galleryAudio.enabled)

  // Any open surface (artwork sheet, settings, guestbook) covers this corner —
  // tuck the actions away instead of leaving dead buttons underneath
  const tucked = focusedIndex >= 0 || settingsOpen || guestbookOpen

  return (
    <div className={`hud-actions${tucked ? ' tucked' : ''}`} aria-hidden={tucked} inert={tucked}>
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
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  if (count === 0) return null
  const current = focusedIndex >= 0 ? String(focusedIndex + 1).padStart(2, '0') : '–'
  // Settings/guestbook sheets cover the pager — hide it rather than bury it
  const tucked = settingsOpen || guestbookOpen
  return (
    // 'lifted' rides above the phone bottom sheet so browsing next/prev never needs closing it
    <div
      className={`hud-stepper${focusedIndex >= 0 ? ' lifted' : ''}${tucked ? ' tucked' : ''}`}
      aria-hidden={tucked}
      inert={tucked}
    >
      <button className="step-btn" aria-label="Previous work" onClick={() => walkRef.current?.focusStep(-1)}>
        ‹
      </button>
      <span className={`step-count${focusedIndex < 0 ? ' idle' : ''}`}>
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
  // Never talk over an open surface — the idle re-show must not float above sheets
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const suppressed = focusedIndex >= 0 || settingsOpen || guestbookOpen

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
    <div id="hint" className={`hint${faded || suppressed ? ' faded' : ''}`}>
      <div className="hint-row"><b>Drag</b> walk & steer</div>
      <div className="hint-row"><b>Tap</b> floor to go · a work to view</div>
      <div className="hint-row"><b>‹ ›</b> next work</div>
    </div>
  )
}
