// /articles/[slug] — a single guide. Server-rendered with full SEO/OGP so it
// can rank and be shared; the Markdown body is rendered to React elements
// (lib/markdown, no HTML injected). Closes with a CTA back into the funnel.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { fetchArticle } from '@/lib/blog'
import { renderMarkdown } from '@/lib/markdown'
import { getServerT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

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
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { t } = await getServerT()
  const { slug } = await params
  const a = await fetchArticle(slug)
  if (!a) notFound()

  return (
    <main className="article-page">
      <div className="article-inner">
        <div className="me-top">
          <Link href="/articles" className="auth-logo">← Guides</Link>
          <Link href="/signup" className="btn-line btn-gold">{t('common.startFree')}</Link>
        </div>

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
            <Link href="/demo">or walk the demo first →</Link>
          </p>
        </section>

        <footer className="artist-footer">
          <Link href="/articles">{t('articles.allGuides')}</Link>
          <Link href="/explore">{t('footer.explore')}</Link>
          <Link href="/">Home</Link>
        </footer>
      </div>
    </main>
  )
}
