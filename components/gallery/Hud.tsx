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
          {visitor ? `${visitor.ownerName} — @${visitor.username}` : 'A permanent collection — ten artists'}
        </span>
      </div>
    </header>
  )
}

export function HudActions() {
  const tourActive = useGallery((s) => s.tourActive)
  const setTourActive = useGallery((s) => s.setTourActive)
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const setSettingsOpen = useGallery((s) => s.setSettingsOpen)
  const visitor = useGallery((s) => s.visitor)
  const [audioOn, setAudioOn] = useState(galleryAudio.enabled)

  return (
    <div className="hud-actions">
      <button
        id="btn-audio"
        className={`hud-btn${audioOn ? ' active' : ''}`}
        onClick={() => {
          galleryAudio.unlock()
          setAudioOn(galleryAudio.toggle())
        }}
      >
        {audioOn ? '♪ Ambience on' : '♪ Ambience off'}
      </button>
      <button
        id="btn-tour"
        className={`hud-btn${tourActive ? ' active' : ''}`}
        onClick={() => setTourActive(!tourActive)}
      >
        {tourActive ? '■ End tour' : '▶ Guided tour'}
      </button>
      {/* No editing in visitor mode */}
      {!visitor && (
        <button id="btn-settings" className="hud-btn" onClick={() => setSettingsOpen(!settingsOpen)}>
          Edit space
        </button>
      )}
    </div>
  )
}

// Self-paced viewer nav: one tap moves to the next/previous work AND faces it
export function HudStepper() {
  const count = useExhibitionList().length
  const focusedIndex = useGallery((s) => s.focusedIndex)
  if (count === 0) return null
  const current = focusedIndex >= 0 ? String(focusedIndex + 1).padStart(2, '0') : '–'
  return (
    <div className="hud-stepper">
      <button className="step-btn" aria-label="Previous work" onClick={() => walkRef.current?.focusStep(-1)}>
        ‹
      </button>
      <span className="step-count">
        {current} <span className="step-sep">/</span> {String(count).padStart(2, '0')}
      </span>
      <button className="step-btn" aria-label="Next work" onClick={() => walkRef.current?.focusStep(1)}>
        ›
      </button>
    </div>
  )
}

export function Hint() {
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    let timer = setTimeout(() => setFaded(true), 9000)
    const onActivity = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setFaded(true), 4000)
    }
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  return (
    <div id="hint" className={`hint${faded ? ' faded' : ''}`}>
      <div className="hint-row"><b>Drag</b> look</div>
      <div className="hint-row"><b>WASD / tap floor</b> move</div>
      <div className="hint-row"><b>‹ › or , .</b> next work</div>
    </div>
  )
}
