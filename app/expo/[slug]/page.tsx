// An exhibition at its own URL: `xibit360.art/expo/tokyo-geidai-2026`
// (ユーザー決定 2026-08-09).
//
// Chosen over a subdomain because a subdomain costs a Vercel domain and a DNS record
// PER EXHIBITION, by hand, against a 50-domain cap — work that grows with the number of
// shows. A path costs nothing per show. Chosen over the root (`/{slug}`) because the
// root already holds fourteen app routes and eleven locale codes, and would keep
// colliding with every route added later; `/expo/` also tells a visitor what the page is.
//
// The slug names an ACCOUNT, so this resolves it to the username and then answers the
// same question `/@username` answers: show the front-door room. Everything below
// therefore reuses the handle route's fetches rather than growing a second read path.
//
// No listing fallback. `/@username` shows an artist page when nothing is published; an
// exhibition URL with nothing to exhibit is a 404, which is the honest answer for a URL
// handed out before the show opened.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VisitorGallery from '@/components/gallery/VisitorGallery'
import JsonLd from '@/components/JsonLd'
import {
  exhibitionDescription,
  exhibitionJsonLd,
  exhibitionTitle,
  exhibitionUrl,
  getExhibition,
  getProfile,
} from '@/lib/seo'
import { getUsernameForExpoSlug } from '@/lib/expoResolve'

export const dynamic = 'force-dynamic'

/** slug → the account's front-door public room, or null. */
async function resolve(params: Promise<{ slug: string }>) {
  const { slug } = await params
  const username = await getUsernameForExpoSlug(slug)
  if (!username) return null
  const p = await getProfile(username)
  if (!p) return null
  const front = p.galleries.find((g) => g.isMain) ?? p.galleries[0]
  if (!front) return null
  const ex = await getExhibition(username, front.slug)
  return ex ?? null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const ex = await resolve(params)
  if (!ex) return {}
  const title = exhibitionTitle(ex)
  const description = exhibitionDescription(ex)
  // `/expo/{slug}` IS the canonical for an exhibition that has a slug, so this agrees
  // with what `/@username` says about the same room.
  const canonical = exhibitionUrl(ex)
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: 'website', url: canonical },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function ExpoLobbyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ embed?: string }>
}) {
  const ex = await resolve(params)
  if (!ex) notFound()
  const { embed } = await searchParams
  return (
    <>
      <JsonLd data={exhibitionJsonLd(ex)} />
      <VisitorGallery exhibition={ex} embed={embed === '1'} />
    </>
  )
}
