// /articles — the public guides/blog index (STRATEGY §4.1-3: SEO content that
// pulls search traffic into the funnel). Server-rendered for SEO; reads only
// published rows via the anon key + RLS.
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPublishedArticles } from '@/lib/blog'

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
  const articles = await fetchPublishedArticles()

  return (
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">XIBIT360</Link>
          <Link href="/signup" className="btn-line">Start free</Link>
        </div>

        <h1 className="artist-name">Guides</h1>
        <p className="feed-intro">
          Everything about showing your art as a walkable exhibition — opening your first room, sharing it, and drawing a crowd.
        </p>

        {articles.length === 0 ? (
          <p className="feed-empty">No guides published yet — check back soon.</p>
        ) : (
          <div className="article-list">
            {articles.map((a) => (
              <Link key={a.slug} className="article-card" href={`/articles/${a.slug}`}>
                {a.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.coverUrl} alt="" className="article-card-cover" />
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
          <Link href="/explore">Explore</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  )
}
