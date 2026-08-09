'use client'
// 全員へのお知らせ（migration 0042、ユーザー指示 2026-08-09「新テーマ追加のお知らせ」）。
//
// 書いた文章は**訳さずそのまま**全員に届く。記事（ArticlesEditor）と同じ扱いで、
// これはUI文言ではなく「中身」だから。訳したいときは本文に両方書く。
//
// **取り消せない**。配った行を回収する経路は作っていない（一度読まれた通知を後から
// 消しても意味が無く、回収経路は「全員の通知を消せるRPC」になって危ない）。なので
// 送信は必ず確認を挟む。
import { useState } from 'react'
import { broadcastAnnouncement } from '@/lib/notifications'
import { useT } from '@/components/I18nProvider'

export default function AnnounceEditor() {
  const t = useT()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  /** 確認待ちかどうか。押した瞬間には送らない。 */
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const send = async () => {
    setBusy(true)
    setErr('')
    try {
      const n = await broadcastAnnouncement(title.trim(), body.trim())
      setSentTo(n)
      setTitle('')
      setBody('')
      setConfirming(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const ready = title.trim().length > 0

  return (
    <section className="me-section">
      <h2>{t('adminUi.announce')}</h2>
      <p className="me-note" style={{ marginTop: 0 }}>{t('adminUi.announceNote')}</p>

      <label className="me-field">
        <span>{t('adminUi.announceTitle')}</span>
        <input
          value={title}
          placeholder={t('adminUi.announceTitlePlaceholder')}
          maxLength={120}
          onChange={(e) => {
            setTitle(e.target.value)
            // 文面を変えたら確認をやり直す（確認したものと送るものを一致させる）。
            setConfirming(false)
            setSentTo(null)
          }}
        />
      </label>
      <label className="me-field">
        <span>{t('adminUi.announceBody')}</span>
        <textarea
          value={body}
          rows={4}
          placeholder={t('adminUi.announceBodyPlaceholder')}
          maxLength={600}
          onChange={(e) => {
            setBody(e.target.value)
            setConfirming(false)
            setSentTo(null)
          }}
        />
      </label>

      <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
        {!confirming && (
          <button className="btn-line btn-gold" onClick={() => setConfirming(true)} disabled={!ready}>
            {t('adminUi.announceSend')}
          </button>
        )}
        {confirming && (
          <>
            <button className="btn-line btn-gold" onClick={() => void send()} disabled={busy}>
              {busy ? t('adminUi.announceSending') : t('adminUi.announceConfirmYes')}
            </button>
            <button className="btn-line" onClick={() => setConfirming(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
          </>
        )}
      </div>

      {confirming && <p className="me-note">{t('adminUi.announceConfirm')}</p>}
      {sentTo !== null && <p className="me-note">{t('adminUi.announceSent', { n: sentTo })}</p>}
      {err && <p className="me-error">{err}</p>}
    </section>
  )
}
