// An exhibition served on its own subdomain: `tokyo-expo.xibit360.art`
// (ユーザー決定 2026-08-09). Reached only through the middleware rewrite in
// `middleware.ts` — nothing links to `/_expo/…` and it is not in the sitemap, because
// it is a routing target rather than a URL.
//
// The subdomain names an ACCOUNT, so this resolves it to the username and then answers
// the same question `/@username` answers: show the front-door room. Everything below
// therefore reuses the handle route's fetches rather than growing a second read path.
//
// No listing fallback. `/@username` shows an artist page when nothing is published;
// an exhibition host with nothing to exhibit is a 404, which is the honest answer for
// a URL that was handed out before the show opened.
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
import { getUsernameForSubdomain } from '@/lib/expoResolve'

export const dynamic = 'force-dynamic'

/** subdomain → the account's front-door public room, or null. */
async function resolve(params: Promise<{ sub: string }>) {
  const { sub } = await params
  const username = await getUsernameForSubdomain(sub)
  if (!username) return null
  const p = await getProfile(username)
  if (!p) return null
  const front = p.galleries.find((g) => g.isMain) ?? p.galleries[0]
  if (!front) return null
  const ex = await getExhibition(username, front.slug)
  return ex ?? null
}

export async function generateMetadata({ params }: { params: Promise<{ sub: string }> }): Promise<Metadata> {
  const ex = await resolve(params)
  if (!ex) return {}
  const title = exhibitionTitle(ex)
  const description = exhibitionDescription(ex)
  // The subdomain IS the canonical for an exhibition that has one, so this agrees with
  // what `/@username` says about the same room.
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
  params: Promise<{ sub: string }>
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
