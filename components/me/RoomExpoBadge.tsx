'use client'
// 部屋の「通常展示⇄合同展示」バッジ（migration 0050、ユーザー指示 2026-08-10）。
//
// Hero の右上（旧: `.me-top` の文字ボタン列にあった「合同展示」ナビ）に置く。
// いま編集している部屋がどちらの種類かを常に見せる（合同展示なら展示名も）── これが
// 一番のねらい。切替は**空の部屋にしか効かない**（DB側 `switch_room_expo` が拒否する。
// 何を弾いたかは `roomExpoSwitchErrorKey` で読み分けて文言を出す）ので、ここでは
// クリックできない理由を先読みしようとしない。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import type { GalleryRow } from '@/lib/galleries'
import { listMyExpos, roomExpoSwitchErrorKey, switchRoomExpo, type Expo } from '@/lib/expos'
import { track } from '@/lib/analytics'

export default function RoomExpoBadge({
  room,
  userId,
  onOpenExpoManager,
  onChanged,
}: {
  room: GalleryRow
  userId: string
  onOpenExpoManager: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // null = 未取得。合同展示の部屋なら展示名を出すため常時（開いていなくても）取りに行く。
  const [expos, setExpos] = useState<Expo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setExpos(await listMyExpos(userId))
    } catch {
      // 0044 未適用、または読み込み失敗。バッジは「通常展示」表示に留める。
      setExpos([])
    }
  }, [userId])

  useEffect(() => {
    setErr('')
    void load()
    // 部屋が変わったら開きっぱなしにしない。
    setOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  // 外側を押す / Escape で閉じる（TopActions・NotificationBell と同じ作り）。
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentExpo = room.expo_id ? expos?.find((x) => x.id === room.expo_id) : undefined
  const label = room.expo_id
    ? t('expo.roomModeJoint', { title: currentExpo?.title || t('common.untitled') })
    : t('expo.roomModeNormal')

  async function doSwitch(expoId: string | null) {
    setBusy(true)
    setErr('')
    try {
      await switchRoomExpo(room.id, expoId)
      track('room_expo_switch', { to: expoId ? 'joint' : 'normal' })
      setOpen(false)
      onChanged()
    } catch (e) {
      const key = roomExpoSwitchErrorKey(e)
      setErr(
        key === 'not_empty'
          ? t('expo.roomSwitchFailedEmpty')
          : key === 'no_allowance'
            ? t('expo.roomSwitchFailedAllowance')
            : t('expo.roomSwitchFailedOther')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="room-expo-badge" ref={wrap}>
      <button
        type="button"
        className="btn-line"
        aria-expanded={open}
        aria-controls="room-expo-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div id="room-expo-panel" className="room-expo-panel" role="dialog" aria-label={label}>
          {err && <p className="me-error">{err}</p>}
          {room.expo_id ? (
            <>
              <p className="room-expo-panel-title">
                {t('expo.roomSwitchCurrentHeading', { title: currentExpo?.title || t('common.untitled') })}
              </p>
              <button type="button" className="btn-line" disabled={busy} onClick={() => void doSwitch(null)}>
                {t('expo.roomSwitchToNormal')}
              </button>
            </>
          ) : (
            <>
              <p className="room-expo-panel-title">{t('expo.roomSwitchAddHeading')}</p>
              {expos === null ? (
                <p className="me-note">{t('expo.loading')}</p>
              ) : expos.length === 0 ? (
                <p className="me-note">{t('expo.roomSwitchNoExpo')}</p>
              ) : (
                <ul className="room-expo-list">
                  {expos.map((x) => (
                    <li key={x.id}>
                      <button type="button" className="btn-line" disabled={busy} onClick={() => void doSwitch(x.id)}>
                        {x.title || t('common.untitled')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <button
            type="button"
            className="btn-line room-expo-manage"
            onClick={() => {
              setOpen(false)
              onOpenExpoManager()
            }}
          >
            {t('expo.tab')} →
          </button>
        </div>
      )}
    </div>
  )
}
