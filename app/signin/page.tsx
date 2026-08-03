'use client'
// Sign in: email + password, plus the existing magic link / Google options
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthShell from '@/components/auth/AuthShell'
import PasswordField from '@/components/auth/PasswordField'
import { useCooldown } from '@/components/auth/useCooldown'
import { authErrorKey, isEmailNotConfirmed } from '@/lib/authErrors'
import { useT } from '@/components/I18nProvider'

const RESEND_COOLDOWN = 30

export default function SignInPage() {
  const t = useT()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [cooldown, startCooldown] = useCooldown()

  if (!supabase) {
    return (
      <AuthShell title={t('auth.signIn')}>
        <p className="auth-note">{t('auth.notConfigured')}</p>
      </AuthShell>
    )
  }

  async function signIn(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      // "Email not confirmed" is a dead end without a resend path
      setNeedsConfirm(isEmailNotConfirmed(error.message))
      setError(t(authErrorKey(error.message)))
      return
    }
    router.push('/me')
  }

  async function resendConfirmation() {
    if (!email.trim() || busy || cooldown > 0) return
    setBusy(true)
    const { error } = await supabase!.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) setError(t(authErrorKey(error.message)))
    else {
      setConfirmSent(true)
      startCooldown(RESEND_COOLDOWN)
    }
  }

  async function magicLink() {
    if (busy || cooldown > 0) return
    if (!email.trim()) {
      setError(t('auth.magicNeedsEmail'))
      return
    }
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      // Sign-IN page: never silently mint a new account for a typo'd email
      options: { emailRedirectTo: `${location.origin}/me`, shouldCreateUser: false },
    })
    setBusy(false)
    if (error) setError(t(authErrorKey(error.message)))
    else {
      setLinkSent(true)
      startCooldown(RESEND_COOLDOWN)
    }
  }

  async function google() {
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/me` },
    })
    if (error) setError(t(authErrorKey(error.message)))
  }

  return (
    <AuthShell title={t('auth.signIn')}>
      <form onSubmit={(e) => void signIn(e)}>
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
          label={t('auth.password2')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        {error && <p className="auth-error">{error}</p>}
        {needsConfirm && !confirmSent && (
          <button
            type="button"
            className="btn-line"
            disabled={busy || cooldown > 0}
            onClick={() => void resendConfirmation()}
          >
            {cooldown > 0 ? t('auth.retryIn', { sec: cooldown }) : t('auth.resendConfirm')}
          </button>
        )}
        {confirmSent && <p className="auth-note">{t('auth.confirmResent')}</p>}
        <button className="auth-submit" disabled={busy} type="submit">
          {t('auth.signIn')}
        </button>
      </form>
      <div className="auth-alt">
        <button
          className="btn-line"
          disabled={busy || cooldown > 0}
          onClick={() => void magicLink()}
        >
          {cooldown > 0 && linkSent ? t('auth.retryIn', { sec: cooldown }) : t('auth.magicLink')}
        </button>
        <button className="btn-line" onClick={() => void google()}>
          {t('auth.continueWithGoogle')}
        </button>
        {linkSent && <p className="auth-note">{t('auth.magicSent')}</p>}
      </div>
      <p className="auth-links">
        <Link href="/reset">{t('auth.forgotPassword')}</Link>
        <Link href="/signup">{t('auth.createAnAccount')}</Link>
      </p>
    </AuthShell>
  )
}
