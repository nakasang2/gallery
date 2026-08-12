'use client'
// The 2D half of moving between rooms (ユーザー決定 2026-08-09).
//
// There is ONE doorway per room, and the destination is chosen at the doorway or from
// the room-picker icon in the HUD's bottom-right cluster (ユーザー指示 2026-08-12: the
// full chooser moved from an always-on toggle above the minimap into that menu, opening
// as a modal — `RoomPickerModal`, mounted below). This file keeps only the contextual
// piece: the PROMPT that appears while actually standing at the doorway (RoomPortals
// writes `atDoorway`). With one other room it says where and goes straight there; with
// several it raises the same modal.
//
// Renders nothing for a single-room show: `rooms` always contains the current room, so
// one entry means there is nowhere else to go.
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'
import { enterRoom } from './RoomPortals'
import RoomPickerModal from './RoomPickerModal'

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

  const label = (title: string, slug: string) => (isPlaceholderTitle(title) ? slug : title)
  const others = rooms.filter((r) => r.slug !== visitor.slug)
  const only = others.length === 1 ? others[0] : null
  // The modal can be open regardless of any drawer state (raised from the HUD menu,
  // which already tucks itself away while a drawer is open) — only the doorway prompt
  // defers to an open drawer, since that already owns the bottom of the screen.
  const showPrompt = atDoorway && !pickerOpen && focusedIndex < 0 && !settingsOpen && !guestbookOpen && !infoOpen

  return (
    <>
      {showPrompt && (
        <div className="roomswitch">
          <button
            type="button"
            className="roomswitch-prompt"
            onClick={() => (only ? enterRoom(visitor, only) : setPickerOpen(true))}
          >
            <span className="roomswitch-prompt-icon" aria-hidden="true">→</span>
            {only ? t('hud.roomWalkThrough', { name: label(only.title, only.slug) }) : t('hud.roomChoose')}
          </button>
        </div>
      )}
      {pickerOpen && <RoomPickerModal visitor={visitor} onClose={() => setPickerOpen(false)} />}
    </>
  )
}
