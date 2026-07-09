'use client'
// Create an account with email + password (confirmation email flow)
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthShell from '@/components/auth/AuthShell'

const MIN_PASSWORD = 8

export default function SignUpPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  if (!supabase) {
    return (
      <AuthShell title="Create an account">
        <p className="auth-note">Cloud features are not configured (Supabase keys required in .env.local).</p>
      </AuthShell>
    )
  }

  async function signUp(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
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
      setError(error.message)
      return
    }
    // With email confirmation disabled the session opens immediately; otherwise a
    // confirmation email is on its way
    if (data.session) router.push('/me')
    else setSent(true)
  }

  async function resend() {
    if (busy) return
    setBusy(true)
    const { error } = await supabase!.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) setError(error.message)
    else setError('')
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox">
        <p className="auth-note">
          We sent a confirmation link to <b>{email.trim()}</b>. Open it and you&apos;ll land in your
          dashboard, signed in.
        </p>
        <div className="auth-alt">
          <button className="btn-line" disabled={busy} onClick={() => void resend()}>
            Resend the email
          </button>
        </div>
        {error && <p className="auth-error">{error}</p>}
        <p className="auth-links">
          <Link href="/signin">Back to sign in</Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create an account">
      <form onSubmit={(e) => void signUp(e)}>
        <label className="auth-field">
          <span>Display name (optional)</span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shown as the artist name"
          />
        </label>
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
          <span>Password (min {MIN_PASSWORD} characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" disabled={busy} type="submit">
          Create account
        </button>
      </form>
      <p className="auth-links">
        <Link href="/signin">Already have an account? Sign in</Link>
      </p>
    </AuthShell>
  )
}
