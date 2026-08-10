'use client'
// 作品スロットを部屋間で移動する（migration 0052、ユーザー指示・DECISIONS 2026-08-10）。
//
// 背景: 無料の個人部屋は5枠、合同展示の部屋は出展料に15枠が含まれる ── 合計20枠
// なのに部屋ごとに固定され、自由に配分し直せなかった。ここは「合計は変えず、
// 部屋間で`work_cap`を移動する」という決定（案B）のUI側。`RoomExpoBadge`と同じ
// 「トリガー＋絶対配置のドロップダウン」の型。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { MAX_WORKS_PER_ROOM } from '@/lib/limits'
import {
  listAllOwnedRooms,
  transferCapacityErrorKey,
  transferRoomCapacity,
  type GalleryRow,
} from '@/lib/galleries'
import { track } from '@/lib/analytics'

export default function CapacityTransfer({
  room,
  userId,
  onChanged,
}: {
  room: GalleryRow
  userId: string
  onChanged: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // null = 未取得。開くたびに引き直す（他の部屋のwork_capが変わっている可能性がある）。
  const [rooms, setRooms] = useState<GalleryRow[] | null>(null)
  const [destId, setDestId] = useState('')
  const [amount, setAmount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const all = await listAllOwnedRooms(userId)
      const others = all.filter((r) => r.id !== room.id)
      setRooms(others)
      setDestId((prev) => (prev && others.some((r) => r.id === prev) ? prev : others[0]?.id ?? ''))
    } catch {
      setRooms([])
    }
  }, [userId, room.id])

  useEffect(() => {
    if (!open) return
    setErr('')
    void load()
  }, [open, load])

  // 外側を押す / Escape で閉じる（RoomExpoBadge・TopActionsと同じ作り）。
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

  // 移動できるのは他に部屋が無いと成り立たない。無いときはボタン自体を出さない
  // （押しても何もできないボタンを見せない）。
  if ((room.work_cap ?? 0) <= 1) return null

  const dest = rooms?.find((r) => r.id === destId) ?? null
  const maxFromSource = Math.max(0, (room.work_cap ?? 1) - 1)
  const maxToDest = dest ? Math.max(0, MAX_WORKS_PER_ROOM - (dest.work_cap ?? 0)) : 0
  const maxAmount = Math.min(maxFromSource, maxToDest)
  const amountNum = Number.parseInt(amount, 10)
  const amountOk = Number.isFinite(amountNum) && amountNum >= 1 && amountNum <= maxAmount

  async function doTransfer() {
    if (!dest || !amountOk) return
    setBusy(true)
    setErr('')
    try {
      await transferRoomCapacity(room.id, dest.id, amountNum)
      track('room_capacity_transfer', { amount: amountNum })
      setOpen(false)
      setAmount('1')
      onChanged()
    } catch (e) {
      const key = transferCapacityErrorKey(e)
      setErr(
        key === 'floor'
          ? t('me.transferSlotsFailedFloor')
          : key === 'ceiling'
            ? t('me.transferSlotsFailedCeiling')
            : t('me.transferSlotsFailedOther')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="capacity-transfer" ref={wrap}>
      <button
        type="button"
        className="btn-line"
        aria-expanded={open}
        aria-controls="capacity-transfer-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {t('me.transferSlots')}
      </button>
      {open && (
        <div
          id="capacity-transfer-panel"
          className="capacity-transfer-panel"
          role="dialog"
          aria-label={t('me.transferSlots')}
        >
          <p className="capacity-transfer-panel-title">{t('me.transferSlots')}</p>
          <p className="me-note" style={{ marginTop: 0 }}>{t('me.transferSlotsIntro')}</p>
          {err && <p className="me-error">{err}</p>}
          {rooms === null ? (
            <p className="me-note">{t('expo.loading')}</p>
          ) : rooms.length === 0 ? (
            <p className="me-note">{t('me.transferSlotsNoRooms')}</p>
          ) : (
            <>
              <label className="me-field">
                <span>{t('me.transferSlotsDestination')}</span>
                <select value={destId} onChange={(e) => setDestId(e.target.value)}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.title || r.slug) + ` (${r.work_cap}/${MAX_WORKS_PER_ROOM})`}
                    </option>
                  ))}
                </select>
              </label>
              {/* 選んだ部屋が既に上限のとき、枚数欄が動かない理由をここで伝える
                  （そうしないと「(15/15)」の数字を読めた人にしか理由が分からない）。 */}
              {dest && maxToDest < 1 && <p className="me-note">{t('me.transferSlotsFailedCeiling')}</p>}
              <label className="me-field">
                <span>{t('me.transferSlotsAmount', { max: maxAmount })}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(1, maxAmount)}
                  value={amount}
                  disabled={maxAmount < 1}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
                <button
                  type="button"
                  className="btn-line btn-gold"
                  disabled={busy || !amountOk || maxAmount < 1}
                  onClick={() => void doTransfer()}
                >
                  {busy ? t('common.saving') : t('me.transferSlotsConfirm')}
                </button>
                <button type="button" className="btn-line" onClick={() => setOpen(false)} disabled={busy}>
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
