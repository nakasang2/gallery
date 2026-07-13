'use client'
// The /explore grid + "Load more" — the initial page is server-rendered (SEO,
// fast first paint); everything past that is fetched client-side straight
// through the same anon-key Supabase client the dashboard already uses.
import { useState } from 'react'
import Link from 'next/link'
import { fetchPublicFeed, isPlaceholderTitle, EXPLORE_PAGE_SIZE, type FeedItem } from '@/lib/publish'

export default function ExploreFeed({
  initialItems,
  initialHasMore,
}: {
  initialItems: FeedItem[]
  initialHasMore: boolean
}) {
  const [items, setItems] = useState(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)

  async function loadMore() {
    if (loading) return
    setLoading(true)
    try {
      const page = await fetchPublicFeed(items.length, EXPLORE_PAGE_SIZE)
      setItems((prev) => [...prev, ...page.items])
      setHasMore(page.hasMore)
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    return <p className="feed-empty">No public exhibitions yet — be the first.</p>
  }

  return (
    <>
      <div className="artist-galleries">
        {items.map((g) => (
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
      {hasMore && (
        <div className="feed-load-more">
          <button className="btn-line" onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </>
  )
}
