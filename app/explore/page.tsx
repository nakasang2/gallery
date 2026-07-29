// xibit360.art/explore — every public gallery on the platform, newest-edited
// first, so visitors can walk from one artist's room into another's.
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPublicFeed, fetchSpotlightGalleries, EXPLORE_PAGE_SIZE } from '@/lib/publish'
import { fetchSpotlight } from '@/lib/siteConfig'
import ExploreFeed from '@/components/ExploreFeed'
import FeedCard from '@/components/FeedCard'
import { LanguageSwitcher, LegalLink, LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/i18n/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT()
  const title = t('seo.exploreTitle')
  const description = t('seo.exploreDesc')
  return {
    title,
    description,
    openGraph: { title, description },
    alternates: await localeAlternates('/explore'),
  }
}

export default async function ExplorePage() {
  const { t } = await getServerT()
  // The curated spotlight (企画展 / 特集) and the first feed page load together
  const [{ items, hasMore }, spotlight] = await Promise.all([
    fetchPublicFeed(0, EXPLORE_PAGE_SIZE),
    fetchSpotlight(),
  ])
  const spotlightItems =
    spotlight.title && spotlight.items.length > 0 ? await fetchSpotlightGalleries(spotlight.items) : []

  return (
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
          <Link href="/signup" className="btn-line">{t('common.startFree')}</Link>
        </div>

        <h1 className="artist-name">{t('explore.title')}</h1>
        <p className="feed-intro">
          {t('explore.intro')}
        </p>

        {spotlightItems.length > 0 && (
          <section className="spotlight" aria-label={spotlight.title}>
            <div className="spotlight-head">
              <h2 className="spotlight-title">{spotlight.title}</h2>
              {spotlight.subtitle && <p className="spotlight-sub">{spotlight.subtitle}</p>}
            </div>
            <div className="artist-galleries spotlight-grid">
              {spotlightItems.map((g) => (
                <FeedCard key={`sp-${g.username}/${g.slug}`} g={g} />
              ))}
            </div>
            <p className="spotlight-divider" aria-hidden="true">{t('artwork.allExhibitions')}</p>
          </section>
        )}

        <ExploreFeed initialItems={items} initialHasMore={hasMore} />

        <footer className="artist-footer">
          <LanguageSwitcher />
          <LocaleLink href="/articles">{t('footer.guides')}</LocaleLink>
          <Link href="/terms">{t('footer.terms')}</Link>
          <LegalLink />
          <Link href="/privacy">{t('footer.privacy')}</Link>
        </footer>
      </div>
    </main>
  )
}
