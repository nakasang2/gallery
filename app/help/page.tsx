// /help — the public help & FAQ page (docs/DECISIONS 2026-08-03). Unlike the
// three legal pages, this is genuinely translated, so it lives on a locale-
// prefixed URL like /explore and carries the full hreflang set. Server-rendered
// so the questions and answers are in the HTML a crawler reads, and so anyone —
// not only signed-in artists — can reach it. The dashboard opens the same body in
// a modal (components/HelpModal) from one shared component.
import type { Metadata } from 'next'
import Link from 'next/link'
import HelpContent from '@/components/HelpContent'
import { LanguageSwitcher, LegalLink, LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/i18n/metadata'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT()
  const title = `${t('help.title')} — Xibit360` // i18n-ok: ブランド名
  const description = t('help.intro')
  return {
    title,
    description,
    openGraph: { title, description },
    alternates: await localeAlternates('/help'),
  }
}

export default async function HelpPage() {
  const { t } = await getServerT()
  return (
    <main className="help-page">
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
          <Link href="/signup" className="btn-line">{t('common.startFree')}</Link>
        </div>

        <h1 className="me-h1">{t('help.title')}</h1>
        <p className="help-intro">{t('help.intro')}</p>

        <HelpContent t={t} />

        <footer className="artist-footer">
          <LanguageSwitcher />
          <LocaleLink href="/">{t('footer.home')}</LocaleLink>
          <LocaleLink href="/explore">{t('footer.explore')}</LocaleLink>
          <LocaleLink href="/articles">{t('footer.guides')}</LocaleLink>
          <Link href="/terms">{t('footer.terms')}</Link>
          <LegalLink />
          <Link href="/privacy">{t('footer.privacy')}</Link>
        </footer>
      </div>
    </main>
  )
}
