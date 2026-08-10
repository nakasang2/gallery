'use client'
// The 2D half of moving between rooms (ユーザー決定 2026-08-09).
//
// There is ONE doorway per room, and the destination is chosen here rather than by
// walking to a particular opening. Three states, all above the canvas:
//   1. the PROMPT — standing at the doorway (RoomPortals writes `atDoorway`), offer to
//      go through. With one other room it says where; with several it opens the chooser.
//   2. the CHOOSER — every other room, pick one. Raised by the doorway (in 3D) or by the
//      prompt, and also reachable any time from the toggle below, so a big show never
//      needs a walk to reach room five.
//   3. the TOGGLE — the resting state: how many rooms this show has.
//
// Room names live here rather than as text in the 3D scene: they are already loaded, they
// stay legible at any distance, and they need no font texture.
//
// Renders nothing for a single-room show: `rooms` always contains the current room, so
// one entry means there is nowhere else to go.
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'
import { enterRoom } from './RoomPortals'

export default function RoomSwitch() {
  const t = useT()
  const visitor = useGallery((s) => s.visitor)
  const atDoorway = useGallery((s) => s.atDoorway)
  const pickerOpen = useGallery((s) => s.roomPickerOpen)
  const setPickerOpen = useGallery((s) => s.setRoomPickerOpen)
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const settingsOpen = useGallery((s) => s.settingsOpen)
  const guestbookOpen = useGallery((s) => s.guestbookOpen)
  const infoOpen = useGallery((s) => s.infoOpen)
  const embed = useGallery((s) => s.embed)

  const rooms = visitor?.rooms ?? []
  // An embed is a frame on somebody else's page, trimmed to the essentials by
  // convention. The 3D doorway still works there (`enterRoom` opens a new tab rather
  // than hijacking the frame), but this chrome is not part of the trimmed HUD.
  if (!visitor || rooms.length < 2 || embed) return null

  // Any open drawer already owns the bottom of the screen.
  if (focusedIndex >= 0 || settingsOpen || guestbookOpen || infoOpen) return null

  const label = (title: string, slug: string) => (isPlaceholderTitle(title) ? slug : title)
  const others = rooms.filter((r) => r.slug !== visitor.slug)
  const only = others.length === 1 ? others[0] : null

  return (
    <div className="roomswitch">
      {/* The doorway prompt. Only while the visitor is actually at the doorway, so it is
          allowed to be the loud one. With exactly one other room there is nothing to
          choose, so it names the destination and goes straight there. */}
      {atDoorway && !pickerOpen && (
        <button
          type="button"
          className="roomswitch-prompt"
          onClick={() => (only ? enterRoom(visitor, only) : setPickerOpen(true))}
        >
          <span className="roomswitch-prompt-icon" aria-hidden="true">→</span>
          {only ? t('hud.roomWalkThrough', { name: label(only.title, only.slug) }) : t('hud.roomChoose')}
        </button>
      )}
      <div className={`roomswitch-list${pickerOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="roomswitch-toggle"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen(!pickerOpen)}
        >
          {t('hud.roomList', { count: rooms.length })}
        </button>
        {pickerOpen && (
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
                    onClick={() => enterRoom(visitor, room)}
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
