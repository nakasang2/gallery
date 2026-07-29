'use client'
// Password reset. Two modes on one page:
// - request: enter your email → Supabase sends a recovery link (redirects back here)
// - update:  arriving from that link (or already signed in) → set a new password
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AuthShell from '@/components/auth/AuthShell'
import { TextWithSlot, useT } from '@/components/I18nProvider'

const MIN_PASSWORD = 8

export default function ResetPage() {
  const t = useT()
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
      <AuthShell title={t('auth.resetTitle')}>
        <p className="auth-note">{t('auth.notConfigured')}</p>
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
      // 同じ文のキーが既にある（辞書を通っていない写しだった）
      setError(t('auth.passwordTooShort', { min: MIN_PASSWORD }))
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
      <AuthShell title={t('auth.updatedTitle')}>
        <p className="auth-note">{t('auth.updatedBody')}</p>
        <p className="auth-links">
          <Link href="/me">{t('auth.goToDashboard')}</Link>
        </p>
      </AuthShell>
    )
  }

  if (mode === 'update') {
    return (
      <AuthShell title={t('auth.setNewTitle')}>
        <form onSubmit={(e) => void updatePassword(e)}>
          <label className="auth-field">
            <span>{t('auth.newPasswordLabel', { min: MIN_PASSWORD })}</span>
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
            {t('auth.updatePassword')}
          </button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('auth.resetTitle')}>
      {sent ? (
        <p className="auth-note">
          {/* 文はひとつのキー。太字にするアドレスの位置は訳文が決める（TextWithSlot） */}
          <TextWithSlot text={t('auth.resetSent')} slot="email">
            <b>{email.trim()}</b>
          </TextWithSlot>
        </p>
      ) : (
        <form onSubmit={(e) => void requestLink(e)}>
          <label className="auth-field">
            <span>{t('auth.email')}</span>
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
            {t('auth.resetSend')}
          </button>
        </form>
      )}
      <p className="auth-links">
        <Link href="/signin">{t('auth.backToSignIn')}</Link>
      </p>
    </AuthShell>
  )
}
