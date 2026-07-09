'use client'
// Shared frame for the auth pages (/signin /signup /reset)
import Link from 'next/link'
import type { ReactNode } from 'react'

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <Link href="/" className="auth-logo">HAKONIWA</Link>
      <section className="auth-card">
        <h1 className="auth-title">{title}</h1>
        {children}
      </section>
      <p className="auth-legal">
        <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
      </p>
    </main>
  )
}
