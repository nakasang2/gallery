// /articles — the public guides/blog index (STRATEGY §4.1-3: SEO content that
// pulls search traffic into the funnel). Server-rendered for SEO; reads only
// published rows via the anon key + RLS.
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPublishedArticles } from '@/lib/blog'
import { LanguageSwitcher } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Guides — Xibit360',
  description: 'How to open a walkable 3D exhibition: guides on showing your art, growing an audience, and making the most of Xibit360.',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return ''
  }
}

export default async function ArticlesPage() {
  const { t } = await getServerT()
  const articles = await fetchPublishedArticles()

  return (
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">XIBIT360</Link>
          <Link href="/signup" className="btn-line">{t('common.startFree')}</Link>
        </div>

        <h1 className="artist-name">{t('articles.title')}</h1>
        <p className="feed-intro">
          {t('articles.intro')}
        </p>

        {articles.length === 0 ? (
          <p className="feed-empty">{t('articles.empty')}</p>
        ) : (
          <div className="article-list">
            {articles.map((a) => (
              <Link key={a.slug} className="article-card" href={`/articles/${a.slug}`}>
                {a.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img crossOrigin="anonymous" src={a.coverUrl} alt="" className="article-card-cover" />
                ) : (
                  <div className="article-card-cover article-card-cover-empty" />
                )}
                <div className="article-card-body">
                  <h2 className="article-card-title">{a.title}</h2>
                  {a.excerpt && <p className="article-card-excerpt">{a.excerpt}</p>}
                  {a.publishedAt && <p className="article-card-date">{fmtDate(a.publishedAt)}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}

        <footer className="artist-footer">
          <LanguageSwitcher />
          <Link href="/explore">{t('footer.explore')}</Link>
          <Link href="/terms">{t('footer.terms')}</Link>
          <Link href="/legal">{t('footer.legal')}</Link>
          <Link href="/privacy">{t('footer.privacy')}</Link>
        </footer>
      </div>
    </main>
  )
}
