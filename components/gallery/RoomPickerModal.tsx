'use client'
// Full destination picker (ユーザー指示 2026-08-12) — every other public room, reachable
// from the right-side HUD menu at any time, not just while standing at the doorway.
// Follows the modal shape already in the app (PurchaseModal / HelpModal): a dimmed
// backdrop that closes on click, Escape to close, role="dialog" + aria-modal.
import { useEffect } from 'react'
import { isPlaceholderTitle, type PublicExhibition, type SiblingRoom } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'
import { enterRoom } from './RoomPortals'

export default function RoomPickerModal({
  visitor,
  onClose,
}: {
  visitor: PublicExhibition
  onClose: () => void
}) {
  const t = useT()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = (room: SiblingRoom) => (isPlaceholderTitle(room.title) ? room.slug : room.title)

  return (
    <div className="purchase-backdrop" onClick={onClose}>
      <div
        className="roompicker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('hud.roomList', { count: visitor.rooms.length })}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="purchase-close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 className="roompicker-title">{t('hud.roomList', { count: visitor.rooms.length })}</h2>
        <ul className="roomswitch-items">
          {visitor.rooms.map((room) => {
            const here = room.slug === visitor.slug
            return (
              <li key={room.slug}>
                <button
                  type="button"
                  className={`roomswitch-item${here ? ' current' : ''}`}
                  aria-current={here ? 'page' : undefined}
                  disabled={here}
                  onClick={() => {
                    if (!here) enterRoom(visitor, room)
                  }}
                >
                  {label(room)}
                  {here && <span className="roomswitch-here">{t('hud.roomHere')}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
