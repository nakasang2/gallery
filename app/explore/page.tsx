// xibit360.art/explore — every public gallery on the platform, newest-edited
// first, so visitors can walk from one artist's room into another's.
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPublicFeed, fetchSpotlightGalleries, EXPLORE_PAGE_SIZE } from '@/lib/publish'
import { fetchSpotlight } from '@/lib/siteConfig'
import ExploreFeed from '@/components/ExploreFeed'
import FeedCard from '@/components/FeedCard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explore — Xibit360',
  description: 'Walk through public galleries from other artists — every exhibition on the platform, one link each.',
}

export default async function ExplorePage() {
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
          <Link href="/" className="auth-logo">XIBIT360</Link>
          <Link href="/signup" className="btn-line">Start free</Link>
        </div>

        <h1 className="artist-name">Explore</h1>
        <p className="feed-intro">
          Every public gallery on the platform, newest-edited first. Walk in — each room opens in 3D, right in your browser.
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
            <p className="spotlight-divider" aria-hidden="true">All exhibitions</p>
          </section>
        )}

        <ExploreFeed initialItems={items} initialHasMore={hasMore} />

        <footer className="artist-footer">
          <Link href="/articles">Guides</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  )
}
