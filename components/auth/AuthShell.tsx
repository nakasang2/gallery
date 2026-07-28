'use client'
// Shared frame for the auth pages (/signin /signup /reset)
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useT } from '@/components/I18nProvider'

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const t = useT()
  return (
    <main className="auth-page">
      <Link href="/" className="auth-logo">XIBIT360</Link>
      <section className="auth-card">
        <h1 className="auth-title">{title}</h1>
        {children}
      </section>
      <p className="auth-legal">
        <Link href="/terms">{t('footer.terms')}</Link> · <Link href="/privacy">{t('footer.privacy')}</Link> · <Link href="/legal">{t('footer.legal')}</Link>
      </p>
    </main>
  )
}
