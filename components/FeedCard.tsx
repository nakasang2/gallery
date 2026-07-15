// One exhibition card, shared by the Explore feed and the curated spotlight so
// both read identically. Server-safe (no hooks) — just a link.
import Link from 'next/link'
import { isPlaceholderTitle, type FeedItem } from '@/lib/publish'

export default function FeedCard({ g }: { g: FeedItem }) {
  return (
    <Link className="artist-gallery-card" href={`/@${g.username}/${g.slug}`}>
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
        <span className="artist-gallery-title">{isPlaceholderTitle(g.title) ? g.ownerName : g.title}</span>
        <span className="artist-gallery-sub">
          {g.workCount} work{g.workCount === 1 ? '' : 's'} · walk through in 3D →
        </span>
      </div>
    </Link>
  )
}
