'use client'
// Top HUD (back/title), bottom-right actions (guided tour / edit space / ambience), and control hints
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { useExhibitionList } from '@/lib/exhibition'
import { walkRef } from '@/lib/controller'
import { galleryAudio } from '@/lib/audio'
import { audioGuide } from '@/lib/guide'
import { showToast } from '@/lib/toast'
import { SendIcon } from '@/components/icons'
import { useWalkRecorder } from './RecordButton'
import { useT } from '@/components/I18nProvider'

export function HudTop() {
  const t = useT()
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
          <span className="hud-identity-sub">{!untitled && `${visitor.ownerName} · `}XIBIT360</span>
        </div>
        <a
          className="hud-signup-cta"
          href={`/@${visitor.username}/${visitor.slug}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('hud.open')}
        </a>
      </header>
    )
  }

  // Visiting someone's actual gallery: lead with THEIR name/room, not the house
  // brand, and dedicate the opposite corner to a sign-up funnel — every visitor
  // here is a prospective artist, not just a browser of the demo collection.
  if (visitor) {
    const untitled = isPlaceholderTitle(visitor.title)
    // Top-left is just the essentials — service name, exhibition, exhibitor.
    // Everything else (report, sharing, the guestbook) lives in the bottom-right cluster.
    return (
      <header className="hud-top">
        <div className="hud-identity">
          <Link className="hud-identity-home" href="/">XIBIT360</Link>
          <span className="hud-identity-main">{untitled ? visitor.ownerName : visitor.title}</span>
          {!untitled && <span className="hud-identity-sub">{visitor.ownerName}</span>}
        </div>
        <Link className="hud-signup-cta" href="/signup">{t('common.startFree')}</Link>
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
          <Link className="hud-identity-home" href="/me">← {t('common.dashboard')}</Link>
          <span className="hud-identity-main">
            {untitled ? ownerName || t('hud.yourExhibition') : myGallery.title}
          </span>
          <span className="hud-identity-sub">
            {t('hud.yourSpace')} · {myGallery.is_public ? t('hud.livePublished') : t('hud.privateDraft')}
          </span>
        </div>
      </header>
    )
  }

  return (
    <header className="hud-top">
      <Link className="hud-back" href="/">← XIBIT360</Link>
      <div className="hud-title">
        <span className="hud-title-main">{t('hud.houseTitle')}</span>
        <span className="hud-title-sub">{t('hud.houseSub')}</span>
      </div>
    </header>
  )
}

// One icon-only round button that expands into a labelled capsule on hover/focus.
// On touch there's no hover, so it stays a circle and a single tap fires the action.
function HudAction({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`hud-action${active ? ' active' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span className="hud-action-label">{label}</span>
      <span className="hud-action-icon" aria-hidden="true">{icon}</span>
    </button>
  )
}

export function HudActions() {
  const t = useT()
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const setSettingsOpen = useGallery((s) => s.setSettingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const setGuestbookOpen = useGallery((s) => s.setGuestbookOpen)
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const infoOpen = useGallery((s) => s.infoOpen)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const tourActive = useGallery((s) => s.tourActive)
  const setTourActive = useGallery((s) => s.setTourActive)
  const hasWorks = useExhibitionList().length > 0
  const [audioOn, setAudioOn] = useState(galleryAudio.enabled)
  const [othersOpen, setOthersOpen] = useState(false)
  const recorder = useWalkRecorder()

  // The cluster rests at low opacity so it stops sitting on top of the artwork
  // (app/gallery.css). Desktop gets that back on :hover; touch has no hover, so
  // a tap holds the whole cluster at full presence for a few seconds — long
  // enough to reach a second button without it fading under your finger.
  const [engaged, setEngaged] = useState(false)
  const engageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const engage = () => {
    setEngaged(true)
    if (engageTimer.current) clearTimeout(engageTimer.current)
    engageTimer.current = setTimeout(() => setEngaged(false), 3500)
  }
  useEffect(() => () => { if (engageTimer.current) clearTimeout(engageTimer.current) }, [])

  // Any open surface (artwork sheet, settings, guestbook, exhibition info) covers this
  // corner — tuck the cluster away instead of leaving dead buttons underneath
  const tucked = focusedIndex >= 0 || settingsOpen || guestbookOpen || infoOpen

  const toggleAudio = () => {
    galleryAudio.unlock()
    const on = galleryAudio.toggle()
    setAudioOn(on)
    if (!on) audioGuide.stop() // one mute silences the narration too
  }

  const share = () => {
    if (!visitor) return
    const url = `${location.origin}/@${visitor.username}/${visitor.slug}`
    const title = isPlaceholderTitle(visitor.title) ? `${visitor.ownerName} — XIBIT360` : visitor.title
    if (typeof navigator !== 'undefined' && navigator.share) {
      void navigator.share({ title, url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(url).then(() => showToast(t('hud.linkCopied'))).catch(() => {})
    }
  }

  // Others: Report (public galleries only) + Record (wherever the browser can capture)
  const hasReport = !!visitor
  const showOthers = hasReport || recorder.available

  return (
    <div
      className={`hud-cluster${tucked ? ' tucked' : ''}${othersOpen ? ' others-open' : ''}${engaged ? ' engaged' : ''}`}
      aria-hidden={tucked}
      inert={tucked}
      onPointerDown={engage}
      onFocusCapture={engage}
    >
      {/* Base actions — hidden while Others is open so the submenu stands alone */}
      <div className="hud-base">
        {hasWorks && (
          <HudAction
            icon={tourActive ? '■' : '▶'}
            label={tourActive ? t('hud.endTour') : t('hud.tour')}
            active={tourActive}
            onClick={() => setTourActive(!tourActive)}
          />
        )}

        <HudAction icon="♪" label={audioOn ? t('hud.bgmOn') : t('hud.bgmOff')} active={audioOn} onClick={toggleAudio} />

        {visitor && <HudAction icon={<SendIcon />} label={t('hud.share')} onClick={share} />}

        {visitor ? (
          <HudAction
            icon="✎"
            label={t('hud.guestbook')}
            active={guestbookOpen}
            onClick={() => setGuestbookOpen(!guestbookOpen)}
          />
        ) : (
          user && (
            <HudAction
              icon="✎"
              label={t('hud.editSpace')}
              active={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
            />
          )
        )}
      </div>

      {showOthers && (
        <div className={`hud-others${othersOpen ? ' open' : ''}`} onMouseLeave={() => setOthersOpen(false)}>
          {/* Revealed above the Others button on hover (desktop) / tap (touch) */}
          <div className="hud-others-menu" role="menu">
            {hasReport && (
              <Link
                className="hud-action as-link"
                role="menuitem"
                href={`/report?about=${encodeURIComponent(`@${visitor!.username}/${visitor!.slug}`)}`}
                aria-label={t('hud.reportAria')}
              >
                <span className="hud-action-label">{t('hud.report')}</span>
                <span className="hud-action-icon" aria-hidden="true">⚑</span>
              </Link>
            )}
            {recorder.available && (
              <button
                className={`hud-action${recorder.recording ? ' active' : ''}`}
                role="menuitem"
                onClick={recorder.toggle}
                aria-label={recorder.recording ? t('hud.stopAria') : t('hud.recordAria')}
              >
                <span className="hud-action-label">{recorder.recording ? t('hud.stop') : t('hud.record')}</span>
                <span className="hud-action-icon" aria-hidden="true">{recorder.recording ? '■' : '●'}</span>
              </button>
            )}
          </div>
          <button
            className={`hud-action hud-others-toggle${othersOpen ? ' active' : ''}`}
            aria-label={othersOpen ? t('common.close') : t('hud.others')}
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((v) => !v)}
          >
            <span className="hud-action-label">{t('hud.others')}</span>
            {/* ⋯ while closed, ✕ while the submenu is showing (hover or open) */}
            <span className="hud-action-icon" aria-hidden="true">
              <span className="others-icon-closed">⋯</span>
              <span className="others-icon-open">✕</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

// Self-paced viewer nav: one tap moves to the next/previous work AND faces it.
// The guided tour lives here too — it is just the automatic version of the stepper.
export function HudStepper() {
  const t = useT()
  const count = useExhibitionList().length
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const infoOpen = useGallery((s) => s.infoOpen)
  if (count === 0) return null
  const current = focusedIndex >= 0 ? String(focusedIndex + 1).padStart(2, '0') : '–'
  // Any open sheet covers the pager — hide it rather than bury it. The artwork
  // panel now carries its own prev/next, so a focused work hides this too (it
  // otherwise floated over the artwork itself).
  const tucked = focusedIndex >= 0 || settingsOpen || guestbookOpen || infoOpen
  return (
    // The guided tour toggle now lives in the bottom-right cluster (HudActions), not here.
    <div
      className={`hud-stepper${tucked ? ' tucked' : ''}`}
      aria-hidden={tucked}
      inert={tucked}
    >
      <button className="step-btn" aria-label={t('artwork.previous')} onClick={() => walkRef.current?.focusStep(-1)}>
        ‹
      </button>
      <span className={`step-count${focusedIndex < 0 ? ' idle' : ''}`}>
        {current} <span className="step-sep">/</span> {String(count).padStart(2, '0')}
      </span>
      <button className="step-btn" aria-label={t('artwork.next')} onClick={() => walkRef.current?.focusStep(1)}>
        ›
      </button>
    </div>
  )
}

export function Hint() {
  const t = useT()
  const [faded, setFaded] = useState(false)
  // Never talk over an open surface — the idle re-show must not float above sheets
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const infoOpen = useGallery((s) => s.infoOpen)
  const suppressed = focusedIndex >= 0 || settingsOpen || guestbookOpen || infoOpen

  // Touch screens get a different hint entirely. Three rows wrap to 84px tall on a
  // phone and sit above 134px of chrome, so together they claimed a third of the
  // viewport (measured 34% at 375x667) — in a product whose whole point is looking
  // at the art. On touch we show one short line, drop the ‹ › row (the pager is
  // right there on screen), hide it on the first drag or tap, and never bring it
  // back: the gestures are two, and a visitor who has used them knows them.
  const [touch, setTouch] = useState(false)
  useEffect(() => {
    setTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // Fade after a while, but come back for lost users: 25s of idle re-shows the hint
  useEffect(() => {
    let hideT: ReturnType<typeof setTimeout>
    let showT: ReturnType<typeof setTimeout>
    if (touch) {
      const hide = () => setFaded(true)
      hideT = setTimeout(hide, 7000)
      window.addEventListener('pointerdown', hide, { once: true })
      return () => {
        clearTimeout(hideT)
        window.removeEventListener('pointerdown', hide)
      }
    }
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
  }, [touch])

  return (
    <div id="hint" className={`hint${touch ? ' hint-touch' : ''}${faded || suppressed ? ' faded' : ''}`}>
      {touch ? (
        <div className="hint-row">{t('hint.touch')}</div>
      ) : (
        <>
          <div className="hint-row"><b>{t('hint.drag')}</b> {t('hint.dragWhat')}</div>
          <div className="hint-row"><b>{t('hint.tap')}</b> {t('hint.tapWhat')}</div>
          <div className="hint-row"><b>‹ ›</b> {t('hint.step')}</div>
        </>
      )}
    </div>
  )
}
