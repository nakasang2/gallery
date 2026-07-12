// hakoniwa.app/explore — every public hakoniwa on the platform, newest-edited
// first, so visitors can walk from one artist's room into another's.
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPublicFeed, isPlaceholderTitle } from '@/lib/publish'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explore — HAKONIWA',
  description: 'Walk through public hakoniwa from other artists — every exhibition on the platform, one link each.',
}

export default async function ExplorePage() {
  const feed = await fetchPublicFeed()

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

        {feed.length === 0 ? (
          <p className="feed-empty">No public exhibitions yet — be the first.</p>
        ) : (
          <div className="artist-galleries">
            {feed.map((g) => (
              <Link key={`${g.username}/${g.slug}`} className="artist-gallery-card" href={`/@${g.username}/${g.slug}`}>
                {g.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.cover} alt="" className="artist-cover" />
                ) : (
                  <div className="artist-cover artist-cover-empty" />
                )}
                <div className="feed-card-artist">
                  {g.ownerAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="feed-card-avatar" src={g.ownerAvatar} alt="" />
                  ) : (
                    <div className="feed-card-avatar empty">{(g.ownerName || '•').slice(0, 1).toUpperCase()}</div>
                  )}
                  <span className="feed-card-artist-name">{g.ownerName}</span>
                </div>
                <div className="artist-gallery-meta">
                  <span className="artist-gallery-title">
                    {isPlaceholderTitle(g.title) ? g.ownerName : g.title}
                  </span>
                  <span className="artist-gallery-sub">
                    {g.workCount} work{g.workCount === 1 ? '' : 's'} · walk through in 3D →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  )
}
