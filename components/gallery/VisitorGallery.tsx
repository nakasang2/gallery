'use client'
// Visitor view of a public gallery: put the store in visitor mode and render GalleryApp read-only
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useGallery } from '@/lib/store'
import { recordVisit } from '@/lib/engagement'
import { track } from '@/lib/analytics'
import AnalyticsProbe from '@/components/gallery/AnalyticsProbe'
import LoadingScreen from '@/components/gallery/LoadingScreen'
import FlatWorkList from '@/components/gallery/FlatWorkList'
import { publicExhibitionWorks } from '@/lib/roomPlan'
import { isPlaceholderTitle, type PublicExhibition } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'

// No dynamic() fallback here — the personalised LoadingScreen below covers the
// chunk load, and GalleryApp renders the IDENTICAL screen the moment it mounts
// (visitor mode is already in the store), so the door never flickers.
const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => null,
})

export default function VisitorGallery({
  exhibition,
  embed = false,
  ownerPreview = false,
}: {
  exhibition: PublicExhibition
  embed?: boolean
  /** The owner previewing their OWN (possibly private) gallery — skip the visit
   *  tally and show a "private preview" banner instead of a real visit. */
  ownerPreview?: boolean
}) {
  const t = useT()
  const [armed, setArmed] = useState(false)
  const [shellUp, setShellUp] = useState(false)

  useEffect(() => {
    document.body.classList.add('gallery-mode')
    useGallery.setState({ visitor: exhibition, embed })
    if (!ownerPreview) {
      recordVisit(exhibition.galleryId) // one count per tab session (drives the ghost crowd)
      // The raw arrival, before any dedupe — `visits` counts a tab session, this
      // counts a page open, and the gap between them is real (docs/ANALYTICS.md A1).
      // A multi-room show fires this once PER ROOM, because each room is its own page
      // load (ユーザー決定 2026-08-09). That is the honest reading — a room view is a
      // room view — but it means "arrivals" is not the same as "people" once a show has
      // several rooms. `room_slug` / `room_main` / `rooms` are what separate the two:
      // group by them for per-room numbers, filter to `room_main` for arrivals at the
      // front door, which is the closest thing to a visit to the SHOW.
      track('gallery_arrive', {
        gallery_id: exhibition.galleryId,
        embed,
        works: exhibition.artworks.length,
        room_slug: exhibition.slug,
        room_main: exhibition.isMain,
        rooms: exhibition.publicGalleryCount,
        referrer: document.referrer ? new URL(document.referrer).host : 'direct',
      })
    }
    setArmed(true)
    return () => {
      document.body.classList.remove('gallery-mode')
      useGallery.setState({ visitor: null, embed: false })
    }
  }, [exhibition, embed, ownerPreview])

  return (
    <>
      {/* Outside the dynamic() below on purpose: mounted inside GalleryApp it
          could not see a visitor leave while the loading screen is still up. */}
      {armed && !ownerPreview && (
        <AnalyticsProbe
          galleryId={exhibition.galleryId}
          embed={embed}
          works={exhibition.artworks.length}
        />
      )}
      {armed && <GalleryApp onShellReady={() => setShellUp(true)} />}
      {/* The exhibition as plain HTML. This is what the server sends, so a client
          that never runs JS — a crawler included — gets the works, the artist and
          the statement instead of a bare <canvas> (docs/DECISIONS 2026-07-30 SEO).
          It sits behind the opaque LoadingScreen (#loading is z-index 50, this is
          auto), so a visitor never sees it, and hydration drops it on the first
          effect. Gated on `armed` rather than `shellUp` so it can never coexist
          with the copy GalleryApp mounts when WebGL is missing — two role="main"
          landmarks and two <h1>s would be worse than none.
          A JS-executing crawler indexes the DOM after this is gone; the structured
          data in the page <head> is what carries the works for those. */}
      {!armed && (
        <FlatWorkList
          heading={isPlaceholderTitle(exhibition.title) ? exhibition.ownerName : exhibition.title}
          subhead={`${exhibition.ownerName} — @${exhibition.username}`}
          statement={exhibition.statement || undefined}
          works={publicExhibitionWorks(exhibition)}
          emptyNote={t('artwork.noWorks')}
        />
      )}
      {!shellUp && <LoadingScreen exhibition={exhibition} />}
      {ownerPreview && shellUp && (
        <div className="owner-preview-banner" role="status">
          <span className="owner-preview-dot" aria-hidden="true" />
          {t('artwork.privatePreview')}
        </div>
      )}
    </>
  )
}
