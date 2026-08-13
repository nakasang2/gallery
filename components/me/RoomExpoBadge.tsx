'use client'
// 部屋の「通常展示⇄合同展示」バッジ（migration 0050、ユーザー指示 2026-08-10）。
//
// Hero の右上（旧: `.me-top` の文字ボタン列にあった「合同展示」ナビ）に置く。
// いま編集している部屋がどちらの種類かを常に見せる（合同展示なら展示名も）── これが
// 一番のねらい。切替は**空の部屋にしか効かない**（DB側 `switch_room_expo` が拒否する。
// 何を弾いたかは `roomExpoSwitchErrorKey` で読み分けて文言を出す）ので、ここでは
// クリックできない理由を先読みしようとしない。
//
// 合同展示の**作成**は常にExpoManagerからの新規作成（展示＋最初の部屋を自動生成）に
// 一本化した（DECISIONS 2026-08-12）。以前はここに「既存の空部屋を、選んだ展示に
// 参加させる」変換リストもあり、ExpoManagerでの新規作成と2つの入口が並んでいたのが
// ユーザーには分かりにくかった（「合同展示を作ったら、そこで0から設定できる方が
// いいのでは」という指摘）。**通常展示に戻す**（合同展示の部屋を抜ける）方向だけは
// 残す — これは「作成」ではなく「離脱」で、入口が2つになる話ではない。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import type { GalleryRow } from '@/lib/galleries'
import { listMyExpos, roomExpoSwitchErrorKey, switchRoomExpo, type Expo } from '@/lib/expos'
import { track } from '@/lib/analytics'
import { SwitchIcon } from '@/components/icons'

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

  // 合同展示への**参加**はもうここでは行わない（ExpoManagerからの新規作成に一本化 —
  // DECISIONS 2026-08-12）。残るのは**離脱**（通常展示に戻す）だけなので、引数は要らない。
  async function revertToNormal() {
    setBusy(true)
    setErr('')
    try {
      await switchRoomExpo(room.id, null)
      track('room_expo_switch', { to: 'normal' })
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
        {/* 左端のアイコン（ユーザー指示 2026-08-13）: このボタンがモード切替を開く
            ものだと一目で分かるように、通常展示⇄合同展示を表す矢印を label の前に置く。 */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}>
          <SwitchIcon />
          {label}
        </span>
      </button>
      {open && (
        <div id="room-expo-panel" className="room-expo-panel" role="dialog" aria-label={label}>
          {err && <p className="me-error">{err}</p>}
          {room.expo_id ? (
            <>
              <p className="room-expo-panel-title">
                {t('expo.roomSwitchCurrentHeading', { title: currentExpo?.title || t('common.untitled') })}
              </p>
              <button type="button" className="btn-line" disabled={busy} onClick={() => void revertToNormal()}>
                {t('expo.roomSwitchToNormal')}
              </button>
            </>
          ) : (
            // 合同展示への参加は常にExpoManagerの新規作成から（DECISIONS 2026-08-12）。
            // ここでは案内だけ出し、下の「展示管理へ」に導く。
            <p className="room-expo-panel-title">{t('expo.roomSwitchAddHeading')}</p>
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
