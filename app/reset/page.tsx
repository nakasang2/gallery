'use client'
// Password reset. Two modes on one page:
// - request: enter your email → Supabase sends a recovery link (redirects back here)
// - update:  arriving from that link (or already signed in) → set a new password
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AuthShell from '@/components/auth/AuthShell'

const MIN_PASSWORD = 8

export default function ResetPage() {
  const [mode, setMode] = useState<'request' | 'update'>('request')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [updated, setUpdated] = useState(false)

  // The recovery link signs the user in on arrival; a session here means "set a new password"
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setMode('update')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setMode('update')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!supabase) {
    return (
      <AuthShell title="Reset password">
        <p className="auth-note">Cloud features are not configured (Supabase keys required in .env.local).</p>
      </AuthShell>
    )
  }

  async function requestLink(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/reset`,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  async function updatePassword(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else setUpdated(true)
  }

  if (updated) {
    return (
      <AuthShell title="Password updated">
        <p className="auth-note">Your new password is set. You are signed in.</p>
        <p className="auth-links">
          <Link href="/me">Go to your dashboard</Link>
        </p>
      </AuthShell>
    )
  }

  if (mode === 'update') {
    return (
      <AuthShell title="Set a new password">
        <form onSubmit={(e) => void updatePassword(e)}>
          <label className="auth-field">
            <span>New password (min {MIN_PASSWORD} characters)</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" disabled={busy} type="submit">
            Update password
          </button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset password">
      {sent ? (
        <p className="auth-note">
          If an account exists for <b>{email.trim()}</b>, a reset link is on its way. Open it and
          you will land back here to set a new password.
        </p>
      ) : (
        <form onSubmit={(e) => void requestLink(e)}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" disabled={busy} type="submit">
            Send reset link
          </button>
        </form>
      )}
      <p className="auth-links">
        <Link href="/signin">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
