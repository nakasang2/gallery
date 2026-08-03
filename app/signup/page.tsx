'use client'
// Create an account with email + password (confirmation email flow)
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthShell from '@/components/auth/AuthShell'
import PasswordField from '@/components/auth/PasswordField'
import GoogleButton from '@/components/auth/GoogleButton'
import { useCooldown } from '@/components/auth/useCooldown'
import { authErrorKey } from '@/lib/authErrors'
import { TextWithSlot, useT } from '@/components/I18nProvider'

const MIN_PASSWORD = 8
const RESEND_COOLDOWN = 30

export default function SignUpPage() {
  const t = useT()
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldown, startCooldown] = useCooldown()
  // Accepting the terms is part of creating the account, not something buried in
  // a footer link: this is where the contract is formed, and paid upgrades hang
  // off it. Gates the Google button too — that path skips the form entirely.
  const [agreed, setAgreed] = useState(false)

  if (!supabase) {
    return (
      <AuthShell title={t('auth.createAccount')}>
        <p className="auth-note">{t('auth.notConfigured')}</p>
      </AuthShell>
    )
  }

  async function signUp(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!agreed) {
      setError(t('auth.consentRequired'))
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(t('auth.passwordTooShort', { min: MIN_PASSWORD }))
      return
    }
    if (password !== confirm) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setBusy(true)
    setError('')
    const { data, error } = await supabase!.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: name.trim() ? { name: name.trim() } : undefined,
        emailRedirectTo: `${location.origin}/me`,
      },
    })
    setBusy(false)
    if (error) {
      setError(t(authErrorKey(error.message)))
      return
    }
    // With email confirmation disabled the session opens immediately; otherwise a
    // confirmation email is on its way
    if (data.session) router.push('/me')
    else {
      setSent(true)
      startCooldown(RESEND_COOLDOWN)
    }
  }

  async function resend() {
    if (busy || cooldown > 0) return
    setBusy(true)
    const { error } = await supabase!.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) setError(t(authErrorKey(error.message)))
    else {
      setError('')
      startCooldown(RESEND_COOLDOWN)
    }
  }

  if (sent) {
    return (
      <AuthShell title={t('auth.checkInbox')}>
        <p className="auth-note">
          {/* 文はひとつのキー。太字にするアドレスの位置は訳文が決める（TextWithSlot） */}
          <TextWithSlot text={t('auth.confirmSent')} slot="email">
            <b>{email.trim()}</b>
          </TextWithSlot>
        </p>
        <div className="auth-alt">
          <button className="btn-line" disabled={busy || cooldown > 0} onClick={() => void resend()}>
            {cooldown > 0 ? t('auth.retryIn', { sec: cooldown }) : t('auth.resend')}
          </button>
        </div>
        {error && <p className="auth-error">{error}</p>}
        <p className="auth-links">
          <Link href="/signin">{t('auth.backToSignIn')}</Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('auth.createAccount')}>
      <form onSubmit={(e) => void signUp(e)}>
        <label className="auth-field">
          <span>{t('auth.displayName')}</span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('auth.displayNameHint')}
          />
        </label>
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
        <PasswordField
          label={t('auth.password', { min: MIN_PASSWORD })}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          showStrength
        />
        <PasswordField
          label={t('auth.confirmPassword')}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />
        {/* Not a <button>: a labelable element inside <label> would steal the
            label from the checkbox (LESSONS 2026-07-21) — links are fine. */}
        <label className="auth-consent">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            aria-describedby="consent-text"
          />
          <span id="consent-text">
            {t('auth.consent')}
          </span>
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" disabled={busy || !agreed} type="submit">
          {t('me.createAccount')}
        </button>
      </form>
      <div className="auth-alt">
        <GoogleButton
          disabled={!agreed}
          onClick={() => {
            if (!agreed) return
            void supabase!.auth
              .signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/me` } })
              .then(({ error }) => error && setError(t(authErrorKey(error.message))))
          }}
        />
      </div>
      <p className="auth-links">
        <Link href="/signin">{t('auth.haveAccount')}</Link>
      </p>
    </AuthShell>
  )
}
