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
// いいのでは」という指摘）。
//
// **部屋の行き来はここではしない**（ユーザー選択A 2026-08-14）。通常展示の部屋と
// 合同展示の部屋は**部屋タブの列**（`.me-rooms`）で切り替える。ここに残るのは
// 「いまどの部屋に居るか」の表示と、**主催者だけ**の「この部屋を展示から外す」。
// 参加作家に出していた「通常展示に戻す」は撤去した ── 名前は表示の切り替えに
// 見えるのに実際には展示から抜ける操作で、本番で1人が押して展示から消え、
// 招待が `accepted` のままなので復帰できなくなった（DECISIONS 2026-08-14）。
// **守っているのはDB側**（migration 0063 が主催者以外のこの操作を拒否する）で、
// ここで出さないのは説明のため。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import type { GalleryRow } from '@/lib/galleries'
import { listMyExpos, roomExpoSwitchErrorKey, switchRoomExpo, type Expo } from '@/lib/expos'
import { track } from '@/lib/analytics'
import { SwitchIcon } from '@/components/icons'
import { useGallery } from '@/lib/store'

export default function RoomExpoBadge({
  room,
  userId,
  onOpenExpoManager,
  onChanged,
}: {
  room: GalleryRow
  /** サインインしている人。**この部屋の持ち主とは限らない** — 主催者が参加作家の
   *  部屋を開いていることがある（migration 0062 の `galleries_select_expo_owner`）。 */
  userId: string
  onOpenExpoManager: () => void
  onChanged: () => void
}) {
  const t = useT()
  const refreshCloudArtworks = useGallery((s) => s.refreshCloudArtworks)
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

  // `listMyExpos(userId)` は**自分が主催している展示**しか返さないので、ここに
  // 見つかるかどうかがそのまま「自分がこの展示の主催者か」になる。参加作家として
  // 招かれている展示は返らない（＝`currentExpo` は undefined）。
  const currentExpo = room.expo_id ? expos?.find((x) => x.id === room.expo_id) : undefined
  const isOrganizer = !!currentExpo
  const label = room.expo_id
    ? t('expo.roomModeJoint', { title: currentExpo?.title || t('common.untitled') })
    : t('expo.roomModeNormal')

  /**
   * この部屋を展示から外す。**「通常展示に戻す」という名前をやめた**
   * （ユーザー決定 2026-08-14）── 名前は表示の切り替えに見えるのに、実際には部屋を
   * 展示から抜く操作で、本番で参加作家が1人これを押して**展示から消えた**。
   *
   * **主催者にしか出さない。** 主催者は `ExpoManager` の「部屋を追加」で作り直せるが、
   * 参加作家は招待が `accepted` のままなので 0062 のトリガが再発火せず、**復帰する
   * 導線が1つも無い**。参加作家が降りる道は受信箱の「降りる」（＝辞退）に一本化した。
   * DB側（migration 0063）も主催者以外からのこの操作を拒否する ── ここで隠すのは
   * 説明のためで、守っているのはDBの方（DECISIONS【絶対ルール】2026-08-12）。
   */
  async function leaveExpo() {
    setBusy(true)
    setErr('')
    try {
      await switchRoomExpo(room.id, null)
      track('room_expo_switch', { to: 'normal' })
      setOpen(false)
      // 専用プールに未配置のまま残っていた作品は、DB側（switch_room_expo・0061）が
      // 共有プールへ解放している。**共有ライブラリのキャッシュ（cloudArtworks）は
      // 認証時に一度読むだけ**なので、明示的に読み直さないと解放された作品が
      // 「作品」タブに現れない（ページ再読み込みまで見えない、という食い違いを防ぐ）。
      void refreshCloudArtworks()
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
              {/* 部屋の行き来は**部屋タブ**でする（ユーザー選択A 2026-08-14）ので、
                  ここには行き先を並べない。残るのは主催者だけの「展示から外す」。 */}
              {isOrganizer ? (
                <button type="button" className="btn-line" disabled={busy} onClick={() => void leaveExpo()}>
                  {t('expo.roomLeaveExpo')}
                </button>
              ) : (
                <p className="me-note" style={{ marginTop: 0 }}>{t('expo.roomLeaveHint')}</p>
              )}
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
