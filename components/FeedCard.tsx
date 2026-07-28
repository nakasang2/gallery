// One exhibition card, shared by the Explore feed and the curated spotlight so
// both read identically. Server-safe (no hooks) — just a link.
import Link from 'next/link'
import { isPlaceholderTitle, type FeedItem } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'

// `.artist-galleries` is repeat(auto-fill, minmax(240px, 1fr)) with a 1rem gap,
// inside `.me-inner` = min(880px, 100vw - 2.8rem). That resolves to 1 column up to
// 540px, 2 up to 796px, 3 above — and a fixed 283px once the container caps at 880.
// Measured 2026-07-28; keep in sync with .artist-galleries in app/me.css.
export const COVER_SIZES =
  '(max-width: 540px) calc(100vw - 2.8rem), (max-width: 796px) calc((100vw - 2.8rem - 1rem) / 2), (max-width: 924px) calc((100vw - 2.8rem - 2rem) / 3), 283px'

export default function FeedCard({ g }: { g: FeedItem }) {
  const t = useT()
  return (
    <Link className="artist-gallery-card" href={`/@${g.username}/${g.slug}`}>
      {g.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          crossOrigin="anonymous"
          src={g.cover}
          srcSet={g.coverSrcSet ?? undefined}
          sizes={COVER_SIZES}
          alt=""
          className="artist-cover"
        />
      ) : (
        <div className="artist-cover artist-cover-empty" />
      )}
      <div className="feed-card-artist">
        {g.ownerAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img crossOrigin="anonymous" className="feed-card-avatar" src={g.ownerAvatar} alt="" />
        ) : (
          <div className="feed-card-avatar empty">{(g.ownerName || '•').slice(0, 1).toUpperCase()}</div>
        )}
        <span className="feed-card-artist-name">{g.ownerName}</span>
      </div>
      <div className="artist-gallery-meta">
        <span className="artist-gallery-title">{isPlaceholderTitle(g.title) ? g.ownerName : g.title}</span>
        <span className="artist-gallery-sub">
          {t('explore.walkThrough', { count: g.workCount })}
        </span>
      </div>
    </Link>
  )
}
