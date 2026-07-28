'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { submitReport } from '@/lib/engagement'
import AuthShell from '@/components/auth/AuthShell'
import { useT } from '@/components/I18nProvider'

export default function ReportForm({ about }: { about: string }) {
  const t = useT()
  const [aboutInput, setAboutInput] = useState(about)
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  if (!supabase) {
    return (
      <AuthShell title={t('report.title')}>
        <p className="auth-note">{t('report.unavailable')}</p>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title={t('report.thanksTitle')}>
        <p className="auth-note">
          {t('report.thanksBody')}
          <Link href="/terms" style={{ color: 'var(--gold)' }}>terms</Link>.
        </p>
        <p className="auth-links">
          <Link href="/">Back to XIBIT360</Link>
        </p>
      </AuthShell>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim() || busy) return
    setBusy(true)
    try {
      await submitReport(aboutInput, reason, contact)
      setDone(true)
    } catch (err) {
      console.error('report submit failed (is 0010_reports.sql applied?):', err)
      alert(`Could not send the report — please try again later. ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title={t('report.title')}>
      <form onSubmit={(e) => void submit(e)}>
        <label className="auth-field">
          <span>{t('report.whatLabel')}</span>
          <input
            type="text"
            placeholder={t('report.whatPlaceholder')}
            required
            value={aboutInput}
            onChange={(e) => setAboutInput(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>{t('report.whyLabel')}</span>
          <textarea
            className="auth-textarea"
            rows={5}
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>{t('report.contactLabel')}</span>
          <input
            type="text"
            placeholder={t('report.contactPlaceholder')}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </label>
        <button className="auth-submit" disabled={busy || !reason.trim()} type="submit">
          {t('report.send')}
        </button>
      </form>
    </AuthShell>
  )
}
