// hakoniwa.app/explore — every public hakoniwa on the platform, newest-edited
// first, so visitors can walk from one artist's room into another's.
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPublicFeed, EXPLORE_PAGE_SIZE } from '@/lib/publish'
import ExploreFeed from '@/components/ExploreFeed'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explore — HAKONIWA',
  description: 'Walk through public hakoniwa from other artists — every exhibition on the platform, one link each.',
}

export default async function ExplorePage() {
  const { items, hasMore } = await fetchPublicFeed(0, EXPLORE_PAGE_SIZE)

  return (
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
          <Link href="/signup" className="btn-line">Start free</Link>
        </div>

        <h1 className="artist-name">Explore</h1>
        <p className="feed-intro">
          Every public hakoniwa on the platform, newest-edited first. Walk in — each room opens in 3D, right in your browser.
        </p>

        <ExploreFeed initialItems={items} initialHasMore={hasMore} />

        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  )
}
