'use client'
// 通知のベルと一覧（migration 0042、ユーザー指示 2026-08-09）。
//
// 置き場所は /me の上帯（TopActions の中）。ダッシュボードを開けば必ず目に入り、
// **未読があるときだけ数字が出る**。0041 まで、招待に気づく経路はダッシュボードの
// 一番上に受信箱が生えることだけで、いいねや芳名帳には何も無かった。
//
// 文面はここで組む（DBは種類と素材だけを持つ）。理由: 通知は**受け取る人の言語**で
// 読まれるべきで、書いた時点の言語で焼き込むと後から変えられない。お知らせの本文だけは
// 管理者が書いた文章そのものなので訳さない。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { useGallery } from '@/lib/store'
import { BellIcon } from '@/components/icons'
import {
  countUnread,
  deleteNotification,
  listNotifications,
  markAllRead,
  notificationHref,
  type AppNotification,
} from '@/lib/notifications'
import { track } from '@/lib/analytics'

/** 「3日前」程度の粒度。分単位まで出すと通知欄が数字で埋まる。 */
function useRelative() {
  const t = useT()
  return (iso: string) => {
    const then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return ''
    const min = Math.max(0, Math.floor((Date.now() - then) / 60000))
    if (min < 1) return t('notif.justNow')
    if (min < 60) return t('notif.minutesAgo', { n: min })
    const hr = Math.floor(min / 60)
    if (hr < 24) return t('notif.hoursAgo', { n: hr })
    return t('notif.daysAgo', { n: Math.floor(hr / 24) })
  }
}

/**
 * 1件の文面。**種類ごとに別の文を持つ**（1つの汎用文に寄せると、いいねと招待が
 * 同じ顔になって招待が埋もれる — それが 0042 を作った理由そのもの）。
 */
function useLine() {
  const t = useT()
  return (n: AppNotification): { text: string; sub: string } => {
    const who = n.actorName ?? t('notif.someone')
    // 部屋名・作品名が空（消えた・無題）のときに文が崩れないよう既定を当てる。
    const room = n.title || t('common.untitled')
    const work = n.title || t('common.untitled')
    switch (n.kind) {
      case 'invite':
        return { text: t('notif.invite', { who, room }), sub: '' }
      case 'invite_reply':
        return {
          text: n.body === 'declined'
            ? t('notif.declined', { who, room })
            : t('notif.accepted', { who, room }),
          sub: '',
        }
      case 'invite_request':
        // 作家から「参加したい」（0048）。**主催者への通知**なので、行き先は
        // 合同展示タブ（承認はそこでする）。
        return { text: t('notif.inviteRequest', { who, room }), sub: '' }
      case 'invite_approved':
        // その希望が承認された。**作家への通知**。
        return { text: t('notif.inviteApproved', { who, room }), sub: '' }
      case 'submission':
        return { text: t('notif.submission', { who, n: n.count, room }), sub: '' }
      case 'unsubmit':
        // 会期中の展示から作品が下りた（0057）。**主催者への通知**。作品ごと削除された
        // 場合は作家名が引けないので `who` は既定（notif.someone）に落ちる。
        return { text: t('notif.unsubmit', { who, n: n.count, room }), sub: '' }
      case 'room_ready':
        // 参加作家が自分の部屋の準備完了トグルをオンにした（0062）。**主催者への通知**。
        return { text: t('notif.roomReady', { who, room }), sub: '' }
      case 'like':
        // 1件と複数で別の文（数えられる名詞の複数形は言語ごとに違うので、
        // 「1」を差し込んだ文を作らせない）。
        return {
          text: n.count === 1
            ? t('notif.like', { work })
            : t('notif.likes', { n: n.count, work }),
          sub: '',
        }
      case 'guestbook':
        // 本文は来場者が書いた文章なので**訳さずそのまま**出す。
        return { text: t('notif.guestbook', { who, room }), sub: n.body }
      case 'announce':
        // タイトルも本文も管理者が書いたものなので、そのまま出す。
        return { text: n.title, sub: n.body }
    }
  }
}

export default function NotificationBell() {
  const t = useT()
  const user = useGallery((s) => s.user)
  const rel = useRelative()
  const line = useLine()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(async () => {
    if (!user) {
      setUnread(0)
      return
    }
    try {
      setUnread(await countUnread())
    } catch (e) {
      // 0042 未適用のDBでは表が無い。**ベルを消す**（0にする）だけで、/me は落とさない。
      console.error('could not count notifications (is migration 0042 applied?):', e)
      setUnread(0)
    }
  }, [user])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  // 開いたときに一覧を引く。閉じているあいだは数字だけ（行は引かない）。
  useEffect(() => {
    if (!open || !user) return
    let alive = true
    void (async () => {
      try {
        const rows = await listNotifications()
        if (!alive) return
        setItems(rows)
        // 開いた＝読んだ。既読にしてバッジを落とす。**一覧の表示はそのまま**残す
        // （開いた瞬間に未読の目印が全部消えると、何が新しかったのか分からない）。
        if (rows.some((r) => r.readAt === null)) {
          await markAllRead()
          if (alive) setUnread(0)
        }
      } catch (e) {
        console.error('could not load notifications (is migration 0042 applied?):', e)
        if (alive) setItems([])
      }
    })()
    return () => {
      alive = false
    }
  }, [open, user])

  // 外側を押す / Escape で閉じる（TopActions と同じ作り）。
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

  if (!user) return null

  const onDelete = async (id: string) => {
    // 先に画面から消す（待たせない）。失敗したら戻す。
    const before = items
    setItems((cur) => (cur ? cur.filter((n) => n.id !== id) : cur))
    try {
      await deleteNotification(id)
    } catch (e) {
      console.error('could not delete notification:', e)
      setItems(before)
    }
  }

  return (
    <div className="notif-wrap" ref={wrap}>
      <button
        className="btn-line notif-bell"
        /* 件数は**aria-label に入れる**。`aria-label` はボタンの中の文字列（.sr-only を
           含む）を上書きするので、中に忍ばせた件数は読み上げられない
           （別視点レビューが検出 2026-08-09）。 */
        aria-label={unread > 0 ? `${t('notif.title')} — ${t('notif.unread', { n: unread })}` : t('notif.title')}
        aria-expanded={open}
        aria-controls="notif-panel"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) track('notif_open', { unread })
        }}
      >
        <BellIcon />
        {/* 未読が無いときは数字を出さない（0 を出すと常に何かある顔になる）。 */}
        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="notif-panel" className="notif-panel" role="region" aria-label={t('notif.title')}>
          <p className="notif-panel-title">{t('notif.title')}</p>
          {items === null && <p className="me-note notif-empty">{t('notif.loading')}</p>}
          {items !== null && items.length === 0 && (
            <p className="me-note notif-empty">{t('notif.empty')}</p>
          )}
          {items !== null && items.length > 0 && (
            <ul className="notif-list">
              {items.map((n) => {
                const { text, sub } = line(n)
                const href = notificationHref(n)
                return (
                  <li key={n.id} className={`notif-item${n.readAt === null ? ' unread' : ''}`}>
                    <div className="notif-item-body">
                      {href ? (
                        <a className="notif-item-link" href={href} onClick={() => setOpen(false)}>
                          {text}
                        </a>
                      ) : (
                        <span className="notif-item-text">{text}</span>
                      )}
                      {sub && <p className="notif-item-sub">{sub}</p>}
                      <span className="notif-item-when">{rel(n.createdAt)}</span>
                    </div>
                    <button
                      className="notif-item-x"
                      aria-label={t('notif.dismiss')}
                      onClick={() => void onDelete(n.id)}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
