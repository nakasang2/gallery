'use client'
// The door of the gallery. /demo keeps the Xibit360 house branding; a public
// gallery greets you with THAT artist's card — avatar, exhibition title, name —
// so the wait is part of arriving at their show, not a generic spinner.
import { isPlaceholderTitle } from '@/lib/publish'
import BrandLogo from '@/components/BrandLogo'
import { useT } from '@/components/I18nProvider'

export interface LoadingExhibition {
  title: string
  ownerName: string
  ownerAvatar: string | null
}

/** The bar runs as an indeterminate shuttle until there is a real number to show
 *  (the /demo dynamic-import fallback renders before anything has been requested). */
function Bar({ progress }: { progress?: number }) {
  if (progress === undefined) {
    return <div className="loading-bar"><span /></div>
  }
  return (
    <div className="loading-bar determinate">
      <span style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
    </div>
  )
}

export default function LoadingScreen({
  exhibition,
  done = false,
  progress,
}: {
  exhibition?: LoadingExhibition | null
  done?: boolean
  /** 0–100 across three's loading manager; omitted while nothing is in flight. */
  progress?: number
}) {
  const t = useT()
  if (exhibition) {
    const untitled = isPlaceholderTitle(exhibition.title)
    const title = untitled ? exhibition.ownerName : exhibition.title
    return (
      <div id="loading" className={done ? 'done' : ''}>
        <div className="loading-inner">
          {exhibition.ownerAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img crossOrigin="anonymous" className="loading-avatar" src={exhibition.ownerAvatar} alt="" />
          ) : (
            <div className="loading-avatar empty">{(exhibition.ownerName || '•').slice(0, 1).toUpperCase()}</div>
          )}
          <div className="loading-eyebrow">{t('loading.nowShowing')}</div>
          <div className="loading-title">{title}</div>
          {/* Just the artist's name — the title already carries it when untitled */}
          {!untitled && <div className="loading-by">{exhibition.ownerName}</div>}
          <Bar progress={progress} />
          <div className="loading-text">{t('loading.openingDoors')}</div>
        </div>
      </div>
    )
  }
  return (
    <div id="loading" className={done ? 'done' : ''}>
      <div className="loading-inner">
        <div className="loading-logo"><BrandLogo animate /></div>
        <Bar progress={progress} />
        <div className="loading-text">{t('loading.preparing')}</div>
      </div>
    </div>
  )
}
