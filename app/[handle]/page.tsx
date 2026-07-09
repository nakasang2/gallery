// Artist page: hakoniwa.app/@username — profile + list of public hakoniwa
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchPublicProfile } from '@/lib/publish'

export const dynamic = 'force-dynamic'

async function resolveUsername(params: Promise<{ handle: string }>): Promise<string | null> {
  const { handle } = await params
  const decoded = decodeURIComponent(handle)
  if (!decoded.startsWith('@')) return null
  return decoded.slice(1)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const username = await resolveUsername(params)
  if (!username) return {}
  const p = await fetchPublicProfile(username)
  if (!p) return {}
  const title = `${p.displayName} — HAKONIWA`
  const description = p.bio || `3D galleries by ${p.displayName}.`
  const cover = p.galleries.find((g) => g.cover)?.cover
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile', ...(cover ? { images: [{ url: cover }] } : {}) },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function ArtistPage({ params }: { params: Promise<{ handle: string }> }) {
  const username = await resolveUsername(params)
  if (!username) notFound()
  const p = await fetchPublicProfile(username)
  if (!p) notFound()

  const reportEmail = process.env.NEXT_PUBLIC_REPORT_EMAIL

  return (
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
        </div>

        <h1 className="artist-name">{p.displayName}</h1>
        <p className="artist-handle">@{p.username}</p>
        {p.bio && <p className="artist-bio">{p.bio}</p>}

        <section className="me-section" style={{ marginTop: '2.4rem' }}>
          <h2>Exhibitions</h2>
          {p.galleries.length === 0 && (
            <p className="me-note">No public exhibitions yet.</p>
          )}
          <div className="artist-galleries">
            {p.galleries.map((g) => (
              <Link key={g.slug} className="artist-gallery-card" href={`/@${p.username}/${g.slug}`}>
                {g.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.cover} alt="" className="artist-cover" />
                ) : (
                  <div className="artist-cover artist-cover-empty" />
                )}
                <div className="artist-gallery-meta">
                  <span className="artist-gallery-title">{g.title}</span>
                  <span className="artist-gallery-sub">
                    {g.workCount} work{g.workCount === 1 ? '' : 's'} · walk through in 3D →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          {reportEmail && (
            <a href={`mailto:${reportEmail}?subject=${encodeURIComponent(`Report: @${p.username}`)}`}>
              Report a problem
            </a>
          )}
        </footer>
      </div>
    </main>
  )
}
