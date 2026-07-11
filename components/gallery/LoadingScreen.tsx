'use client'
// The door of the gallery. /demo keeps the HAKONIWA house branding; a public
// gallery greets you with THAT artist's card — avatar, exhibition title, name —
// so the wait is part of arriving at their show, not a generic spinner.
import { isPlaceholderTitle } from '@/lib/publish'

export interface LoadingExhibition {
  title: string
  ownerName: string
  ownerAvatar: string | null
  username: string
}

export default function LoadingScreen({
  exhibition,
  done = false,
}: {
  exhibition?: LoadingExhibition | null
  done?: boolean
}) {
  if (exhibition) {
    const untitled = isPlaceholderTitle(exhibition.title)
    const title = untitled ? exhibition.ownerName : exhibition.title
    return (
      <div id="loading" className={done ? 'done' : ''}>
        <div className="loading-inner">
          {exhibition.ownerAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="loading-avatar" src={exhibition.ownerAvatar} alt="" />
          ) : (
            <div className="loading-avatar empty">{(exhibition.ownerName || '•').slice(0, 1).toUpperCase()}</div>
          )}
          <div className="loading-eyebrow">Now showing</div>
          <div className="loading-title">{title}</div>
          <div className="loading-by">
            {untitled ? `@${exhibition.username}` : `by ${exhibition.ownerName} — @${exhibition.username}`}
          </div>
          <div className="loading-bar"><span /></div>
          <div className="loading-text">Opening the doors…</div>
        </div>
      </div>
    )
  }
  return (
    <div id="loading" className={done ? 'done' : ''}>
      <div className="loading-inner">
        <div className="loading-logo">HAKONIWA</div>
        <div className="loading-bar"><span /></div>
        <div className="loading-text">Preparing the gallery…</div>
      </div>
    </div>
  )
}
