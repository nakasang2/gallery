'use client'
// Admin console (migration 0017): total revenue, packages every user owns, and
// every exhibition space. Access is gated by admin-only RLS — a non-admin session
// reads nothing, so the checks here are UX, not the security boundary.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { useIsAdmin, fetchAdminOverview, type AdminOverview } from '@/lib/admin'
import AdminDashboard from '@/components/AdminDashboard'
import LpHeroEditor from '@/components/LpHeroEditor'
import AuthShell from '@/components/auth/AuthShell'

export default function AdminPage() {
  const user = useGallery((s) => s.user)
  const initAuth = useGallery((s) => s.initAuth)
  const signOut = useGallery((s) => s.signOut)
  const isAdmin = useIsAdmin(user?.id ?? null)

  const [checked, setChecked] = useState(false)
  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    initAuth()
    supabase?.auth.getSession().then(() => setChecked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      setData(await fetchAdminOverview())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  if (!supabase) {
    return (
      <AuthShell title="Admin">
        <p className="auth-note">Cloud features are not configured (Supabase keys required in .env.local).</p>
      </AuthShell>
    )
  }

  // Signed out, or signed in but not an admin — never hint at what's behind the wall
  if (checked && !isAdmin) {
    return (
      <AuthShell title="Admin">
        {user ? (
          <p className="auth-note">This account doesn&apos;t have admin access.</p>
        ) : (
          <p className="auth-note">Sign in with an admin account to continue.</p>
        )}
        <p className="auth-links">
          {!user && <Link href="/signin">Sign in</Link>}
          <Link href="/">Back to HAKONIWA</Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <main className="me-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
          <div className="me-top-actions">
            <Link className="btn-line" href="/me">Dashboard</Link>
            <button className="btn-line" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn-line" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>

        <div className="me-hero">
          <div className="me-hero-avatar empty">★</div>
          <div>
            <div className="me-hero-greet">Admin console</div>
            <p className="me-hero-sub">Platform-wide view — revenue, packages, and every exhibition.</p>
          </div>
        </div>

        {err && <p className="me-error">{err}</p>}
        {!data && !err && <p className="me-note">Loading…</p>}

        {data && <AdminDashboard data={data} />}

        {isAdmin && <LpHeroEditor />}

        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  )
}
