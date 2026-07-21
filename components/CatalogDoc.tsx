// Presentational catalog body (no data-fetch, no hooks) so both the real route
// and QA can render it. Screen + print faces are driven entirely by catalog.css.
import { isPlaceholderTitle } from '@/lib/publish'
import type { PublicExhibition } from '@/lib/publish'

export default function CatalogDoc({ exhibition: ex }: { exhibition: PublicExhibition }) {
  const showTitle = isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title
  const year = new Date().getFullYear()
  return (
    <article className="catalog-doc">
      <section className="catalog-cover">
        <p className="catalog-eyebrow">Exhibition Catalog</p>
        <h1 className="catalog-title">{showTitle}</h1>
        <p className="catalog-artist">{ex.ownerName}</p>
        {ex.statement && <p className="catalog-statement">{ex.statement}</p>}
        <p className="catalog-meta">
          {ex.artworks.length} {ex.artworks.length === 1 ? 'work' : 'works'} · {year} · XIBIT360
        </p>
      </section>

      {ex.artworks.map((art, i) => {
        const img = art.kind === 'video' ? art.poster : art.src
        return (
          <section className="catalog-plate" key={art.id}>
            <div className="catalog-plate-img">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt={art.title || `Work ${i + 1}`} />
              ) : (
                <div className="catalog-plate-noimg" aria-hidden="true" />
              )}
            </div>
            <div className="catalog-plate-cap">
              <p className="catalog-plate-no">{String(i + 1).padStart(2, '0')}</p>
              <h2 className="catalog-plate-title">{art.title || 'Untitled'}</h2>
              <p className="catalog-plate-sub">
                {art.artist || ex.ownerName}
                {art.year ? ` · ${art.year}` : ''}
                {art.kind === 'video' ? ' · video' : ''}
              </p>
              {art.desc && <p className="catalog-plate-desc">{art.desc}</p>}
              {art.purchaseUrl && <p className="catalog-plate-sale">Available for purchase</p>}
            </div>
          </section>
        )
      })}

      {ex.artworks.length === 0 && (
        <section className="catalog-plate">
          <p className="catalog-plate-desc">This exhibition has no works yet.</p>
        </section>
      )}
    </article>
  )
}
