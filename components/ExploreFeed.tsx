'use client'
// The /explore grid + "Load more" — the initial page is server-rendered (SEO,
// fast first paint); everything past that is fetched client-side straight
// through the same anon-key Supabase client the dashboard already uses.
import { useState } from 'react'
import { fetchPublicFeed, EXPLORE_PAGE_SIZE, type FeedItem } from '@/lib/publish'
import FeedCard from '@/components/FeedCard'
import { useT } from '@/components/I18nProvider'

export default function ExploreFeed({
  initialItems,
  initialHasMore,
}: {
  initialItems: FeedItem[]
  initialHasMore: boolean
}) {
  const t = useT()
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
    return <p className="feed-empty">{t('explore.emptyState')}</p>
  }

  return (
    <>
      <div className="artist-galleries">
        {items.map((g) => (
          <FeedCard key={`${g.username}/${g.slug}`} g={g} />
        ))}
      </div>
      {hasMore && (
        <div className="feed-load-more">
          <button className="btn-line" onClick={() => void loadMore()} disabled={loading}>
            {loading ? t('common.saving') : t('explore.loadMore')}
          </button>
        </div>
      )}
    </>
  )
}
