// /articles/[slug] — a single guide. Server-rendered with full SEO/OGP so it
// can rank and be shared; the Markdown body is rendered to React elements
// (lib/markdown, no HTML injected). Closes with a CTA back into the funnel.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { fetchArticle, fetchPublishedArticles } from '@/lib/blog'
import { renderMarkdown } from '@/lib/markdown'
import { getServerT } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/i18n/metadata'
import { LocaleLink } from '@/components/I18nProvider'
import ArticleSidebar from '@/components/ArticleSidebar'

export const dynamic = 'force-dynamic'

/** サイドバーに並べる「ほかのガイド」の本数。長くすると本文の隣で自己主張しすぎる。 */
const SIDE_MORE_MAX = 5

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return ''
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const a = await fetchArticle(slug)
  if (!a) return {}
  const title = `${a.title} — Xibit360`
  const description = a.excerpt || `A Xibit360 guide: ${a.title}.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      images: a.coverUrl ? [{ url: a.coverUrl }] : undefined,
    },
    twitter: { card: a.coverUrl ? 'summary_large_image' : 'summary' },
    alternates: await localeAlternates(`/articles/${slug}`),
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { t } = await getServerT()
  const { slug } = await params
  const a = await fetchArticle(slug)
  if (!a) notFound()

  // 「ほかのガイド」はサイドバー用。1本しか無ければ自分だけなので空になる。
  const more = (await fetchPublishedArticles()).filter((x) => x.slug !== slug).slice(0, SIDE_MORE_MAX)

  return (
    <main className="article-page">
      <div className="article-inner">
        {/* ロゴを左に置く。検索から本文へ直接来た人にとって、ここが最初の
            「何のサイトか」の手がかりになる（以前は「← Guides」だけだった）。 */}
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
          <Link href="/signup" className="btn-line btn-gold">{t('common.startFree')}</Link>
        </div>

        <div className="article-layout">
          <div className="article-main">
            <LocaleLink href="/articles" className="article-back">← {t('articles.allGuides')}</LocaleLink>

            <article>
              <header className="article-header">
                <h1 className="article-title">{a.title}</h1>
                {a.publishedAt && <p className="article-meta">{fmtDate(a.publishedAt)}</p>}
              </header>

              {a.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img crossOrigin="anonymous" src={a.coverUrl} alt="" className="article-hero" />
              )}

              <div className="article-body">{renderMarkdown(a.bodyMd)}</div>
            </article>

            {/* Funnel CTA — every guide reader is a prospective artist */}
            <section className="article-cta">
              <h2>{t('articles.ctaTitle')}</h2>
              <p>{t('articles.ctaBody')}</p>
              <Link href="/signup" className="btn btn-gold">{t('common.startFree')}</Link>
              <p className="article-cta-alt">
                <LocaleLink href="/demo">{t('articles.ctaAlt')}</LocaleLink>
              </p>
            </section>
          </div>

          <ArticleSidebar more={more} />
        </div>

        <footer className="artist-footer">
          <LocaleLink href="/articles">{t('articles.allGuides')}</LocaleLink>
          <LocaleLink href="/explore">{t('footer.explore')}</LocaleLink>
          <LocaleLink href="/">{t('footer.home')}</LocaleLink>
        </footer>
      </div>
    </main>
  )
}
