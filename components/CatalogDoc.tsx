// Presentational catalog body (no data-fetch, no hooks) so both the real route
// and QA can render it. Screen + print faces are driven entirely by catalog.css.
import { isPlaceholderTitle } from '@/lib/publish'
import type { PublicExhibition } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'

export default function CatalogDoc({ exhibition: ex }: { exhibition: PublicExhibition }) {
  const t = useT()
  const showTitle = isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title
  const year = new Date().getFullYear()
  return (
    <article className="catalog-doc">
      <section className="catalog-cover">
        <p className="catalog-eyebrow">{t('catalog.title')}</p>
        <h1 className="catalog-title">{showTitle}</h1>
        <p className="catalog-artist">{ex.ownerName}</p>
        {ex.statement && <p className="catalog-statement">{ex.statement}</p>}
        <p className="catalog-meta">
          {t('catalog.workCount', { count: ex.artworks.length })} · {year} · XIBIT360
        </p>
      </section>

      {ex.artworks.map((art, i) => {
        const img = art.kind === 'video' ? art.poster : art.src
        return (
          <section className="catalog-plate" key={art.id}>
            <div className="catalog-plate-img">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img crossOrigin="anonymous" src={img} alt={art.title || t('catalog.workAlt', { n: i + 1 })} />
              ) : (
                <div className="catalog-plate-noimg" aria-hidden="true" />
              )}
            </div>
            <div className="catalog-plate-cap">
              <p className="catalog-plate-no">{String(i + 1).padStart(2, '0')}</p>
              <h2 className="catalog-plate-title">{art.title || t('common.untitled')}</h2>
              <p className="catalog-plate-sub">
                {art.artist || ex.ownerName}
                {art.year ? ` · ${art.year}` : ''}
                {art.kind === 'video' ? ` · ${t('catalog.video')}` : ''}
              </p>
              {art.desc && <p className="catalog-plate-desc">{art.desc}</p>}
              {art.purchaseUrl && <p className="catalog-plate-sale">{t('catalog.forSale')}</p>}
            </div>
          </section>
        )
      })}

      {ex.artworks.length === 0 && (
        <section className="catalog-plate">
          <p className="catalog-plate-desc">{t('catalog.empty')}</p>
        </section>
      )}
    </article>
  )
}
