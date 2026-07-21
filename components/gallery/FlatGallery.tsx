'use client'
// 2D list fallback (non-functional requirement: WebGL-unsupported environments and
// screen readers). Shows the same exhibition list as the 3D room, as plain scrollable articles.
import { useExhibitionList } from '@/lib/exhibition'
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'

export default function FlatGallery() {
  const list = useExhibitionList()
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const ownerName = useGallery((s) => s.profileDisplayName)

  // Header identity mirrors the 3D HUD: a visitor sees the artist, a signed-in
  // owner sees their own room, and only the anonymous demo shows the house title.
  const owner = !visitor && user && myGallery
  const heading = visitor
    ? isPlaceholderTitle(visitor.title)
      ? visitor.ownerName
      : visitor.title
    : owner
      ? isPlaceholderTitle(myGallery!.title)
        ? ownerName || 'Your exhibition'
        : myGallery!.title
      : 'XIBIT360 COLLECTION'
  const subhead = visitor
    ? `${visitor.ownerName} — @${visitor.username}`
    : owner
      ? 'Your space'
      : 'A permanent collection — ten works'

  return (
    <div className="flat-gallery" role="main">
      <header className="flat-head">
        <h1>{heading}</h1>
        <p>{subhead}</p>
        <p className="flat-note">
          This browser cannot show the 3D room (WebGL unavailable), so the works are listed below.
        </p>
      </header>
      {list.map((art, i) => (
        <article className="flat-work" key={art.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.poster ?? art.src} alt={`${art.title} — ${art.artist}`} loading="lazy" />
          <h2>
            <span className="flat-no">No. {String(i + 1).padStart(2, '0')}</span>
            {art.title}
          </h2>
          <p className="flat-artist">
            {art.artist} — {art.year}
          </p>
          {art.desc && <p className="flat-desc">{art.desc}</p>}
        </article>
      ))}
      {list.length === 0 && <p className="flat-note">No works are exhibited yet.</p>}
    </div>
  )
}
