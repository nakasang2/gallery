'use client'
// 部屋の「通常展示⇄合同展示」バッジ（migration 0050、ユーザー指示 2026-08-10）。
//
// Hero の右上（旧: `.me-top` の文字ボタン列にあった「合同展示」ナビ）に置く。
// いま編集している部屋がどちらの種類かを常に見せる（合同展示なら展示名も）── これが
// 一番のねらい。
//
// 合同展示の**作成**は常にExpoManagerからの新規作成（展示＋最初の部屋を自動生成）に
// 一本化した（DECISIONS 2026-08-12）。以前はここに「既存の空部屋を、選んだ展示に
// 参加させる」変換リストもあり、ExpoManagerでの新規作成と2つの入口が並んでいたのが
// ユーザーには分かりにくかった（「合同展示を作ったら、そこで0から設定できる方が
// いいのでは」という指摘）。
//
// **ここが通常展示⇄合同展示のモード切替**（ユーザー指示 2026-08-14）。同日に一度
// 「部屋タブに合同展示の部屋も並べて行き来する」形にしたが、**合同展示は「もう1つの
// 部屋」ではなく別のモード**なので同列に並ぶと違和感が出る、という指摘で撤回した。
// 部屋タブは通常展示の部屋どうしの切替に戻し、モードの行き来はここが担う。
// 「合同展示」を押すと `ExpoManager` のウィンドウが開き、**主催しているものも招かれた
// ものも1つの一覧**に並ぶ（合同展示は数がいくつでもありうるので、行き先の一覧は
// ここではなくウィンドウが持つ）。合同展示は1展示1部屋なので、選んだ先に部屋タブは無い。
//
// **「この部屋を展示から外す」は完全に撤去した**（ユーザー選択 2026-08-14）。
// 元は「通常展示に戻す」という名前で参加作家にも出ていて、押した作家が展示から消えた
// （本番で1件発生。招待が `accepted` のままなので復帰不能）。いったん主催者だけに絞って
// 改名したが、**主催者にとっても意味が通らない**ため消した ── 合同展示は1展示1部屋なので
// 自分の部屋を外すと主催者の居場所が無くなり、下書きをやめたいなら `ExpoManager` の
// 「捨てる」が正しい道で、このボタンが唯一の解決策になる場面が無い。
// **DB側の番人（migration 0063）は残す** ── 別の入口ができても参加作家は抜けられない。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import type { GalleryRow } from '@/lib/galleries'
import { listMyExpos, type Expo } from '@/lib/expos'
import { SwitchIcon } from '@/components/icons'

export default function RoomExpoBadge({
  room,
  userId,
  onOpenNormal,
  onOpenExpoManager,
}: {
  room: GalleryRow
  /** サインインしている人。**この部屋の持ち主とは限らない** — 主催者が参加作家の
   *  部屋を開いていることがある（migration 0062 の `galleries_select_expo_owner`）。 */
  userId: string
  /** 通常展示へ戻る（玄関の部屋を開く）。合同展示の部屋に居るときだけ押せる。
   *  **通常展示の部屋が1室も無ければ `null`** ── 呼び手が「戻る先が無い」と判断した
   *  合図で、そのときはボタンを押せなくして理由を出す（押せるのに何も起きない、を作らない）。 */
  onOpenNormal: (() => void) | null
  onOpenExpoManager: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // null = 未取得。合同展示の部屋なら展示名を出すため常時（開いていなくても）取りに行く。
  const [expos, setExpos] = useState<Expo[] | null>(null)
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
  const label = room.expo_id
    ? t('expo.roomModeJoint', { title: currentExpo?.title || t('common.untitled') })
    : t('expo.roomModeNormal')

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
          {/* **ここが通常展示⇄合同展示のモード切替**（ユーザー指示 2026-08-14）。
              部屋タブは通常展示の部屋どうしの切替に戻したので、モードの行き来は
              この2つの選択肢だけがここにある。合同展示は数がいくつでもありうる
              （主催しているもの＋招かれたもの）ので、行き先の一覧は下のウィンドウが持つ。 */}
          <p className="room-expo-panel-title">{t('expo.roomModeHeading')}</p>
          <div className="room-expo-modes">
            <button
              type="button"
              className={`btn-line${room.expo_id ? '' : ' active'}`}
              aria-current={room.expo_id ? undefined : 'true'}
              disabled={!room.expo_id || !onOpenNormal}
              title={onOpenNormal ? undefined : t('expo.roomModeNoNormal')}
              onClick={() => {
                setOpen(false)
                onOpenNormal?.()
              }}
            >
              {t('expo.roomModeNormal')}
            </button>
            <button
              type="button"
              className={`btn-line${room.expo_id ? ' active' : ''}`}
              aria-current={room.expo_id ? 'true' : undefined}
              onClick={() => {
                setOpen(false)
                onOpenExpoManager()
              }}
            >
              {t('expo.tab')} →
            </button>
          </div>
          {/* 戻る先が無いときは、押せない理由を言葉で出す（薄いだけでは伝わらない）。 */}
          {room.expo_id && !onOpenNormal && (
            <p className="me-note" style={{ marginTop: 0 }}>{t('expo.roomModeNoNormal')}</p>
          )}
          {room.expo_id && (
            <p className="me-note" style={{ marginTop: '0.6rem' }}>
              {t('expo.roomSwitchCurrentHeading', { title: currentExpo?.title || t('common.untitled') })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
