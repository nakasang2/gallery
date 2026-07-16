'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { submitReport } from '@/lib/engagement'
import AuthShell from '@/components/auth/AuthShell'

export default function ReportForm({ about }: { about: string }) {
  const [aboutInput, setAboutInput] = useState(about)
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  if (!supabase) {
    return (
      <AuthShell title="Report a problem">
        <p className="auth-note">Reporting is not available (Supabase is not configured).</p>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Thank you">
        <p className="auth-note">
          Your report has been received. We review reports and take down content that violates the{' '}
          <Link href="/terms" style={{ color: 'var(--gold)' }}>terms</Link>.
        </p>
        <p className="auth-links">
          <Link href="/">Back to HAKONIWA</Link>
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
    <AuthShell title="Report a problem">
      <form onSubmit={(e) => void submit(e)}>
        <label className="auth-field">
          <span>What are you reporting?</span>
          <input
            type="text"
            placeholder="@username/gallery or a URL"
            required
            value={aboutInput}
            onChange={(e) => setAboutInput(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Why? (copyright, harassment, illegal content…)</span>
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
          <span>Your contact (optional, for follow-up)</span>
          <input
            type="text"
            placeholder="email or handle"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </label>
        <button className="auth-submit" disabled={busy || !reason.trim()} type="submit">
          Send report
        </button>
      </form>
    </AuthShell>
  )
}
