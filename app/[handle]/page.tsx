// hakoniwa.app/@username — THE public URL of an artist.
// While the plan allows a single hakoniwa, this renders the public gallery
// directly (the shared URL is just /@name); with several public galleries
// it becomes the listing page. /@name/[slug] keeps working either way.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchPublicProfile, fetchPublicExhibition } from '@/lib/publish'
import VisitorGallery from '@/components/gallery/VisitorGallery'

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

  // Single public gallery: /@name IS the exhibition — use exhibition metadata
  if (p.galleries.length === 1) {
    const ex = await fetchPublicExhibition(username, p.galleries[0].slug)
    if (ex) {
      const title = `${ex.title} | ${ex.ownerName} — HAKONIWA`
      const description =
        ex.statement ||
        `A 3D gallery by ${ex.ownerName}. Walk through ${ex.artworks.length} works in your browser.`
      return {
        title,
        description,
        openGraph: { title, description, type: 'website' },
        twitter: { card: 'summary_large_image' },
      }
    }
  }

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

  // Exactly one public hakoniwa → /@name opens the room itself
  if (p.galleries.length === 1) {
    const ex = await fetchPublicExhibition(username, p.galleries[0].slug)
    if (ex) return <VisitorGallery exhibition={ex} />
  }

  return (
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
        </div>

        <div className="artist-head">
          {p.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="artist-avatar" src={p.avatarUrl} alt="" />
          )}
          <div>
            <h1 className="artist-name">{p.displayName}</h1>
            <p className="artist-handle">@{p.username}</p>
          </div>
        </div>
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
          <Link href={`/report?about=${encodeURIComponent(`@${p.username}`)}`}>Report a problem</Link>
        </footer>
      </div>
    </main>
  )
}
