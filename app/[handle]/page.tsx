// xibit360.art/@username — THE public URL of an artist.
// While the plan allows a single gallery, this renders the public gallery
// directly (the shared URL is just /@name); with several public galleries
// it becomes the listing page. /@name/[slug] keeps working either way.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isPlaceholderTitle } from '@/lib/publish'
import {
  artistJsonLd,
  artistPath,
  artistUrl,
  exhibitionUrl,
  exhibitionDescription,
  exhibitionJsonLd,
  exhibitionTitle,
  getExhibition,
  getProfile,
} from '@/lib/seo'
import VisitorGallery from '@/components/gallery/VisitorGallery'
import OwnerPreview from '@/components/gallery/OwnerPreview'
import SnsLinks from '@/components/SnsLinks'
import JsonLd from '@/components/JsonLd'
import { LanguageSwitcher, LegalLink, LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import { COVER_SIZES } from '@/components/FeedCard'

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
  const p = await getProfile(username)
  if (!p) return {}
  // Whether this URL is the exhibition or a listing, it is canonical for itself — unless
  // the exhibition has its own `/expo/{slug}` URL, which then owns the canonical
  // (ユーザー決定 2026-08-09). `/@name` keeps serving the page either way.
  const canonical = artistUrl({ username, expoSlug: p.expoSlug })

  // /@name IS an exhibition — the front-door room's (ユーザー決定 2026-08-09; with a
  // single public room that is simply that room, exactly as before).
  const front = p.galleries.find((g) => g.isMain) ?? p.galleries[0]
  if (front) {
    const ex = await getExhibition(username, front.slug)
    if (ex) {
      const title = exhibitionTitle(ex)
      const description = exhibitionDescription(ex)
      return {
        title,
        description,
        // The room's own canonical, which follows the exhibition's `/expo/{slug}` URL
        // when it has one.
        alternates: { canonical: exhibitionUrl(ex) },
        openGraph: { title, description, type: 'website', url: canonical },
        twitter: { card: 'summary_large_image' },
      }
    }
  }

  const title = `${p.displayName} — Xibit360`
  const description = p.bio || `3D galleries by ${p.displayName}.`
  const cover = p.galleries.find((g) => g.cover)?.cover
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'profile',
      url: canonical,
      ...(cover ? { images: [{ url: cover }] } : {}),
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function ArtistPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ embed?: string }>
}) {
  const { t } = await getServerT()
  const username = await resolveUsername(params)
  if (!username) notFound()
  const p = await getProfile(username)
  if (!p) notFound()

  // /@name is the URL the dashboard's Embed button points at, so it must honor
  // ?embed=1 the same way /@name/[slug] does — otherwise embeds render the full HUD.
  const { embed } = await searchParams

  // /@name opens the front-door room. With one public room that is that room (what
  // this page has always done); with several, it is the one the artist designated, and
  // the others are reached through the doors inside it (ユーザー決定 2026-08-09).
  // The listing below is only reached when the artist has NO public room at all.
  const front = p.galleries.find((g) => g.isMain) ?? p.galleries[0]
  if (front) {
    const ex = await getExhibition(username, front.slug)
    if (ex) {
      return (
        <>
          <JsonLd data={exhibitionJsonLd(ex)} />
          <VisitorGallery exhibition={ex} embed={embed === '1'} />
        </>
      )
    }
  }

  return (
    <>
    <JsonLd data={artistJsonLd(p)} />
    {/* Owner-only: if the signed-in viewer owns a PRIVATE gallery at this handle,
        this takes over full-screen so they can walk their draft. Renders nothing
        for everyone else, so the public listing below is unaffected. */}
    <OwnerPreview handle={username} />
    <main className="artist-page">
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
          <LocaleLink href="/explore" className="btn-line">{t('footer.explore')}</LocaleLink>
        </div>

        <div className="artist-head">
          {p.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img crossOrigin="anonymous" className="artist-avatar" src={p.avatarUrl} alt="" />
          )}
          <div>
            <h1 className="artist-name">{p.displayName}</h1>
            <p className="artist-handle">@{p.username}</p>
            <SnsLinks sns={p.sns} />
          </div>
        </div>
        {p.bio && <p className="artist-bio">{p.bio}</p>}

        <section className="me-section" style={{ marginTop: '2.4rem' }}>
          <h2>{t('artist.exhibitions')}</h2>
          {p.galleries.length === 0 && (
            <p className="me-note">{t('artist.noExhibitions')}</p>
          )}
          <div className="artist-galleries">
            {p.galleries.map((g) => (
              <Link key={g.slug} className="artist-gallery-card" href={`/@${p.username}/${g.slug}`}>
                {g.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    crossOrigin="anonymous"
                    src={g.cover}
                    srcSet={g.coverSrcSet ?? undefined}
                    sizes={COVER_SIZES}
                    alt=""
                    className="artist-cover"
                  />
                ) : (
                  <div className="artist-cover artist-cover-empty" />
                )}
                <div className="artist-gallery-meta">
                  <span className="artist-gallery-title">
                    {isPlaceholderTitle(g.title) ? t('common.exhibition') : g.title}
                  </span>
                  <span className="artist-gallery-sub">
                    {t('explore.walkThrough', { count: g.workCount })}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <footer className="artist-footer">
          <LanguageSwitcher />
          <Link href="/terms">{t('footer.terms')}</Link>
          <LegalLink />
          <Link href="/privacy">{t('footer.privacy')}</Link>
          <Link href={`/report?about=${encodeURIComponent(`@${p.username}`)}`}>{t('artist.reportProblem')}</Link>
        </footer>
      </div>
    </main>
    </>
  )
}
