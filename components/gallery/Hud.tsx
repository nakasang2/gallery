'use client'
// 上部HUD(戻る/タイトル)と右下アクション(順路ツアー/空間を編集/環境音)、操作ヒント
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useGallery } from '@/lib/store'
import { galleryAudio } from '@/lib/audio'

export function HudTop() {
  const visitor = useGallery((s) => s.visitor)
  return (
    <header className="hud-top">
      <Link className="hud-back" href="/">← HAKONIWA</Link>
      <div className="hud-title">
        <span className="hud-title-main">{visitor ? visitor.title : 'HAKONIWA COLLECTION'}</span>
        <span className="hud-title-sub">
          {visitor ? `${visitor.ownerName} — @${visitor.username}` : '10人の作家による常設展'}
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
        {audioOn ? '♪ 環境音 ON' : '♪ 環境音 OFF'}
      </button>
      <button
        id="btn-tour"
        className={`hud-btn${tourActive ? ' active' : ''}`}
        onClick={() => setTourActive(!tourActive)}
      >
        {tourActive ? '■ ツアーを止める' : '▶ 順路ツアー'}
      </button>
      {/* 来場者モードでは編集させない */}
      {!visitor && (
        <button id="btn-settings" className="hud-btn" onClick={() => setSettingsOpen(!settingsOpen)}>
          空間を編集
        </button>
      )}
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
      <div className="hint-row"><b>ドラッグ</b> 見回す</div>
      <div className="hint-row"><b>W A S D / 床タップ</b> 移動</div>
      <div className="hint-row"><b>作品クリック</b> 鑑賞</div>
    </div>
  )
}
