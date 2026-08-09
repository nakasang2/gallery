'use client'
// The 2D half of moving between rooms (ユーザー決定 2026-08-09).
//
// Two jobs, both above the canvas:
//   1. the PROMPT — when the visitor is standing in front of a connecting doorway
//      (RoomPortals writes `nearRoomSlug`), name the room it leads to and offer to walk
//      through. The room's name lives here rather than as text in the 3D scene: it is
//      already loaded, it stays legible at any distance, and it needs no font texture.
//   2. the LIST — every room of the show, so a visitor can jump straight to any of them
//      instead of walking. A big show should not need a walk to reach room five.
//
// Renders nothing for a single-room show: `rooms` always contains the current room, so
// one entry means there is nowhere else to go.
import { useState } from 'react'
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'
import { enterRoom } from './RoomPortals'

export default function RoomSwitch() {
  const t = useT()
  const visitor = useGallery((s) => s.visitor)
  const nearRoomSlug = useGallery((s) => s.nearRoomSlug)
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const infoOpen = useGallery((s) => s.infoOpen)
  const embed = useGallery((s) => s.embed)
  const [listOpen, setListOpen] = useState(false)

  const rooms = visitor?.rooms ?? []
  // An embed is a frame on somebody else's page, trimmed to the essentials by
  // convention. The 3D doorways still work there (`enterRoom` opens a new tab rather
  // than hijacking the frame), but this chrome is not part of the trimmed HUD.
  if (!visitor || rooms.length < 2 || embed) return null

  // Any open drawer already owns the bottom of the screen.
  const covered = focusedIndex >= 0 || settingsOpen || guestbookOpen || infoOpen
  if (covered) return null

  const near = nearRoomSlug ? rooms.find((r) => r.slug === nearRoomSlug) : null
  const label = (title: string, slug: string) => (isPlaceholderTitle(title) ? slug : title)

  return (
    <div className="roomswitch">
      {/* The doorway prompt. Sits above the list so it never covers it, and only
          while the visitor is actually standing at a doorway. */}
      {near && (
        <button type="button" className="roomswitch-prompt" onClick={() => enterRoom(visitor.username, near)}>
          <span className="roomswitch-prompt-icon" aria-hidden="true">→</span>
          {t('hud.roomWalkThrough', { name: label(near.title, near.slug) })}
        </button>
      )}
      <div className={`roomswitch-list${listOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="roomswitch-toggle"
          aria-expanded={listOpen}
          onClick={() => setListOpen((v) => !v)}
        >
          {t('hud.roomList', { count: rooms.length })}
        </button>
        {listOpen && (
          <ul className="roomswitch-items">
            {rooms.map((room) => {
              const here = room.slug === visitor.slug
              return (
                <li key={room.slug}>
                  <button
                    type="button"
                    className={`roomswitch-item${here ? ' current' : ''}`}
                    aria-current={here ? 'page' : undefined}
                    disabled={here}
                    onClick={() => enterRoom(visitor.username, room)}
                  >
                    {label(room.title, room.slug)}
                    {here && <span className="roomswitch-here">{t('hud.roomHere')}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
