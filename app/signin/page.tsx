'use client'
// Sign in: email + password, plus the existing magic link / Google options
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthShell from '@/components/auth/AuthShell'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  if (!supabase) {
    return (
      <AuthShell title="Sign in">
        <p className="auth-note">Cloud features are not configured (Supabase keys required in .env.local).</p>
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
      setNeedsConfirm(/confirm/i.test(error.message))
      setError(error.message)
      return
    }
    router.push('/me')
  }

  async function resendConfirmation() {
    if (!email.trim() || busy) return
    setBusy(true)
    const { error } = await supabase!.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) setError(error.message)
    else setConfirmSent(true)
  }

  async function magicLink() {
    if (!email.trim()) {
      setError('Enter your email address first, then request the link.')
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
    if (error) setError(error.message)
    else setLinkSent(true)
  }

  async function google() {
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/me` },
    })
    if (error) setError(error.message)
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={(e) => void signIn(e)}>
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
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        {needsConfirm && !confirmSent && (
          <button type="button" className="btn-line" disabled={busy} onClick={() => void resendConfirmation()}>
            Resend confirmation email
          </button>
        )}
        {confirmSent && <p className="auth-note">Confirmation email resent — check your inbox.</p>}
        <button className="auth-submit" disabled={busy} type="submit">
          Sign in
        </button>
      </form>
      <div className="auth-alt">
        <button className="btn-line" disabled={busy} onClick={() => void magicLink()}>
          Email me a sign-in link instead
        </button>
        <button className="btn-line" onClick={() => void google()}>
          Continue with Google
        </button>
        {linkSent && <p className="auth-note">Sign-in link sent — check your inbox.</p>}
      </div>
      <p className="auth-links">
        <Link href="/reset">Forgot password?</Link>
        <Link href="/signup">Create an account</Link>
      </p>
    </AuthShell>
  )
}
