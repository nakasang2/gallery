'use client'
// 2D list fallback (non-functional requirement: WebGL-unsupported environments and
// screen readers). Shows the same exhibition list as the 3D room, as plain scrollable articles.
import { useExhibitionList } from '@/lib/exhibition'
import { useGallery } from '@/lib/store'

export default function FlatGallery() {
  const list = useExhibitionList()
  const visitor = useGallery((s) => s.visitor)

  return (
    <div className="flat-gallery" role="main">
      <header className="flat-head">
        <h1>{visitor ? visitor.title : 'HAKONIWA COLLECTION'}</h1>
        <p>
          {visitor ? `${visitor.ownerName} — @${visitor.username}` : 'A permanent collection — ten artists'}
        </p>
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
