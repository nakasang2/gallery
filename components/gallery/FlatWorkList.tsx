// The exhibition as plain HTML: a heading, the artist's statement, and one
// <article> per work with a real <img>.
//
// Two callers render this, which is the whole reason it exists as its own file:
//   1. FlatGallery — the client fallback for browsers without WebGL.
//   2. VisitorGallery's server output — the crawlable copy of a published gallery
//      (docs/DECISIONS 2026-07-30 SEO). Everything a search engine could read about
//      an exhibition used to live inside the WebGL canvas, so the HTML carried the
//      title and the artist's name and nothing else.
//
// Deliberately hook-free and free of any store access so a SERVER component can
// render it. Strings arrive already translated; the works arrive already ordered.
import type { ArtworkData } from '@/lib/artworks'
import { renderMarkdown } from '@/lib/markdown'
import { artworkSrcSet } from '@/lib/cloud'

// `.flat-work` is max-width 640px inside `.flat-gallery`'s 1.4rem side padding,
// so the image box is min(640px, 100vw - 2.8rem). 640 + 2.8rem = 684.8px.
const FLAT_SIZES = '(max-width: 684px) calc(100vw - 2.8rem), 640px'

export default function FlatWorkList({
  heading,
  subhead,
  statement,
  note,
  works,
  emptyNote,
}: {
  heading: string
  subhead: string
  /** The artist's statement. Shown when the room has one — it is the only prose an
   *  exhibition has, and it appeared nowhere in the public HTML before this. */
  statement?: string
  /** The "this browser has no WebGL" notice. Omitted by the server copy, where the
   *  3D room is about to load and the notice would simply be untrue. */
  note?: string
  /** Already in slot order — the same order the 3D room hangs them in. */
  works: ArtworkData[]
  emptyNote: string
}) {
  return (
    <div className="flat-gallery" role="main">
      <header className="flat-head">
        <h1>{heading}</h1>
        <p>{subhead}</p>
        {note && <p className="flat-note">{note}</p>}
      </header>
      {/* 作家が書いた文はマークダウンで描く（ユーザー要望 2026-08-13）。ここは
          クローラが読む素のHTMLでもあるので、記号のまま出すと検索結果にも記号が出る。 */}
      {statement && <div className="flat-statement panel-md">{renderMarkdown(statement, { images: false, breaks: true })}</div>}
      {works.map((art, i) => (
        <article className="flat-work" key={art.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            crossOrigin="anonymous"
            // Without WebGL this list is the whole exhibition, so the fallback
            // src is the mid-size card rather than the 400px thumb it used to be.
            src={art.poster ?? art.card ?? art.thumb ?? art.src}
            srcSet={artworkSrcSet(art)}
            sizes={FLAT_SIZES}
            alt={`${art.title} — ${art.artist}`}
            loading="lazy"
          />
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
      {works.length === 0 && <p className="flat-note">{emptyNote}</p>}
    </div>
  )
}
